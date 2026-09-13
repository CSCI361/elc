import {
  eventAnalyticsQuerySchema,
  ga4AvailableSchema,
  ga4UnavailableSchema,
  trafficResponseSchema,
  type TrafficResponse,
} from "@elc/shared"
import { ApiFailure } from "../db/transitions"
import type { Bindings } from "../env"
import { addCalendarDays, reportingPeriod } from "../reporting/dates"
import { reportAccess } from "../reporting/sql"
import {
  createGa4Provider,
  type Ga4Provider,
  type Ga4ReportRequest,
} from "./provider"

const hour = 3_600_000
const leaseMs = 60_000
type Environment = Pick<
  Bindings,
  "DB" | "GA4_PROPERTY_ID" | "GA4_SERVICE_ACCOUNT_JSON"
>
type Context = { id: string; reporting_id: string; time_zone: string }
type CacheRow = {
  result_json: string | null
  fetched_at: number | null
  expires_at: number
  lease_until: number
  touched_at: number
}

function unavailable(
  now: number,
  reason:
    | "data_unavailable"
    | "provider_unavailable"
    | "not_configured"
    | "invalid_response" = "data_unavailable",
  retryAfterSeconds = 60
) {
  return {
    status: "unavailable" as const,
    source: "ga4" as const,
    reason,
    retryable: reason !== "not_configured",
    retryAfterSeconds,
    checkedAt: new Date(now).toISOString(),
  }
}

/** Cache and transport results must match the server-resolved event, period and campaign page. */
function scopedResult(
  value: unknown,
  request: Ga4ReportRequest,
  now: number
): TrafficResponse["result"] | null {
  const failed = ga4UnavailableSchema.safeParse(value)
  if (failed.success) return failed.data
  const parsed = ga4AvailableSchema.safeParse(value)
  if (!parsed.success) return null
  const data = parsed.data
  const dayCount =
    (Date.parse(request.period.end) - Date.parse(request.period.start)) /
      86_400_000 +
    1
  if (
    data.eventReportingId !== request.eventReportingId ||
    data.period.range !== request.period.range ||
    data.period.start !== request.period.start ||
    data.period.end !== request.period.end ||
    data.period.dayCount !== dayCount ||
    Date.parse(data.fetchedAt) > now ||
    Date.parse(data.fetchedAt) < now - hour ||
    data.daily.length !== dayCount ||
    data.daily.some(
      (row, index) => row.date !== addCalendarDays(request.period.start, index)
    ) ||
    data.campaigns.length !== request.campaignReportingIds.length ||
    new Set(data.campaigns.map((row) => row.campaignReportingId)).size !==
      data.campaigns.length ||
    data.campaigns.some(
      (row) => !request.campaignReportingIds.includes(row.campaignReportingId)
    )
  )
    return null
  for (const field of [
    "pageViews",
    "eventViews",
    "campaignVisits",
    "checkoutStarts",
  ] as const) {
    const sum = data.daily.reduce(
      (total, row) => total + BigInt(row[field]),
      0n
    )
    if (sum !== BigInt(data.totals[field])) return null
  }
  return data
}

