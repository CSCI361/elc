import { z } from "zod"
import { calendarDateSchema, reportingIdSchema } from "@elc/shared"

const oauthUrl = "https://oauth2.googleapis.com/token"
const scope = "https://www.googleapis.com/auth/analytics.readonly"
const eventDimension = "customEvent:event_reporting_id"
const campaignDimension = "customEvent:campaign_reporting_id"
const names = [
  "page_view",
  "view_item",
  "campaign_visit",
  "begin_checkout",
] as const
const countFields = [
  "pageViews",
  "eventViews",
  "campaignVisits",
  "checkoutStarts",
] as const
const dayMs = 86_400_000
export const ga4ProviderPolicy = Object.freeze({
  timeZone: "Asia/Almaty" as const,
  currency: "KZT" as const,
  maximumDays: 180,
  maximumCampaigns: 50,
  timeoutMs: 10_000,
  reportResponseBytes: 256 * 1024,
  tokenResponseBytes: 16 * 1024,
  refreshMarginMs: 60_000,
})
const periodSchema = z
  .strictObject({
    range: z.enum(["7", "30", "custom"]),
    start: calendarDateSchema,
    end: calendarDateSchema,
  })
  .refine((period) => {
    const days = (Date.parse(period.end) - Date.parse(period.start)) / dayMs + 1
    return (
      days >= 1 &&
      days <= ga4ProviderPolicy.maximumDays &&
      (period.range === "custom" || days === Number(period.range))
    )
  })
export const ga4ProviderRequestSchema = z
  .strictObject({
    eventReportingId: reportingIdSchema,
    campaignReportingIds: z
      .array(reportingIdSchema)
      .max(ga4ProviderPolicy.maximumCampaigns)
      .readonly(),
    period: periodSchema,
  })
  .refine(
    (value) =>
      new Set(value.campaignReportingIds).size ===
      value.campaignReportingIds.length
  )
export type Ga4ReportRequest = z.infer<typeof ga4ProviderRequestSchema>
export type Ga4Counts = Readonly<Record<(typeof countFields)[number], number>>
export type Ga4UnavailableReason =
  | "not_configured"
  | "invalid_configuration"
  | "invalid_request"
  | "clock_error"
  | "authorization_failed"
  | "rate_limited"
  | "provider_unavailable"
  | "timeout"
  | "redirect_blocked"
  | "invalid_response"
  | "property_mismatch"
  | "data_unavailable"
export type Ga4ReportResult =
  | Readonly<{
      status: "available"
      source: "ga4"
      eventReportingId: string
      period: Readonly<Ga4ReportRequest["period"] & { dayCount: number }>
      timeZone: "Asia/Almaty"
      currency: "KZT"
      currencyVerified: boolean
      fetchedAt: string
      dataAsOf: null
      processingDelayPossible: true
      quality: Readonly<{
        subjectToThresholding: boolean
        sampled: boolean
        dataLossFromOtherRow: boolean
      }>
      totals: Ga4Counts
      daily: readonly Readonly<Ga4Counts & { date: string }>[]
      campaigns: readonly Readonly<
        Ga4Counts & { campaignReportingId: string }
      >[]
    }>
  | Readonly<{
      status: "unavailable"
      source: "ga4"
      reason: Ga4UnavailableReason
      retryable: boolean
      retryAfterSeconds: number | null
      checkedAt: string | null
    }>
