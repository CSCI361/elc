# Authorized GA4 reporting

The organizer event dashboard requests GA4 separately from its authoritative
sales report. The server resolves event access and campaign reporting IDs;
clients cannot select arbitrary GA4 dimensions or a property. An event owner or
current `analytics:read` grantee must have a verified, unsuspended account.
Access and the selected campaign page are checked again after the provider call
and before returning cached data. Authorized historical reporting remains
available when an event becomes private; collection is a separate public-only
policy.

Migration `0024_ga4_report_cache.sql` adds a private D1 cache. Successful reports
expire one hour after their provider fetch time. Failure results back off for
60 seconds to one hour without inventing zero counts. A 60-second lease prevents
concurrent refreshes of the same report, and expired workers cannot overwrite a
new result. Cache keys include a digest of the deployment configuration, event,
dates and server-resolved campaign page. Credentials are never stored in cache
rows. Cache contents are validated against that scope before use. A backward
clock change fails closed. Each event is limited to 32 cached report keys,
including active refreshes. Cron deletes idle entries older than seven days in
batches of 100, and deleting an event cascades to its cache.

The UI uses the resolved sales dates with GA4's Asia/Almaty boundaries and labels
any difference from the event's time zone. GA4 covers all ticket types; a selected
ticket-type filter is labelled as applying only to the adjacent elc orders.
Traffic totals and campaign counts are aggregate comparisons, not person-level
conversion rates. Daily and campaign tables are keyboard-scrollable. The panel
shows the last successful fetch, processing delay and provider quality flags.
A failed refresh clears the preceding traffic figures. Revoked access clears the
private dashboard. All copy is available in Kazakh, Russian and English.

Local browser acceptance uses real BetterAuth sessions and the local Worker/D1
endpoint. The actual unconfigured response leaves sales visible. Available GA4
responses are injected at the browser network boundary because no GA4 property
credentials are configured. Those checks cover four aggregate counts, adjacent
exact orders, date changes, fetch/zone/delay labels, failed refreshes, revocation,
and 390-pixel screens in all three locales. There are no browser page errors.
Synthetic accounts, grants, events and private development mailbox records were
removed afterward. The ignored script and results are
`.wrangler/web-traffic-acceptance.mjs` and `.wrangler/web-traffic-results.json`.

All 21 D1 cache tests and four dashboard scope tests pass. The complete suite
passes 1,010 tests across 66 files in 415 seconds, including the existing 89
provider tests with injected HTTP responses. Full format, lint and type checks
and web/Worker/Astro builds pass. The web entry remains above the existing
500-kB warning threshold at 634.69 kB minified. Live GA4 property access, actual collected data and
provider configuration remain pending. This change does not enable collection.
