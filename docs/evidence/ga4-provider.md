# GA4 Data API adapter

Implemented on 2026-09-13 in `apps/api/src/traffic/provider.ts`. This unit implements the server transport and validates scoped aggregate responses. It has no HTTP routes, database cache, client collection, deployment bindings or account setup. Tests use synthetic service-account keys and injected HTTP responses. No request was sent to Google.

## Contract and deployment configuration

```ts
createGa4Provider(
  { propertyId?: string; serviceAccountJson?: string },
  { fetch?: typeof fetch; now?: () => number }
).report({
  eventReportingId: string,
  campaignReportingIds: readonly string[],
  period: { range: "7" | "30" | "custom"; start: string; end: string }
}): Promise<Ga4ReportResult>
```

The planned deployment bindings are `GA4_PROPERTY_ID` and secret `GA4_SERVICE_ACCOUNT_JSON`. The caller must resolve current organizer access, public-event eligibility and campaign ownership before calling the adapter. The property must grant the service account reporting access and register event-scoped `event_reporting_id` and `campaign_reporting_id` custom dimensions. Their API names are `customEvent:event_reporting_id` and `customEvent:campaign_reporting_id`. Registering a custom dimension is required before querying it. [Google Data API schema](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema)

The strict request accepts only the reporting IDs and resolved calendar period. It rejects duplicate campaign IDs, more than 50 campaigns, unknown fields and arbitrary filters. Dates must be real `YYYY-MM-DD` calendar dates. Inclusive periods contain 1 to 180 days; the `7` and `30` presets must contain exactly that many days. The period cannot end after the current date in Asia/Almaty. Invalid or future periods return `invalid_request` before network access. Missing configuration returns `not_configured` without fabricated metrics.

## Queries and response validation

The adapter uses only `POST https://analyticsdata.googleapis.com/v1beta/properties/{configuredPropertyId}:runReport`. Both reports filter the exact event reporting ID and allow only `page_view`, `view_item`, `campaign_visit` and `begin_checkout`. The daily report groups by date, event name and event reporting ID. It has no campaign filter, so its daily counts and totals include the full event scope. The optional campaign report adds an exact campaign-ID allowlist and groups by campaign reporting ID, event name and event reporting ID. It is skipped for an empty allowlist. Both request only `eventCount`. [Run report API](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport), [filter expressions](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/FilterExpression)

The largest daily response has 180 days times four event names, or 720 rows. The campaign response has at most 200 rows. Returned dimension order, metric name/type, row count, every reporting ID, event name and date must match the request. Duplicate rows, incomplete results, foreign campaigns and unsafe integers are rejected. Totals are computed from validated daily rows with overflow checks. No property-wide totals, user dimensions, URLs, referrers, identifiers or arbitrary provider fields enter the result.

Response metadata must report `Asia/Almaty`. When `currencyCode` is present it must be `KZT`; absent currency metadata produces `currencyVerified: false`. The request omits `currencyCode` because Google otherwise echoes the requested currency instead of reporting the property's default. Thresholding, sampling and other-row data loss remain explicit quality flags. A nonempty `emptyReason` or restricted metrics returns `data_unavailable`; a complete valid report with no rows can return zero counts. [Response metadata](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/ResponseMetaData), [report response](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/RunReportResponse)

Available results contain frozen `totals`, `daily` and `campaigns` counts named `pageViews`, `eventViews`, `campaignVisits` and `checkoutStarts`. They include the selected period, `fetchedAt`, timezone, currency verification and quality flags. `dataAsOf` is always `null`, and `processingDelayPossible` is always `true`. Fetch time does not claim that Google has processed activity through that instant. Google documents processing delays and later changes to reports. [GA4 data freshness](https://support.google.com/analytics/answer/11198161?hl=en)

## Authentication and failure handling

WebCrypto imports a PKCS8 RSA key of 2048 to 4096 bits and signs RS256 JWT assertions. Claims contain only the service-account issuer, `analytics.readonly` scope, the fixed OAuth token endpoint audience and a one-hour issuance/expiry interval. The adapter does not impersonate a user. It exchanges the assertion at `https://oauth2.googleapis.com/token`, then uses the returned Bearer access token for reports. Tokens stay in adapter memory, concurrent refreshes share one request, and refresh begins one minute before expiry. A refused token is cleared without an automatic request retry. The implementation uses platform WebCrypto instead of adding an OAuth library; tests verify signatures with the generated public key. [Google service-account OAuth](https://developers.google.com/identity/protocols/oauth2/service-account)

All requests prohibit redirects and credentials/cookies. Each transport has a ten-second deadline covering headers and response-body reading. The token response is bounded to 16 KiB and a report to 256 KiB, including streamed responses without a length header. Only successful JSON responses are parsed. Errors expose fixed application reason codes, a retry flag, bounded numeric retry delay and last checked time. They never expose provider bodies, messages, arbitrary headers, credentials or cryptographic material. There is no logging or implicit retry loop.

HTTP 429 produces `rate_limited`; 5xx, 408 and network errors are retryable provider failures. A numeric `Retry-After` is clamped to 1 through 3600 seconds. Authentication/configuration refusals, malformed responses, redirects and property mismatches have separate safe reasons. An invalid or backwards clock clears cached tokens and refuses reports. The same adapter instance refuses further requests until the clock reaches its last observed timestamp. Reporting and error caching remain coordinator responsibilities. [Data API quotas](https://developers.google.com/analytics/devguides/reporting/data/v1/quotas)

## Executed checks and remaining acceptance

- `vp test run apps/api/src/traffic/provider.test.ts`: 89 tests pass.
- `vp check apps/api/src/traffic/provider.ts apps/api/src/traffic/provider.test.ts`: formatting, lint and type checks pass.
- `vp exec tsc --noEmit -p apps/api/tsconfig.json`: API TypeScript passes.

Tests cover exact request paths and filters, the campaign allowlist, full-event totals, real JWT signatures and claims, token coalescing/refresh, invalid configuration, weak keys, date boundaries and clock rollback. They exercise foreign report rows, malformed metadata, incomplete results, overflow, provider errors, safe diagnostics, absent currency metadata, delayed/empty reports, sampling flags and discarded private fields. Deadline tests include a transport that ignores abort and a stalled response body. Oversize responses and forbidden redirects are rejected at both endpoints.

Deployment property/stream creation, custom-dimension registration, service-account access, consent-controlled browser collection, one-hour report caching, organizer route authorization, dashboard labels and an actual Google acceptance report remain separate integration work. The adapter requires no provider availability for the authoritative elc dashboard or checkout.
