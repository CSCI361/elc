# Organizer registrations and order records

SRS §4.4 requires an organizer attendee list containing free registrations. Section 4.16 requires review of retained tickets, orders, refunds and check-ins. `GET /api/events/:eventId/records` supplies these event-scoped records through `kind=tickets` (the default), `orders`, or `checkins`.

Tickets include the attendee name, immutable ticket-type and seat snapshots, canonical state, admission-block status, active check-in and whether an unresolved offline admission report exists. The check-in view retains original admissions and reversals, with separate captured and committed timestamps. An unresolved offline report never becomes a confirmed check-in merely because it appears in this workspace.

Orders include the original quantities and KZT monetary snapshots, campaign attribution, issued-ticket count, and refund state and amount. The processing fee is the original recorded fee, including after a refund; it is not a current payout estimate. The refund projection follows the payment attempt linked to the order's reservation, as the existing order refund view does. A late successful payment after abandonment can therefore show refunded money while the order remains unfulfilled and has no tickets. Existing refund and payout APIs remain authoritative for actions and current financial calculations.

## Access and queries

An active verified account must own the event or have a current `event:manage` or `history:read` grant. The response independently reports current manage, history, analytics, support and refund capabilities. A management grant does not imply refund or support permission, and a scanning, analytics, support or refund grant alone does not authorize the records workspace. The existing financial, support and scanning APIs retain their separate permission checks.

Metadata, capabilities, retention and records are selected in one final D1 transaction after asynchronous query hashing. A revoked grant, suspended or unverified account, or changed event owner cannot expose a stale page. Inaccessible and expired event records return `NOT_FOUND` with status 404. Responses use `Cache-Control: private, no-store` and `Vary: Cookie`.

`q` searches literal attendee-name substrings or exact record IDs. It treats `%` and `_` as ordinary characters. `orderId` and `ticketId` narrow all three views within the selected event. Search also finds attendee names in pending order-item snapshots, while the tickets view includes only issued canonical tickets. The endpoint returns no purchaser contact details, account IDs, admission tokens or token hashes, payment provider payloads, or checkout URLs.

Pages default to 20 records and are capped at 50. Orders sort by creation time and ID, newest first; check-ins use committed time and ID, newest first. Tickets sort by ticket ID. Keyset cursors are bound to the actor, event, record kind and filters; changing these inputs requires a new first page. Invalid queries and cursors return `INVALID_INPUT` with status 400. There is no default date filter that would hide older retained registrations.

## Retention and integration

The endpoint reuses the existing history retention calculation and response contract. Linked event records expire 180 days after the latest event end, cancellation or support-case activity. Pending refunds, payment reconciliation, unresolved financial cases and reported admissions preserve affected records beyond that deadline. The response exposes the expiry and hold reasons. Expired records are hidden even when physical cleanup has not yet run. Cancelled or suspended events remain readable under this policy, while their tickets show blocked admission.

`organizerRecordsRoutes` and `createOrganizerRecordsRoutes` are exported from `apps/api/src/organizer-records/index.ts` for mounting at `/api`. The factory accepts injectable identity, clock and pre-read hooks for verification. The unit adds no mutation endpoint or schema migration. The web workspace can drill into an order or ticket using the existing filters, then link to separately authorized history, analytics, support, refund, campaign and payout views.

## Local verification

The integration suite uses the real migrations and the existing Miniflare D1/R2 ticket fixture. Free registrations complete through the real zero-total issuance transition. Paid orders, refunds and abandoned-payment compensation use the actual order/payment transitions with a synthetic provider. Offline coverage uses a signed snapshot and synchronization whose scanning grant is revoked at commit. No live provider is called.

Coverage includes monetary and seat snapshots, canonical and reversed check-ins, unresolved offline reports, independent permissions, revocation races, literal search, event isolation, tied-timestamp pagination, cursor scope, invalid filters, exact retention deadlines, support activity and unresolved-work holds, HTTP behavior and credential exclusion.

The initial focused run passed 30 of 32 cases. Two fixture errors were repaired: a sold-seat edit correctly hit the historical-assignment invariant, and the foreign event needed its required description and a capacity compatible with the default order limit. The retention activity and refund-hold checks were also split into independent cases. All four affected cases then passed in targeted runs, leaving 33 verified cases in the current file. The final scoped check passed formatting for four files and reported no warnings, lint errors or type errors in three TypeScript files. The root integration run passes all 1,264 tests across 77 files in 574.34 seconds, including all 33 final records cases.

Run `vp check apps/api/src/organizer-records docs/evidence/organizer-records-api.md` and `vp test apps/api/src/organizer-records/records.integration.test.ts --maxWorkers=1`. Browser acceptance is recorded separately.