export type Ga4ProviderConfiguration = Readonly<{
  propertyId?: string
  serviceAccountJson?: string
}>
export type Ga4Provider = {
  report: (request: Ga4ReportRequest) => Promise<Ga4ReportResult>
}
type Dependencies = { fetch?: typeof fetch; now?: () => number }
class ProviderFailure extends Error {
  readonly reason: Ga4UnavailableReason
  readonly retryable: boolean
  readonly retryAfterSeconds: number | null
  constructor(
    reason: Ga4UnavailableReason,
    retryable = false,
    retryAfterSeconds: number | null = null
  ) {
    super("The scoped analytics report is unavailable.")
    this.reason = reason
    this.retryable = retryable
    this.retryAfterSeconds = retryAfterSeconds
  }
}
const configSchema = z.strictObject({
  propertyId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  serviceAccountJson: z
    .string()
    .min(1)
    .max(32 * 1024),
})
const credentialsSchema = z.object({
  type: z.literal("service_account"),
  client_email: z
    .email()
    .max(254)
    .refine((value) => value.endsWith(".gserviceaccount.com")),
  private_key: z
    .string()
    .min(1)
    .max(16 * 1024),
  private_key_id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .optional(),
  token_uri: z.literal(oauthUrl).optional(),
  universe_domain: z.literal("googleapis.com").optional(),
})
const tokenSchema = z.object({
  access_token: z
    .string()
    .min(1)
    .max(8192)
    .regex(/^[A-Za-z0-9._~+/-]+={0,2}$/),
  token_type: z.literal("Bearer"),
  expires_in: z.int().min(1).max(3600),
  scope: z.literal(scope).optional(),
})
const integerString = z.string().regex(/^(0|[1-9][0-9]{0,19})$/)
const reportSchema = z.object({
  dimensionHeaders: z.array(z.object({ name: z.string().max(128) })).length(3),
  metricHeaders: z
    .array(
      z.object({
        name: z.literal("eventCount"),
        type: z.literal("TYPE_INTEGER"),
      })
    )
    .length(1),
  rows: z
    .array(
      z.object({
        dimensionValues: z
          .array(z.object({ value: z.string().max(128) }))
          .length(3),
        metricValues: z.array(z.object({ value: integerString })).length(1),
      })
    )
    .max(720)
    .default([]),
  rowCount: z.int().min(0).max(720).default(0),
  metadata: z.object({
    timeZone: z.string().max(128),
    currencyCode: z.string().max(3).optional(),
    emptyReason: z.string().max(2048).optional(),
    subjectToThresholding: z.boolean().default(false),
    dataLossFromOtherRow: z.boolean().default(false),
    samplingMetadatas: z
      .array(
        z.object({
          samplesReadCount: integerString,
          samplingSpaceSize: integerString,
        })
      )
      .max(1)
      .default([]),
    schemaRestrictionResponse: z
      .object({
        activeMetricRestrictions: z.array(z.unknown()).max(100).default([]),
      })
      .optional(),
  }),
})
type ParsedReport = z.infer<typeof reportSchema>
type MutableCounts = Record<(typeof countFields)[number], number>
const counts = (): MutableCounts => ({
  pageViews: 0,
  eventViews: 0,
  campaignVisits: 0,
  checkoutStarts: 0,
})
function safeCount(value: string): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 0)
    throw new ProviderFailure("invalid_response")
  return result
}
function add(target: MutableCounts, event: string, count: number) {
  const index = names.findIndex((value) => value === event)
  if (index < 0) throw new ProviderFailure("invalid_response")
  const field = countFields[index]!,
    result = target[field] + count
  if (!Number.isSafeInteger(result))
    throw new ProviderFailure("invalid_response")
  target[field] = result
}
function base64url(value: Uint8Array): string {
  return btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join(""))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
}
const encoded = (value: unknown) =>
  base64url(new TextEncoder().encode(JSON.stringify(value)))
