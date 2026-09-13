# Operational records and CSV export

Platform moderators can search orders, payment attempts and audit entries at
`/admin/operations`. Search uses exact record IDs, payment subject/provider IDs,
or audit entity, request and action identifiers. Event and purchaser/actor
filters narrow the results. ID pagination returns 20 records by default and at
most 50. The page supports Kazakh, Russian and English and displays dates in
Asia/Almaty.

`GET /api/admin/operations` returns explicit projections through shared runtime
contracts. Orders include frozen totals, discounts and processing fees. Payments
include their canonical event/subject, provider identifiers, dispatch/payment
state and refund amount/state. Audit records include their actor, action, entity,
correlation and description. The projections omit admission credentials,
checkout links, provider request bodies and internal idempotency data. Every
query requires a verified, unsuspended account with current `platform:moderate`;
recovery permission alone does not grant inspection. The final D1 read rechecks
that authority.

Each record includes its retention deadline and unresolved-work holds. Event
records use the existing history policy, including linked support activity and
payment/refund/admission holds. Account/platform audit records without an event
expire 180 days after creation. Expired records without a hold are absent from
search and export. This filtering does not replace the still-pending daily
D1/R2 deletion jobs.

`GET /api/admin/operations/export` downloads one freshly authorized search page.
The interface states the 20-record page limit and that CSV amounts use tiyn
(100 = KZT 1). Stable columns include retention details and the export query's
UTC timestamp. UTF-8 CSV uses a BOM, quoted fields and doubled embedded quotes.
Potential spreadsheet formulas receive a leading apostrophe. A guarded audit
entry records the exporter, record kind and count, without search text or row
contents. A revoked permission blocks the download and adds no successful-export
entry. Exports are generated on demand and are not stored in a public bucket.

The operational D1 suite passes 13 tests covering projections, exact matching,
filters, pagination, role separation, revocation at read/export, retention
boundaries and holds, export auditing, amount precision and CSV formula handling.
Browser acceptance uses real Better Auth, Worker HTTP and D1 with 23 synthetic
orders, a payment and an audit record. It verifies 20/3 pagination, downloaded
CSV content, provider/request-ID searches, secret exclusion, export audit counts,
all three locales at 390 pixels and immediate removal of private records after
a revoked export. It reports no page errors. All fixtures and downloaded test
files are removed. The ignored script and result are
`.wrangler/web-operations-acceptance.mjs` and
`.wrangler/web-operations-results.json`.

The integrated regression run passes 1,073 tests across 70 files. Full format,
lint and type checks and web/Worker/Astro builds pass. The web entry is
647.22 kB minified, with the existing bundle-size warning.

This is local acceptance. Daily retention cleanup, backup/restore, deployed
workloads and the remaining provider/device checks remain required for release.