export async function readEventTraffic(
  env: Environment,
  actorId: string,
  eventId: string,
  raw: unknown = {},
  dependencies: {
    now?: () => number
    provider?: Ga4Provider
    beforeReturn?: () => Promise<void>
  } = {}
): Promise<TrafficResponse> {
  const parsed = eventAnalyticsQuerySchema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Choose valid report dates and campaign pages."
    )
  const db = env.DB,
    clock = dependencies.now ?? Date.now
  const now = clock()
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "The reporting clock is unavailable."
    )
  const access = () =>
    db
      .prepare(
        `SELECT e.id,e.reporting_id,e.time_zone FROM events e WHERE e.id=? AND ${reportAccess}`
      )
      .bind(eventId, actorId)
      .first<Context>()
  const initial = await access()
  if (!initial)
    throw new ApiFailure("NOT_FOUND", 404, "Event report not found.")
  const query = parsed.data
  const period = reportingPeriod(query, initial.time_zone, now)
  const campaignStatement = () =>
    db
      .prepare(`SELECT c.reporting_id FROM events e JOIN campaigns c ON c.event_id=e.id
    WHERE e.id=? AND ${reportAccess} AND c.id>? ORDER BY c.id LIMIT ?`)
      .bind(eventId, actorId, query.campaignAfter ?? "", query.limit)
  const campaigns = await campaignStatement().all<{ reporting_id: string }>()
  const request: Ga4ReportRequest = {
    eventReportingId: initial.reporting_id,
    campaignReportingIds: campaigns.results.map((row) => row.reporting_id),
    period: { range: query.range, start: period.start, end: period.end },
  }
  const finish = async (
    result: TrafficResponse["result"],
    cache: TrafficResponse["cache"]
  ) => {
    await dependencies.beforeReturn?.()
    const final = await db.batch([
      db
        .prepare(
          `SELECT e.id,e.reporting_id,e.time_zone FROM events e WHERE e.id=? AND ${reportAccess}`
        )
        .bind(eventId, actorId),
      campaignStatement(),
    ])
    const current = final[0]!.results[0] as Context | undefined
    if (
      !current ||
      current.reporting_id !== initial.reporting_id ||
      current.time_zone !== initial.time_zone ||
      JSON.stringify(
        (final[1]!.results as { reporting_id: string }[]).map(
          (row) => row.reporting_id
        )
      ) !== JSON.stringify(request.campaignReportingIds)
    )
      throw new ApiFailure(
        "NOT_FOUND",
        404,
        "The report or its current access changed. Reload the event."
      )
    return trafficResponseSchema.parse({
      eventId,
      eventTimeZone: current.time_zone,
      scope: "event_all_ticket_types",
      cache,
      result,
    })
  }
  if (!env.GA4_PROPERTY_ID || !env.GA4_SERVICE_ACCOUNT_JSON)
    return finish(unavailable(now, "not_configured"), "unavailable")

  // Only a digest of configuration is persisted; rotation separates old cached reports.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([
        env.GA4_PROPERTY_ID,
        env.GA4_SERVICE_ACCOUNT_JSON,
        request,
      ])
    )
  )
  const key = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
  const cached = await db
    .prepare(
      "SELECT result_json,fetched_at,expires_at,lease_until,touched_at FROM ga4_reports WHERE cache_key=? AND event_id=?"
    )
    .bind(key, eventId)
    .first<CacheRow>()
  if (cached && cached.touched_at > now)
    return finish(unavailable(now), "unavailable")
  if (
    cached?.result_json &&
    cached.expires_at > now &&
    cached.fetched_at !== null &&
    cached.fetched_at <= now
  ) {
    let candidate: unknown
    try {
      candidate = JSON.parse(cached.result_json)
    } catch {
      /* Corrupt cache is refreshed below. */
    }
    const result = scopedResult(candidate, request, now)
    if (result)
      return finish(
        result,
        result.status === "available" ? "cached" : "unavailable"
      )
  }
  // Evict an idle entry before admitting a new key; even concurrent distinct requests are capped.
  await db
    .prepare(`DELETE FROM ga4_reports WHERE event_id=? AND cache_key<>? AND lease_until<=? AND cache_key IN (
    SELECT cache_key FROM ga4_reports WHERE event_id=? AND cache_key<>? ORDER BY touched_at DESC,cache_key DESC LIMIT -1 OFFSET 31)`)
    .bind(eventId, key, now, eventId, key)
    .run()
  const token = crypto.randomUUID()
  const claimed = await db
    .prepare(`INSERT INTO ga4_reports(cache_key,event_id,expires_at,lease_token,lease_until,touched_at)
    SELECT ?,e.id,0,?,?,? FROM events e WHERE e.id=? AND ${reportAccess}
    AND (EXISTS (SELECT 1 FROM ga4_reports WHERE cache_key=?) OR (SELECT count(*) FROM ga4_reports WHERE event_id=e.id)<32)
    ON CONFLICT(cache_key) DO UPDATE SET lease_token=excluded.lease_token,lease_until=excluded.lease_until,touched_at=excluded.touched_at
    WHERE ga4_reports.lease_until<=? AND ga4_reports.touched_at<=?
      AND ga4_reports.result_json IS ? AND ga4_reports.fetched_at IS ?
    RETURNING cache_key`)
    .bind(
      key,
      token,
      now + leaseMs,
      now,
      eventId,
      actorId,
      key,
      now,
      now,
      cached?.result_json ?? null,
      cached?.fetched_at ?? null
    )
    .first()
  if (!claimed) return finish(unavailable(now), "unavailable")
  let result: TrafficResponse["result"]
  try {
    const provider =
      dependencies.provider ??
      createGa4Provider({
        propertyId: env.GA4_PROPERTY_ID,
        serviceAccountJson: env.GA4_SERVICE_ACCOUNT_JSON,
      })
    result =
      scopedResult(await provider.report(request), request, clock()) ??
      unavailable(clock(), "invalid_response")
  } catch {
    result = unavailable(clock(), "provider_unavailable")
  }
  const completedAt = clock()
  if (completedAt < now || completedAt >= now + leaseMs)
    return finish(unavailable(completedAt), "unavailable")
  const expiresAt =
    result.status === "available"
      ? Date.parse(result.fetchedAt) + hour
      : completedAt +
        Math.max(60, Math.min(3600, result.retryAfterSeconds ?? 60)) * 1000
  const saved = await db
    .prepare(`UPDATE ga4_reports SET result_json=?,fetched_at=?,expires_at=?,lease_token=NULL,lease_until=0,touched_at=?
    WHERE cache_key=? AND lease_token=? AND lease_until>? AND EXISTS (SELECT 1 FROM events e WHERE e.id=? AND e.reporting_id=? AND e.time_zone=? AND ${reportAccess})
    RETURNING cache_key`)
    .bind(
      JSON.stringify(result),
      completedAt,
      expiresAt,
      completedAt,
      key,
      token,
      completedAt,
      eventId,
      initial.reporting_id,
      initial.time_zone,
      actorId
    )
    .first()
  if (!saved) return finish(unavailable(completedAt), "unavailable")
  return finish(result, result.status === "available" ? "fresh" : "unavailable")
}

export async function cleanupTrafficReports(db: D1Database, now = Date.now()) {
  return db
    .prepare(`DELETE FROM ga4_reports WHERE cache_key IN (
    SELECT cache_key FROM ga4_reports WHERE touched_at<? AND lease_until<=? ORDER BY touched_at LIMIT 100)`)
    .bind(now - 7 * 24 * hour, now)
    .run()
}