async function signingKey(pem: string): Promise<CryptoKey> {
  const match =
    /^-----BEGIN PRIVATE KEY-----\r?\n([A-Za-z0-9+/=\r\n]+)-----END PRIVATE KEY-----\r?\n?$/.exec(
      pem
    )
  if (!match) throw new ProviderFailure("invalid_configuration")
  try {
    const base64 = match[1]!.replace(/[\r\n]/g, ""),
      raw = atob(base64)
    if (btoa(raw) !== base64 || raw.length > 8192)
      throw new Error("Invalid key")
    const key = await crypto.subtle.importKey(
      "pkcs8",
      Uint8Array.from(raw, (character) => character.charCodeAt(0)),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    )
    const algorithm = key.algorithm as RsaHashedKeyAlgorithm
    if (algorithm.modulusLength < 2048 || algorithm.modulusLength > 4096)
      throw new Error("Invalid key")
    return key
  } catch {
    throw new ProviderFailure("invalid_configuration")
  }
}
function dateInAlmaty(at: number): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: ga4ProviderPolicy.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at)
  const part = (name: string) =>
    parts.find((value) => value.type === name)!.value
  return `${part("year")}-${part("month")}-${part("day")}`
}
function reportRequest(input: Ga4ReportRequest, campaigns: boolean) {
  const filters = [
    {
      filter: {
        fieldName: eventDimension,
        stringFilter: {
          matchType: "EXACT",
          value: input.eventReportingId,
          caseSensitive: true,
        },
      },
    },
    {
      filter: {
        fieldName: "eventName",
        inListFilter: { values: [...names], caseSensitive: true },
      },
    },
    ...(campaigns
      ? [
          {
            filter: {
              fieldName: campaignDimension,
              inListFilter: {
                values: [...input.campaignReportingIds].sort(),
                caseSensitive: true,
              },
            },
          },
        ]
      : []),
  ]
  return {
    dateRanges: [{ startDate: input.period.start, endDate: input.period.end }],
    dimensions: (campaigns
      ? [campaignDimension, "eventName", eventDimension]
      : ["date", "eventName", eventDimension]
    ).map((name) => ({ name })),
    metrics: [{ name: "eventCount" }],
    dimensionFilter: { andGroup: { expressions: filters } },
    limit: String(
      campaigns ? input.campaignReportingIds.length * names.length : 720
    ),
    keepEmptyRows: false,
    // Omit currencyCode: Google would echo it instead of exposing the property's default.
  }
}
function parsedReport(
  value: unknown,
  input: Ga4ReportRequest,
  campaigns: boolean
): ParsedReport {
  const parsed = reportSchema.safeParse(value)
  if (!parsed.success) throw new ProviderFailure("invalid_response")
  const report = parsed.data,
    expected = campaigns
      ? [campaignDimension, "eventName", eventDimension]
      : ["date", "eventName", eventDimension]
  if (
    report.dimensionHeaders.some(
      (header, index) => header.name !== expected[index]
    ) ||
    report.rows.length !== report.rowCount ||
    report.rowCount > (campaigns ? input.campaignReportingIds.length * 4 : 720)
  )
    throw new ProviderFailure("invalid_response")
  if (
    report.metadata.timeZone !== ga4ProviderPolicy.timeZone ||
    (report.metadata.currencyCode !== undefined &&
      report.metadata.currencyCode !== ga4ProviderPolicy.currency)
  )
    throw new ProviderFailure("property_mismatch")
  if (
    report.metadata.emptyReason ||
    report.metadata.schemaRestrictionResponse?.activeMetricRestrictions.length
  )
    throw new ProviderFailure("data_unavailable", true, 3600)
  const seen = new Set<string>()
  for (const row of report.rows) {
    const [first, event, reportingId] = row.dimensionValues.map(
      (dimension) => dimension.value
    )
    if (
      reportingId !== input.eventReportingId ||
      !names.some((name) => name === event)
    )
      throw new ProviderFailure("invalid_response")
    if (campaigns) {
      if (!input.campaignReportingIds.includes(first!))
        throw new ProviderFailure("invalid_response")
    } else {
      if (!/^[0-9]{8}$/.test(first!))
        throw new ProviderFailure("invalid_response")
      const date = `${first!.slice(0, 4)}-${first!.slice(4, 6)}-${first!.slice(6, 8)}`
      if (
        !calendarDateSchema.safeParse(date).success ||
        date < input.period.start ||
        date > input.period.end
      )
        throw new ProviderFailure("invalid_response")
    }
    const key = `${first}:${event}`
    if (seen.has(key)) throw new ProviderFailure("invalid_response")
    seen.add(key)
    safeCount(row.metricValues[0]!.value)
  }
  for (const sample of report.metadata.samplingMetadatas) {
    if (
      BigInt(sample.samplesReadCount) > BigInt(sample.samplingSpaceSize) ||
      BigInt(sample.samplingSpaceSize) === 0n
    )
      throw new ProviderFailure("invalid_response")
  }
  return report
}

