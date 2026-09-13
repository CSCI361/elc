import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { createAuthTestDatabase } from "../auth/test-database"
import { addCalendarDays, calendarDateAt } from "../reporting/dates"
import { cleanupTrafficReports, readEventTraffic } from "./read"
import type { Ga4ReportRequest, Ga4ReportResult } from "./provider"

describe("authorized GA4 report cache in D1", () => {
  let f: Awaited<ReturnType<typeof createAuthTestDatabase>>
  let now: number, calls: Ga4ReportRequest[]
  let respond: (request: Ga4ReportRequest) => Promise<Ga4ReportResult>
  const env = () => ({
    DB: f.DB,
    GA4_PROPERTY_ID: "123",
    GA4_SERVICE_ACCOUNT_JSON: "synthetic-test-config",
  })
  const read = (
    query: unknown = {},
    actor = "owner",
    beforeReturn?: () => Promise<void>
  ) =>
    readEventTraffic(env(), actor, "event", query, {
      now: () => now,
      beforeReturn,
      provider: {
        report: async (request) => {
          calls.push(request)
          return respond(request)
        },
      },
    })
  function result(request: Ga4ReportRequest): Ga4ReportResult {
    const dayCount =
      (Date.parse(request.period.end) - Date.parse(request.period.start)) /
        86_400_000 +
      1
    const counts = {
      pageViews: 3,
      eventViews: 2,
      campaignVisits: 1,
      checkoutStarts: 1,
    }
    return {
      status: "available",
      source: "ga4",
      eventReportingId: request.eventReportingId,
      period: { ...request.period, dayCount },
      timeZone: "Asia/Almaty",
      currency: "KZT",
      currencyVerified: true,
      fetchedAt: new Date(now).toISOString(),
      dataAsOf: null,
      processingDelayPossible: true,
      quality: {
        sampled: false,
        subjectToThresholding: false,
        dataLossFromOtherRow: false,
      },
      totals: {
        pageViews: 3 * dayCount,
        eventViews: 2 * dayCount,
        campaignVisits: dayCount,
        checkoutStarts: dayCount,
      },
      daily: Array.from({ length: dayCount }, (_, index) => ({
        ...counts,
        date: addCalendarDays(request.period.start, index),
      })),
      campaigns: request.campaignReportingIds.map((campaignReportingId) => ({
        ...counts,
        campaignReportingId,
      })),
    }
  }
  beforeEach(async () => {
    f = await createAuthTestDatabase()
    now = Date.parse("2026-09-13T10:00:00Z")
    calls = []
    respond = async (request) => result(request)
    for (const id of ["owner", "other"])
      await f.DB.prepare(
        "INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,1,?,?)"
      )
        .bind(id, id, `${id}@example.test`, now, now)
        .run()
    await f.DB.prepare(`INSERT INTO events (id,organizer_id,title,description,category,venue_name,venue_address,
      starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,calendar_uid,reporting_id,created_at,updated_at)
      VALUES ('event','owner','Synthetic','Description','Music','Hall','Address',?,?,?,?,10,'calendar','rpt_event0001',?,?)`)
      .bind(
        now + 3600000,
        now + 7200000,
        now - 3600000,
        now + 3600000,
        now,
        now
      )
      .run()
  })
  afterEach(async () => {
    await f?.runtime.dispose()
  })
  async function grant(permission: string) {
    await f.DB.prepare(
      "INSERT INTO event_permissions(event_id,user_id,permission,granted_at) VALUES ('event','other',?,?)"
    )
      .bind(permission, now)
      .run()
  }
  async function campaign(id: string) {
    await f.DB.prepare(`INSERT INTO campaigns(id,event_id,name,code,token_hash,reporting_id,discount_kind,discount_value,starts_at,ends_at,max_redemptions,enabled,updated_at)
      VALUES (?,'event',?,?,?,?,'percentage',1000,?,?,100,0,?)`)
      .bind(
        id,
        id,
        id,
        `hash-${id}`,
        `rpt_campaign_${id}`,
        now - 1000,
        now + 1000,
        now
      )
      .run()
  }
  it("caches successful results for one hour and reuses them across authorized users", async () => {
    const first = await read()
    expect(first.cache).toBe("fresh")
    expect(first.result).toMatchObject({
      status: "available",
      totals: { pageViews: 90 },
    })
    await grant("analytics:read")
    now += 3599999
    expect((await read({}, "other")).cache).toBe("cached")
    expect(calls).toHaveLength(1)
    now += 1
    expect((await read()).cache).toBe("fresh")
    expect(calls).toHaveLength(2)
  })
  it("denies unrelated users and event managers before provider access", async () => {
    await expect(read({}, "other")).rejects.toMatchObject({ status: 404 })
    await grant("event:manage")
    await expect(read({}, "other")).rejects.toMatchObject({ status: 404 })
    expect(calls).toHaveLength(0)
  })
  it.each(["revoked", "suspended", "unverified"])(
    "rechecks %s authority after provider fetch and on cache reads",
    async (kind) => {
      await grant("analytics:read")
      const remove = async () => {
        if (kind === "revoked")
          await f.DB.prepare(
            "UPDATE event_permissions SET revoked_at=? WHERE user_id='other'"
          )
            .bind(now)
            .run()
        if (kind === "unverified")
          await f.DB.prepare(
            "UPDATE user SET email_verified=0 WHERE id='other'"
          ).run()
        if (kind === "suspended")
          await f.DB.prepare(
            "INSERT INTO profiles(user_id,suspended_at,updated_at) VALUES ('other',?,?)"
          )
            .bind(now, now)
            .run()
      }
      await read()
      await expect(read({}, "other", remove)).rejects.toMatchObject({
        status: 404,
      })
      expect(calls).toHaveLength(1)
      respond = async (request) => {
        await remove()
        return result(request)
      }
      await f.DB.prepare("DELETE FROM profiles WHERE user_id='other'").run()
      await f.DB.prepare(
        "UPDATE user SET email_verified=1 WHERE id='other'"
      ).run()
      await f.DB.prepare(
        "UPDATE event_permissions SET revoked_at=NULL WHERE user_id='other'"
      ).run()
      now += 3600000
      await expect(read({}, "other")).rejects.toMatchObject({ status: 404 })
    }
  )
  it("reports missing configuration without caching fake zero counts", async () => {
    const response = await readEventTraffic(
      { DB: f.DB },
      "owner",
      "event",
      {},
      { now: () => now }
    )
    expect(response.result).toMatchObject({
      status: "unavailable",
      reason: "not_configured",
    })
    expect(
      await f.DB.prepare("SELECT count(*) n FROM ga4_reports").first("n")
    ).toBe(0)
  })
  it("uses the event's selected dates while labelling the property's separate time zone", async () => {
    now = Date.parse("2026-09-13T01:00:00Z")
    await f.DB.prepare(
      "UPDATE events SET time_zone='America/Los_Angeles' WHERE id='event'"
    ).run()
    const response = await read({ range: "7" })
    expect(response).toMatchObject({
      eventTimeZone: "America/Los_Angeles",
      result: {
        timeZone: "Asia/Almaty",
        period: { start: "2026-09-06", end: "2026-09-12" },
      },
    })
  })
  it("binds campaign pages on the server and ignores ticket-type filters for GA4", async () => {
    await campaign("a")
    await campaign("b")
    await read({ limit: 1 })
    await read({ limit: 1, campaignAfter: "a", ticketTypeId: "some-type" })
    expect(calls.map((call) => call.campaignReportingIds)).toEqual([
      ["rpt_campaign_a"],
      ["rpt_campaign_b"],
    ])
    expect((await read({ limit: 1, campaignAfter: "a" })).cache).toBe("cached")
    expect(calls).toHaveLength(2)
  })
  it.each([
    "foreign_event",
    "foreign_campaign",
    "bad_total",
    "missing_day",
    "future_fetch",
  ])("rejects %s provider results", async (kind) => {
    respond = async (request) => {
      const value = result(request)
      if (value.status !== "available") throw new Error("Fixture")
      if (kind === "foreign_event")
        return { ...value, eventReportingId: "rpt_other0001" }
      if (kind === "foreign_campaign")
        return {
          ...value,
          campaigns: [
            { ...value.totals, campaignReportingId: "rpt_other0001" },
          ],
        }
      if (kind === "bad_total")
        return { ...value, totals: { ...value.totals, pageViews: 999 } }
      if (kind === "missing_day")
        return { ...value, daily: value.daily.slice(1) }
      return { ...value, fetchedAt: new Date(now + 1).toISOString() }
    }
    expect((await read()).result).toMatchObject({
      status: "unavailable",
      reason: "invalid_response",
    })
  })
  it("refreshes corrupted cached scope instead of returning it", async () => {
    await read()
    await f.DB.prepare(
      "UPDATE ga4_reports SET result_json=json_set(result_json,'$.eventReportingId','rpt_other0001')"
    ).run()
    expect((await read()).result).toMatchObject({
      eventReportingId: "rpt_event0001",
    })
    expect(calls).toHaveLength(2)
  })
  it("leases concurrent requests and discards an expired worker's result", async () => {
    let release!: () => void, started!: () => void
    const start = new Promise<void>((resolve) => {
      started = resolve
    })
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    respond = async (request) => {
      started()
      await hold
      return result(request)
    }
    const first = read()
    await start
    expect((await read()).result.status).toBe("unavailable")
    expect(calls).toHaveLength(1)
    now += 60000
    respond = async (request) => result(request)
    expect((await read()).cache).toBe("fresh")
    release()
    expect((await first).result.status).toBe("unavailable")
    expect((await read()).cache).toBe("cached")
  })
  it("backs off provider failures without replacing them with zeros or exposing errors", async () => {
    respond = async () => {
      throw new Error("private provider credential")
    }
    expect(JSON.stringify(await read())).not.toContain("private provider")
    expect((await read()).result).toMatchObject({
      status: "unavailable",
      reason: "provider_unavailable",
    })
    expect(calls).toHaveLength(1)
    now += 60000
    respond = async (request) => result(request)
    expect((await read()).cache).toBe("fresh")
  })
  it("separates rotated deployment credentials from previous cache entries", async () => {
    await read()
    const response = await readEventTraffic(
      { ...env(), GA4_PROPERTY_ID: "456" },
      "owner",
      "event",
      {},
      {
        now: () => now,
        provider: {
          report: async (request) => {
            calls.push(request)
            return result(request)
          },
        },
      }
    )
    expect(response.cache).toBe("fresh")
    expect(calls).toHaveLength(2)
    const saved = JSON.stringify(
      (await f.DB.prepare("SELECT * FROM ga4_reports").all()).results
    )
    expect(saved).not.toContain("synthetic-test-config")
  })
  it("caps custom-range cache entries and cleans old idle rows", async () => {
    const day = calendarDateAt(now, "Asia/Almaty")
    for (let index = 0; index < 35; index++) {
      const date = addCalendarDays(day, -index)
      await read({ range: "custom", start: date, end: date })
      now += 1
    }
    expect(
      await f.DB.prepare("SELECT count(*) n FROM ga4_reports").first("n")
    ).toBe(32)
    now += 8 * 86400000
    await cleanupTrafficReports(f.DB, now)
    expect(
      await f.DB.prepare("SELECT count(*) n FROM ga4_reports").first("n")
    ).toBe(0)
  })
  it("rejects invalid date ranges before making provider calls", async () => {
    await expect(
      read({ range: "custom", start: "2026-09-13", end: "2026-09-12" })
    ).rejects.toMatchObject({ status: 400 })
    expect(calls).toHaveLength(0)
  })
  it("does not reuse a cached result or steal a lease after a backward clock change", async () => {
    await read()
    now -= 1000
    expect((await read()).result.status).toBe("unavailable")
    expect(calls).toHaveLength(1)
  })
  it("rejects campaign ownership changes while a provider request is pending", async () => {
    await campaign("a")
    respond = async (request) => {
      await f.DB.prepare(
        "UPDATE campaigns SET reporting_id='rpt_changed0001' WHERE id='a'"
      ).run()
      return result(request)
    }
    await expect(read()).rejects.toMatchObject({ status: 404 })
  })
})
