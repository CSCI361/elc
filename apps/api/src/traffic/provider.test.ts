import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test"
import {
  createGa4Provider,
  ga4ProviderPolicy,
  type Ga4ProviderConfiguration,
  type Ga4ReportRequest,
} from "./provider"

const oauthUrl = "https://oauth2.googleapis.com/token"
const reportUrl =
  "https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport"
const scope = "https://www.googleapis.com/auth/analytics.readonly"
const eventDimension = "customEvent:event_reporting_id"
const campaignDimension = "customEvent:campaign_reporting_id"
const reportingId = "rpt_event000001",
  firstCampaign = "rpt_campaign0001",
  secondCampaign = "rpt_campaign0002"
const initialNow = Date.parse("2026-09-13T12:00:00Z")
const input: Ga4ReportRequest = {
  eventReportingId: reportingId,
  campaignReportingIds: [secondCampaign, firstCampaign],
  period: { range: "7", start: "2026-09-07", end: "2026-09-13" },
}
let pair: CryptoKeyPair,
  credentials: Record<string, string>,
  configuration: Ga4ProviderConfiguration,
  now: number
beforeAll(async () => {
  pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  )
  const bytes = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey)
  )
  const body = btoa(
    Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")
  )
  credentials = {
    type: "service_account",
    client_email: "elc-reader@synthetic-project.iam.gserviceaccount.com",
    private_key: `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`,
    private_key_id: "synthetic-key-id",
    token_uri: oauthUrl,
    universe_domain: "googleapis.com",
    project_id: "synthetic-project",
  }
  configuration = {
    propertyId: "123456789",
    serviceAccountJson: JSON.stringify(credentials),
  }
})
beforeEach(() => {
  now = initialNow
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
const json = (
  value: unknown,
  status = 200,
  headers: Record<string, string> = {}
) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
const row = (
  value: string,
  name: string,
  count: string | number,
  event = reportingId
) => ({
  dimensionValues: [{ value }, { value: name }, { value: event }],
  metricValues: [{ value: String(count) }],
})
const report = (
  campaigns = false,
  rows = campaigns
    ? [
        row(firstCampaign, "page_view", 2),
        row(secondCampaign, "campaign_visit", 1),
      ]
    : [
        row("20260911", "page_view", 5),
        row("20260911", "view_item", 3),
        row("20260912", "campaign_visit", 2),
        row("20260913", "begin_checkout", 1),
      ]
) => ({
  dimensionHeaders: [
    campaigns ? campaignDimension : "date",
    "eventName",
    eventDimension,
  ].map((name) => ({ name })),
  metricHeaders: [{ name: "eventCount", type: "TYPE_INTEGER" }],
  rows,
  rowCount: rows.length,
  metadata: { timeZone: "Asia/Almaty", currencyCode: "KZT" },
})
const oauth = () =>
  json({
    access_token: "synthetic_access_token",
    token_type: "Bearer",
    expires_in: 3600,
    scope,
  })
const stringValue = (value: unknown): string => {
  if (typeof value !== "string")
    throw new Error("Expected a string transport value")
  return value
}
const defaultFetch: typeof fetch = async (url, init) =>
  stringValue(url) === oauthUrl
    ? oauth()
    : json(
        report(
          JSON.parse(stringValue(init!.body)).dimensions[0].name ===
            campaignDimension
        )
      )
const stub = (implementation: typeof fetch = defaultFetch) =>
  vi.fn(implementation)
const provider = (fetcher: typeof fetch, config = configuration) =>
  createGa4Provider(config, { fetch: fetcher, now: () => now })
const decode = (part: string) =>
  Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (value) =>
    value.charCodeAt(0)
  )

describe("GA4 property-scoped protocol and OAuth", () => {
  it("signs only readonly claims with RS256 and validates the actual signature", async () => {
    const fetcher = stub()
    expect((await provider(fetcher).report(input)).status).toBe("available")
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe(oauthUrl)
    expect(init).toMatchObject({
      method: "POST",
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
    })
    expect(new Headers(init!.headers).get("Content-Type")).toBe(
      "application/x-www-form-urlencoded"
    )
    const form = new URLSearchParams(stringValue(init!.body))
    expect([...form.keys()].sort()).toEqual(["assertion", "grant_type"])
    expect(form.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer"
    )
    const [header, claims, signature] = form.get("assertion")!.split(".")
    expect(JSON.parse(new TextDecoder().decode(decode(header!)))).toEqual({
      alg: "RS256",
      typ: "JWT",
      kid: "synthetic-key-id",
    })
    expect(JSON.parse(new TextDecoder().decode(decode(claims!)))).toEqual({
      iss: credentials.client_email,
      scope,
      aud: oauthUrl,
      iat: initialNow / 1000,
      exp: initialNow / 1000 + 3600,
    })
    expect(
      await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        pair.publicKey,
        decode(signature!),
        new TextEncoder().encode(`${header}.${claims}`)
      )
    ).toBe(true)
  })
  it("requests only exact event counts and narrows only the campaign breakdown", async () => {
    const fetcher = stub()
    const result = await provider(fetcher).report(input)
    expect(fetcher).toHaveBeenCalledTimes(3)
    const daily = JSON.parse(stringValue(fetcher.mock.calls[1]![1]!.body)),
      campaigns = JSON.parse(stringValue(fetcher.mock.calls[2]![1]!.body))
    const common = [
      {
        filter: {
          fieldName: eventDimension,
          stringFilter: {
            matchType: "EXACT",
            value: reportingId,
            caseSensitive: true,
          },
        },
      },
      {
        filter: {
          fieldName: "eventName",
          inListFilter: {
            values: [
              "page_view",
              "view_item",
              "campaign_visit",
              "begin_checkout",
            ],
            caseSensitive: true,
          },
        },
      },
    ]
    expect(daily).toEqual({
      dateRanges: [{ startDate: "2026-09-07", endDate: "2026-09-13" }],
      dimensions: [
        { name: "date" },
        { name: "eventName" },
        { name: eventDimension },
      ],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: { andGroup: { expressions: common } },
      limit: "720",
      keepEmptyRows: false,
    })
    expect(campaigns.dimensionFilter.andGroup.expressions).toEqual([
      ...common,
      {
        filter: {
          fieldName: campaignDimension,
          inListFilter: {
            values: [firstCampaign, secondCampaign],
            caseSensitive: true,
          },
        },
      },
    ])
    expect(campaigns.dimensions).toEqual([
      { name: campaignDimension },
      { name: "eventName" },
      { name: eventDimension },
    ])
    expect(campaigns.limit).toBe("8")
    for (const [url, init] of fetcher.mock.calls.slice(1)) {
      expect(url).toBe(reportUrl)
      expect(init!.redirect).toBe("manual")
      expect(new Headers(init!.headers).get("Authorization")).toBe(
        "Bearer synthetic_access_token"
      )
      expect(stringValue(init!.body)).not.toMatch(
        /pageLocation|pageReferrer|userId|email|currencyCode|metricAggregations|screenName/
      )
    }
    expect(result).toMatchObject({
      status: "available",
      eventReportingId: reportingId,
      totals: {
        pageViews: 5,
        eventViews: 3,
        campaignVisits: 2,
        checkoutStarts: 1,
      },
      campaigns: [
        { campaignReportingId: firstCampaign, pageViews: 2 },
        { campaignReportingId: secondCampaign, campaignVisits: 1 },
      ],
      fetchedAt: "2026-09-13T12:00:00.000Z",
      dataAsOf: null,
      processingDelayPossible: true,
      timeZone: "Asia/Almaty",
      currency: "KZT",
      currencyVerified: true,
    })
    if (result.status !== "available")
      throw new Error("Expected available report")
    expect(result.daily).toHaveLength(7)
    expect(result.daily[0]).toEqual({
      date: "2026-09-07",
      pageViews: 0,
      eventViews: 0,
      campaignVisits: 0,
      checkoutStarts: 0,
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.daily[0])).toBe(true)
  })
  it("skips campaign lookup for an empty authorized set", async () => {
    const fetcher = stub(),
      result = await provider(fetcher).report({
        ...input,
        campaignReportingIds: [],
      })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      status: "available",
      campaigns: [],
      totals: { pageViews: 5 },
    })
  })
  it("coalesces concurrent token acquisition and reuses the token until its refresh margin", async () => {
    const fetcher = stub(),
      adapter = provider(fetcher)
    await Promise.all([adapter.report(input), adapter.report(input)])
    expect(fetcher.mock.calls.filter(([url]) => url === oauthUrl)).toHaveLength(
      1
    )
    now += 3_539_000
    await adapter.report(input)
    expect(fetcher.mock.calls.filter(([url]) => url === oauthUrl)).toHaveLength(
      1
    )
    now += 1000
    await adapter.report(input)
    expect(fetcher.mock.calls.filter(([url]) => url === oauthUrl)).toHaveLength(
      2
    )
  })
  it("does not retry an unauthorized report and refreshes its token only on the next call", async () => {
    let deny = true
    const fetcher = stub(async (url, init) =>
      url === oauthUrl
        ? oauth()
        : deny
          ? json({ error: { message: "PRIVATE provider denial" } }, 401)
          : defaultFetch(url, init)
    )
    const adapter = provider(fetcher)
    expect(await adapter.report(input)).toMatchObject({
      status: "unavailable",
      reason: "authorization_failed",
      retryable: false,
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    deny = false
    expect((await adapter.report(input)).status).toBe("available")
    expect(fetcher.mock.calls.filter(([url]) => url === oauthUrl)).toHaveLength(
      2
    )
  })
  it("does not cache token failures or expired tokens", async () => {
    let expiry = 59
    const fetcher = stub(async (url, init) =>
        url === oauthUrl
          ? json({
              access_token: "token",
              token_type: "Bearer",
              expires_in: expiry,
            })
          : defaultFetch(url, init)
      ),
      adapter = provider(fetcher)
    expect(await adapter.report(input)).toMatchObject({
      status: "unavailable",
      reason: "authorization_failed",
      retryable: true,
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expiry = 3600
    expect((await adapter.report(input)).status).toBe("available")
    expect(fetcher.mock.calls.filter(([url]) => url === oauthUrl)).toHaveLength(
      2
    )
  })
  it("does not use a token if its response arrives after the token's useful lifetime", async () => {
    const fetcher = stub(async () => {
      now += 3_600_000
      return oauth()
    })
    expect(await provider(fetcher).report(input)).toMatchObject({
      status: "unavailable",
      reason: "authorization_failed",
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it("refuses a clock rollback and keeps the previous time boundary across calls", async () => {
    const fetcher = stub(),
      adapter = provider(fetcher)
    await adapter.report(input)
    const called = fetcher.mock.calls.length
    now--
    expect(await adapter.report(input)).toMatchObject({
      status: "unavailable",
      reason: "clock_error",
    })
    expect(await adapter.report(input)).toMatchObject({
      status: "unavailable",
      reason: "clock_error",
    })
    expect(fetcher).toHaveBeenCalledTimes(called)
    now++
    await adapter.report(input)
    expect(fetcher.mock.calls.filter(([url]) => url === oauthUrl)).toHaveLength(
      2
    )
  })
})

describe("GA4 configuration and authorized request bounds", () => {
  it.each([
    {},
    { propertyId: "123" },
    { serviceAccountJson: "{}" },
    { propertyId: "", serviceAccountJson: "{}" },
  ])(
    "returns unavailable without fake zero metrics for missing configuration %#",
    async (config) => {
      const fetcher = stub(),
        result = await provider(fetcher, config).report(input)
      expect(result).toMatchObject({
        status: "unavailable",
        reason: "not_configured",
      })
      expect(result).not.toHaveProperty("totals")
      expect(result).not.toHaveProperty("daily")
      expect(fetcher).not.toHaveBeenCalled()
    }
  )
  it.each([
    "properties/123",
    "123:runReport",
    "123?token=secret",
    "0123",
    "-1",
    "1".repeat(21),
  ])("rejects noncanonical property configuration %#", async (propertyId) => {
    const fetcher = stub()
    expect(
      await provider(fetcher, { ...configuration, propertyId }).report(input)
    ).toMatchObject({ status: "unavailable", reason: "invalid_configuration" })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([
    { type: "authorized_user" },
    { client_email: "attendee@example.test" },
    { private_key: "PRIVATE invalid key" },
    { token_uri: "https://attacker.example/token" },
    { universe_domain: "attacker.example" },
    { private_key_id: "header\nvalue" },
  ])(
    "rejects invalid credential fields before networking %#",
    async (change) => {
      const fetcher = stub()
      expect(
        await provider(fetcher, {
          ...configuration,
          serviceAccountJson: JSON.stringify({ ...credentials, ...change }),
        }).report(input)
      ).toMatchObject({
        status: "unavailable",
        reason: "invalid_configuration",
      })
      expect(fetcher).not.toHaveBeenCalled()
    }
  )
  it("rejects weak RSA keys even when they are valid PKCS8", async () => {
    const weak = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 1024,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"]
    )
    const bytes = new Uint8Array(
      await crypto.subtle.exportKey("pkcs8", weak.privateKey)
    )
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))}\n-----END PRIVATE KEY-----\n`,
      fetcher = stub()
    expect(
      await provider(fetcher, {
        ...configuration,
        serviceAccountJson: JSON.stringify({
          ...credentials,
          private_key: pem,
        }),
      }).report(input)
    ).toMatchObject({ status: "unavailable", reason: "invalid_configuration" })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([
    { eventReportingId: "order-private-token" },
    { campaignReportingIds: [firstCampaign, firstCampaign] },
    {
      campaignReportingIds: Array.from(
        { length: 51 },
        (_, index) => `rpt_campaign${String(index).padStart(4, "0")}`
      ),
    },
    { dimensionFilter: {} },
    { propertyId: "another" },
    { accessToken: "PRIVATE" },
    { pageLocation: "https://private.example/orders/token" },
    { period: { range: "7", start: "2026-09-08", end: "2026-09-13" } },
    { period: { range: "30", start: "2026-09-07", end: "2026-09-13" } },
    { period: { range: "custom", start: "2026-03-01", end: "2026-09-13" } },
    { period: { range: "custom", start: "2026-09-14", end: "2026-09-13" } },
    { period: { range: "custom", start: "2026-02-30", end: "2026-03-01" } },
    { period: { range: "custom", start: "2026-09-14", end: "2026-09-14" } },
    {
      period: {
        range: "7",
        start: "2026-09-07",
        end: "2026-09-13",
        timeZone: "UTC",
      },
    },
  ])(
    "rejects unauthorized-shaped inputs or invalid resolved dates before OAuth %#",
    async (change) => {
      const fetcher = stub()
      expect(
        await provider(fetcher).report({
          ...input,
          ...change,
        } as Ga4ReportRequest)
      ).toMatchObject({ status: "unavailable", reason: "invalid_request" })
      expect(fetcher).not.toHaveBeenCalled()
    }
  )
  it("accepts 180 calendar days and evaluates future dates at the Almaty boundary", async () => {
    const fetcher = stub(async (url, init) =>
      url === oauthUrl
        ? oauth()
        : json(
            report(
              JSON.parse(stringValue(init!.body)).dimensions[0].name ===
                campaignDimension,
              []
            )
          )
    )
    const adapter = provider(fetcher)
    const end = "2026-09-13",
      start = new Date(Date.parse(end) - 179 * 86_400_000)
        .toISOString()
        .slice(0, 10)
    const result = await adapter.report({
      ...input,
      period: { range: "custom", start, end },
    })
    expect(result).toMatchObject({
      status: "available",
      period: { dayCount: 180 },
    })
    if (result.status === "available") expect(result.daily).toHaveLength(180)
    now = Date.parse("2026-09-13T19:00:00Z")
    expect(
      (
        await adapter.report({
          ...input,
          period: { range: "custom", start: "2026-09-14", end: "2026-09-14" },
        })
      ).status
    ).toBe("available")
  })
})

describe("GA4 response completeness, counts and privacy", () => {
  it.each([
    {
      dimensionHeaders: [
        { name: "pageLocation" },
        { name: "eventName" },
        { name: eventDimension },
      ],
    },
    { metricHeaders: [{ name: "totalUsers", type: "TYPE_INTEGER" }] },
    { rows: [row("20260911", "page_view", 1, "rpt_otherevent01")] },
    { rows: [row("20260911", "purchase", 1)] },
    { rows: [row("20260230", "page_view", 1)] },
    { rows: [row("20260914", "page_view", 1)] },
    { rows: [row("20260911", "page_view", "1.5")] },
    { rows: [row("20260911", "page_view", "-1")] },
    { rows: [row("20260911", "page_view", "01")] },
    { rows: [row("20260911", "page_view", Number.MAX_SAFE_INTEGER + 1)] },
    {
      rows: [row("20260911", "page_view", 1), row("20260911", "page_view", 1)],
    },
    {
      rows: [
        row("20260911", "page_view", Number.MAX_SAFE_INTEGER),
        row("20260912", "page_view", 1),
      ],
    },
    { rowCount: 720 },
    { metricHeaders: [{ name: "eventCount", type: "TYPE_FLOAT" }] },
  ])(
    "rejects malformed, out-of-scope, duplicate, truncated or unsafe counts %#",
    async (change) => {
      const altered = {
        ...report(),
        ...change,
        ...(change.rows ? { rowCount: change.rows.length } : {}),
      }
      const fetcher = stub(async (url) =>
        url === oauthUrl ? oauth() : json(altered)
      )
      const result = await provider(fetcher).report(input)
      expect(result).toMatchObject({
        status: "unavailable",
        reason: "invalid_response",
      })
      expect(result).not.toHaveProperty("totals")
    }
  )
  it("accepts the largest safe integer without rounding", async () => {
    const fetcher = stub(async (url) =>
      url === oauthUrl
        ? oauth()
        : json(
            report(false, [
              row("20260911", "page_view", Number.MAX_SAFE_INTEGER),
            ])
          )
    )
    expect(
      await provider(fetcher).report({ ...input, campaignReportingIds: [] })
    ).toMatchObject({
      status: "available",
      totals: { pageViews: Number.MAX_SAFE_INTEGER },
    })
  })
  it("refuses campaign results outside the authorized list even when event-scoped", async () => {
    const fetcher = stub(async (url, init) =>
      url === oauthUrl
        ? oauth()
        : JSON.parse(stringValue(init!.body)).dimensions[0].name ===
            campaignDimension
          ? json(report(true, [row("rpt_foreigncamp1", "page_view", 1)]))
          : defaultFetch(url, init)
    )
    expect(await provider(fetcher).report(input)).toMatchObject({
      status: "unavailable",
      reason: "invalid_response",
    })
  })
  it.each([
    { timeZone: "UTC", currencyCode: "KZT" },
    { timeZone: "Asia/Almaty", currencyCode: "USD" },
    { timeZone: "Asia/Almaty", currencyCode: "" },
  ])(
    "refuses property timezone or default currency mismatches %#",
    async (metadata) => {
      const fetcher = stub(async (url) =>
        url === oauthUrl ? oauth() : json({ ...report(), metadata })
      )
      expect(await provider(fetcher).report(input)).toMatchObject({
        status: "unavailable",
        reason: "property_mismatch",
      })
    }
  )
  it("requires timezone metadata and reports missing currency verification honestly", async () => {
    const invalid = stub(async (url) =>
      url === oauthUrl
        ? oauth()
        : json({ ...report(), metadata: { currencyCode: "KZT" } })
    )
    expect(await provider(invalid).report(input)).toMatchObject({
      status: "unavailable",
      reason: "invalid_response",
    })
    const valid = stub(async (url) =>
      url === oauthUrl
        ? oauth()
        : json({ ...report(), metadata: { timeZone: "Asia/Almaty" } })
    )
    expect(
      await provider(valid).report({ ...input, campaignReportingIds: [] })
    ).toMatchObject({ status: "available", currencyVerified: false })
  })
  it("distinguishes an explicit empty reason from a successful empty report", async () => {
    const fetcher = stub(async (url) =>
      url === oauthUrl
        ? oauth()
        : json({
            ...report(false, []),
            metadata: {
              timeZone: "Asia/Almaty",
              currencyCode: "KZT",
              emptyReason: "PRIVATE provider processing reason",
            },
          })
    )
    const unavailable = await provider(fetcher).report(input)
    expect(unavailable).toMatchObject({
      status: "unavailable",
      reason: "data_unavailable",
      retryable: true,
    })
    expect(JSON.stringify(unavailable)).not.toContain("PRIVATE")
    const empty = stub(async (url) =>
      url === oauthUrl
        ? oauth()
        : json({ ...report(false, []), rows: undefined, rowCount: undefined })
    )
    expect(
      await provider(empty).report({ ...input, campaignReportingIds: [] })
    ).toMatchObject({
      status: "available",
      totals: {
        pageViews: 0,
        eventViews: 0,
        campaignVisits: 0,
        checkoutStarts: 0,
      },
      dataAsOf: null,
      processingDelayPossible: true,
    })
  })
  it("retains only safe report-quality flags and never provider-wide totals or private response fields", async () => {
    const fetcher = stub(async (url) =>
      url === oauthUrl
        ? oauth()
        : json({
            ...report(),
            totals: [{ metricValues: [{ value: "99999999999999" }] }],
            userEmail: "PRIVATE@example.test",
            metadata: {
              timeZone: "Asia/Almaty",
              currencyCode: "KZT",
              subjectToThresholding: true,
              dataLossFromOtherRow: true,
              samplingMetadatas: [
                { samplesReadCount: "5", samplingSpaceSize: "10" },
              ],
              privateDetails: "PRIVATE",
            },
          })
    )
    const result = await provider(fetcher).report({
      ...input,
      campaignReportingIds: [],
    })
    expect(result).toMatchObject({
      status: "available",
      quality: {
        subjectToThresholding: true,
        sampled: true,
        dataLossFromOtherRow: true,
      },
      totals: { pageViews: 5 },
    })
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE|99999999999999|123456789|synthetic_access_token|gserviceaccount/
    )
  })
  it.each([
    {
      samplingMetadatas: [{ samplesReadCount: "11", samplingSpaceSize: "10" }],
    },
    { samplingMetadatas: [{ samplesReadCount: "0", samplingSpaceSize: "0" }] },
  ])("rejects impossible sampling metadata %#", async (change) => {
    const fetcher = stub(async (url) =>
      url === oauthUrl
        ? oauth()
        : json({ ...report(), metadata: { ...report().metadata, ...change } })
    )
    expect(await provider(fetcher).report(input)).toMatchObject({
      status: "unavailable",
      reason: "invalid_response",
    })
  })
})

describe("GA4 bounded transport failures", () => {
  it.each([
    [429, "rate_limited", true],
    [500, "provider_unavailable", true],
    [503, "provider_unavailable", true],
    [408, "provider_unavailable", true],
    [400, "authorization_failed", false],
    [401, "authorization_failed", false],
    [403, "authorization_failed", false],
    [404, "authorization_failed", false],
  ] as const)(
    "classifies HTTP %s without leaking provider diagnostics",
    async (status, reason, retryable) => {
      const fetcher = stub(async (url) =>
        url === oauthUrl
          ? oauth()
          : json(
              {
                error: {
                  message: "PRIVATE secret body",
                  status: "PRIVATE STATUS",
                },
              },
              status,
              { "Retry-After": "125" }
            )
      )
      const result = await provider(fetcher).report(input)
      expect(result).toMatchObject({ status: "unavailable", reason, retryable })
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(JSON.stringify(result)).not.toMatch(
        /PRIVATE|synthetic_access_token|gserviceaccount/
      )
      if (retryable) expect(result).toHaveProperty("retryAfterSeconds", 125)
    }
  )
  it.each(["99999", "tomorrow\nPRIVATE", "Fri, 13 Sep 2026 12:00:00 GMT"])(
    "returns only bounded numeric retry hints %#",
    async (value) => {
      const fetcher = stub(async () =>
        json({}, 429, { "Retry-After": value.replace("\n", " ") })
      )
      expect(await provider(fetcher).report(input)).toMatchObject({
        status: "unavailable",
        reason: "rate_limited",
        retryAfterSeconds: value === "99999" ? 3600 : 60,
      })
    }
  )
  it("handles OAuth rejection without attempting a report", async () => {
    const fetcher = stub(async () =>
      json(
        { error: "invalid_grant", error_description: "PRIVATE credentials" },
        400
      )
    )
    expect(await provider(fetcher).report(input)).toMatchObject({
      status: "unavailable",
      reason: "authorization_failed",
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([
    { access_token: "bad\ntoken" },
    { expires_in: 0 },
    { expires_in: 3601 },
    { token_type: "Basic" },
    { scope: "https://www.googleapis.com/auth/analytics" },
  ])("rejects unsafe token responses %#", async (change) => {
    const fetcher = stub(async () =>
      json({
        access_token: "token",
        token_type: "Bearer",
        expires_in: 3600,
        ...change,
      })
    )
    expect(await provider(fetcher).report(input)).toMatchObject({
      status: "unavailable",
      reason: "invalid_response",
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it("blocks redirects at both fixed endpoints and never follows a supplied destination", async () => {
    for (const stage of ["oauth", "report"]) {
      const fetcher = stub(async (url) =>
        url === oauthUrl && stage === "report"
          ? oauth()
          : new Response(null, {
              status: 302,
              headers: { Location: "https://attacker.example/private" },
            })
      )
      expect(await provider(fetcher).report(input)).toMatchObject({
        status: "unavailable",
        reason: "redirect_blocked",
      })
      expect(
        fetcher.mock.calls.every(
          ([url, init]) =>
            [oauthUrl, reportUrl].includes(stringValue(url)) &&
            init!.redirect === "manual"
        )
      ).toBe(true)
    }
  })
  it("rejects an already redirected successful response from a noncompliant injected transport", async () => {
    const fetcher = stub(async () => {
      const response = oauth()
      Object.defineProperty(response, "redirected", { value: true })
      return response
    })
    expect(await provider(fetcher).report(input)).toMatchObject({
      status: "unavailable",
      reason: "redirect_blocked",
    })
  })
  it("classifies a network error without returning its message", async () => {
    const fetcher = stub(async () => {
      throw new Error("PRIVATE token in network diagnostics")
    })
    const result = await provider(fetcher).report(input)
    expect(result).toMatchObject({
      status: "unavailable",
      reason: "provider_unavailable",
      retryable: true,
    })
    expect(JSON.stringify(result)).not.toContain("PRIVATE")
  })
  it.each(["bad JSON", '{"secret":"PRIVATE"}'])(
    "rejects malformed or incomplete successful JSON %#",
    async (text) => {
      const fetcher = stub(
        async () =>
          new Response(text, {
            headers: { "Content-Type": "application/json" },
          })
      )
      expect(await provider(fetcher).report(input)).toMatchObject({
        status: "unavailable",
        reason: "invalid_response",
      })
    }
  )
  it("bounds announced and streamed response sizes", async () => {
    for (const announced of [true, false]) {
      const cancelled = vi.fn()
      const fetcher = stub(async (url) =>
        url === oauthUrl
          ? oauth()
          : new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(
                    new Uint8Array(ga4ProviderPolicy.reportResponseBytes + 1)
                  )
                },
                cancel: cancelled,
              }),
              {
                headers: {
                  "Content-Type": "application/json",
                  ...(announced
                    ? {
                        "Content-Length": String(
                          ga4ProviderPolicy.reportResponseBytes + 1
                        ),
                      }
                    : {}),
                },
              }
            )
      )
      expect(await provider(fetcher).report(input)).toMatchObject({
        status: "unavailable",
        reason: "invalid_response",
      })
      expect(cancelled).toHaveBeenCalled()
    }
  })
  it("enforces the deadline even when fetch ignores the abort signal", async () => {
    vi.useFakeTimers()
    const fetcher = stub(async () => new Promise<Response>(() => undefined)),
      promise = provider(fetcher).report(input)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(ga4ProviderPolicy.timeoutMs)
    expect(await promise).toMatchObject({
      status: "unavailable",
      reason: "timeout",
      retryable: true,
    })
    expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true)
  })
  it("keeps the deadline active through streaming response consumption", async () => {
    vi.useFakeTimers()
    const cancelled = vi.fn(),
      fetcher = stub(async (url) =>
        url === oauthUrl
          ? oauth()
          : new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode('{"rows":'))
                },
                cancel: cancelled,
              }),
              { headers: { "Content-Type": "application/json" } }
            )
      )
    const promise = provider(fetcher).report(input)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    await vi.advanceTimersByTimeAsync(ga4ProviderPolicy.timeoutMs)
    expect(await promise).toMatchObject({
      status: "unavailable",
      reason: "timeout",
    })
    expect(cancelled).toHaveBeenCalled()
  })
})