/** Credentials are deployment configuration. Call only after resolving report access and campaign ownership on the server. Collection is limited separately to public events. */
export function createGa4Provider(
  configuration: Ga4ProviderConfiguration,
  dependencies: Dependencies = {}
): Ga4Provider {
  const fetcher = dependencies.fetch ?? fetch,
    now = dependencies.now ?? Date.now
  const config = configSchema.safeParse(configuration)
  let credentials: z.infer<typeof credentialsSchema> | null = null
  if (config.success) {
    try {
      const parsed = credentialsSchema.safeParse(
        JSON.parse(config.data.serviceAccountJson)
      )
      if (parsed.success) credentials = parsed.data
    } catch {
      /* Invalid credentials never reach a transport. */
    }
  }
  const missing = !configuration.propertyId || !configuration.serviceAccountJson
  let key: Promise<CryptoKey> | undefined
  let token: { value: string; expiresAt: number } | undefined
  let pendingToken: Promise<string> | undefined
  let lastObservedAt: number | null = null
  const clock = () => {
    const at = now()
    if (
      !Number.isSafeInteger(at) ||
      at < 0 ||
      at > 8_640_000_000_000_000 ||
      (lastObservedAt !== null && at < lastObservedAt)
    ) {
      token = undefined
      throw new ProviderFailure("clock_error", true)
    }
    lastObservedAt = at
    return at
  }
  async function json(
    url: string,
    init: RequestInit,
    maximumBytes: number
  ): Promise<unknown> {
    const controller = new AbortController()
    let expired = false,
      reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        expired = true
        controller.abort()
        void reader?.cancel().catch(() => undefined)
        reject(new ProviderFailure("timeout", true, 60))
      }, ga4ProviderPolicy.timeoutMs)
    })
    try {
      return await Promise.race([
        timeout,
        (async () => {
          let response: Response
          try {
            response = await fetcher(url, {
              ...init,
              redirect: "manual",
              credentials: "omit",
              cache: "no-store",
              signal: controller.signal,
            })
          } catch {
            throw new ProviderFailure(
              expired ? "timeout" : "provider_unavailable",
              true,
              60
            )
          }
          const cancel = () => {
            void response.body?.cancel().catch(() => undefined)
          }
          if (expired) {
            cancel()
            throw new ProviderFailure("timeout", true, 60)
          }
          if (
            response.redirected ||
            (response.url && response.url !== url) ||
            (response.status >= 300 && response.status < 400)
          ) {
            cancel()
            throw new ProviderFailure("redirect_blocked")
          }
          if (!response.ok) {
            cancel()
            const retry = response.headers.get("Retry-After") ?? ""
            const delay = /^[0-9]{1,5}$/.test(retry)
              ? Math.max(1, Math.min(3600, Number(retry)))
              : 60
            if (response.status === 429)
              throw new ProviderFailure("rate_limited", true, delay)
            if (response.status >= 500 || response.status === 408)
              throw new ProviderFailure("provider_unavailable", true, delay)
            if ([400, 401, 403, 404].includes(response.status))
              throw new ProviderFailure("authorization_failed")
            throw new ProviderFailure("provider_unavailable")
          }
          const length = response.headers.get("Content-Length"),
            contentType = response.headers
              .get("Content-Type")
              ?.split(";")[0]
              ?.trim()
              .toLowerCase()
          if (
            contentType !== "application/json" ||
            (length !== null &&
              (!/^[0-9]{1,12}$/.test(length) ||
                Number(length) > maximumBytes)) ||
            !response.body
          ) {
            cancel()
            throw new ProviderFailure("invalid_response")
          }
          reader = response.body.getReader()
          const decoder = new TextDecoder("utf-8", { fatal: true })
          let size = 0,
            text = ""
          try {
            for (;;) {
              const chunk = await reader.read()
              if (expired) throw new ProviderFailure("timeout", true, 60)
              if (chunk.done) break
              size += chunk.value.byteLength
              if (size > maximumBytes)
                throw new ProviderFailure("invalid_response")
              text += decoder.decode(chunk.value, { stream: true })
            }
            text += decoder.decode()
            return JSON.parse(text) as unknown
          } catch (error) {
            void reader.cancel().catch(() => undefined)
            throw error instanceof ProviderFailure
              ? error
              : new ProviderFailure("invalid_response")
          }
        })(),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
  async function accessToken(): Promise<string> {
    const at = clock()
    if (token && at < token.expiresAt - ga4ProviderPolicy.refreshMarginMs)
      return token.value
    if (pendingToken) return pendingToken
    const issue = async () => {
      if (!credentials) throw new ProviderFailure("invalid_configuration")
      key ??= signingKey(credentials.private_key)
      const signing = await key,
        issued = clock(),
        seconds = Math.floor(issued / 1000)
      const unsigned = `${encoded({ alg: "RS256", typ: "JWT", ...(credentials.private_key_id ? { kid: credentials.private_key_id } : {}) })}.${encoded({ iss: credentials.client_email, scope, aud: oauthUrl, iat: seconds, exp: seconds + 3600 })}`
      const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        signing,
        new TextEncoder().encode(unsigned)
      )
      clock()
      const body = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${base64url(new Uint8Array(signature))}`,
      }).toString()
      const result = tokenSchema.safeParse(
        await json(
          oauthUrl,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
          },
          ga4ProviderPolicy.tokenResponseBytes
        )
      )
      if (!result.success) throw new ProviderFailure("invalid_response")
      const expiresAt = issued + result.data.expires_in * 1000
      if (clock() >= expiresAt - ga4ProviderPolicy.refreshMarginMs)
        throw new ProviderFailure("authorization_failed", true, 60)
      token = { value: result.data.access_token, expiresAt }
      return token.value
    }
    pendingToken = issue()
    try {
      return await pendingToken
    } finally {
      pendingToken = undefined
    }
  }
  const unavailable = (error: ProviderFailure): Ga4ReportResult =>
    Object.freeze({
      status: "unavailable",
      source: "ga4",
      reason: error.reason,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
      checkedAt:
        lastObservedAt === null ? null : new Date(lastObservedAt).toISOString(),
    })
  return {
    async report(raw): Promise<Ga4ReportResult> {
      try {
        const started = clock()
        if (missing) throw new ProviderFailure("not_configured")
        if (!config.success || !credentials)
          throw new ProviderFailure("invalid_configuration")
        const parsed = ga4ProviderRequestSchema.safeParse(raw)
        if (!parsed.success || parsed.data.period.end > dateInAlmaty(started))
          throw new ProviderFailure("invalid_request")
        const input = parsed.data,
          url = `https://analyticsdata.googleapis.com/v1beta/properties/${config.data.propertyId}:runReport`
        const run = async (campaigns: boolean) => {
          const authorization = await accessToken()
          if (
            !token ||
            clock() >= token.expiresAt - ga4ProviderPolicy.refreshMarginMs
          )
            throw new ProviderFailure("authorization_failed", true, 60)
          try {
            return parsedReport(
              await json(
                url,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${authorization}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(reportRequest(input, campaigns)),
                },
                ga4ProviderPolicy.reportResponseBytes
              ),
              input,
              campaigns
            )
          } catch (error) {
            if (
              error instanceof ProviderFailure &&
              error.reason === "authorization_failed" &&
              token?.value === authorization
            )
              token = undefined
            throw error
          }
        }
        const dailyReport = await run(false),
          campaignReport = input.campaignReportingIds.length
            ? await run(true)
            : null
        const totals = counts(),
          daily = new Map<string, MutableCounts>(),
          campaigns = new Map<string, MutableCounts>()
        const dayCount =
          (Date.parse(input.period.end) - Date.parse(input.period.start)) /
            dayMs +
          1
        for (let index = 0; index < dayCount; index++)
          daily.set(
            new Date(Date.parse(input.period.start) + index * dayMs)
              .toISOString()
              .slice(0, 10),
            counts()
          )
        for (const id of [...input.campaignReportingIds].sort())
          campaigns.set(id, counts())
        for (const row of dailyReport.rows) {
          const [day, name] = row.dimensionValues.map(
              (dimension) => dimension.value
            ),
            date = `${day!.slice(0, 4)}-${day!.slice(4, 6)}-${day!.slice(6, 8)}`,
            count = safeCount(row.metricValues[0]!.value)
          add(daily.get(date)!, name!, count)
          add(totals, name!, count)
        }
        for (const row of campaignReport?.rows ?? []) {
          const [id, name] = row.dimensionValues.map(
            (dimension) => dimension.value
          )
          add(campaigns.get(id!)!, name!, safeCount(row.metricValues[0]!.value))
        }
        const reports = campaignReport
          ? [dailyReport, campaignReport]
          : [dailyReport]
        return Object.freeze({
          status: "available",
          source: "ga4",
          eventReportingId: input.eventReportingId,
          period: Object.freeze({ ...input.period, dayCount }),
          timeZone: ga4ProviderPolicy.timeZone,
          currency: ga4ProviderPolicy.currency,
          currencyVerified: reports.every(
            (report) =>
              report.metadata.currencyCode === ga4ProviderPolicy.currency
          ),
          fetchedAt: new Date(clock()).toISOString(),
          dataAsOf: null,
          processingDelayPossible: true,
          quality: Object.freeze({
            subjectToThresholding: reports.some(
              (report) => report.metadata.subjectToThresholding
            ),
            dataLossFromOtherRow: reports.some(
              (report) => report.metadata.dataLossFromOtherRow
            ),
            sampled: reports.some((report) =>
              report.metadata.samplingMetadatas.some(
                (sample) =>
                  BigInt(sample.samplesReadCount) <
                  BigInt(sample.samplingSpaceSize)
              )
            ),
          }),
          totals: Object.freeze(totals),
          daily: Object.freeze(
            [...daily].map(([date, value]) => Object.freeze({ date, ...value }))
          ),
          campaigns: Object.freeze(
            [...campaigns].map(([campaignReportingId, value]) =>
              Object.freeze({ campaignReportingId, ...value })
            )
          ),
        })
      } catch (error) {
        return unavailable(
          error instanceof ProviderFailure
            ? error
            : new ProviderFailure("provider_unavailable", true, 60)
        )
      }
    },
  }
}
