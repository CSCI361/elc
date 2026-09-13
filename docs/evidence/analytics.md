# Authoritative event analytics

Verified locally on 2026-09-13. `GET /api/events/:eventId/analytics` reads elc's
orders, item snapshots, refunds, inventory, campaigns and canonical admissions.
It requires a verified active owner or a current `analytics:read` grant.
Management, scanner and purchaser access do not imply reporting access.
`GET /api/organizer/analytics/events` lists those authorized events for selection,
including analytics-only staff assignments, with search and bounded pagination.

## Dates and financial definitions

The default is 30 calendar days including today in the event's time zone.
Seven-day and custom inclusive ranges are available; custom queries accept at
most 180 days. Calendar boundaries use the IANA zone, including short/long DST
days, midnight gaps and skipped dates. UTC intervals are half-open. The response
includes both selected calendar dates and exact UTC bounds.

Completed orders retain their original gross, discount and issued quantity after
cancellation or refund. Free and fully discounted registrations count as issued
tickets. Confirmed refunds are recorded on their confirmation date, independently
of the original sale date. A refund-only period can therefore have negative net
ticket revenue and estimated payout contribution. Pending/failed refunds do not
change historical revenue; their admission blocks affect current attendance.

Processing fees use the order's frozen amount and basis-point rate. For ticket
type reports, the fee is allocated over every original item before applying the
filter. Integer floors plus the largest remainders distribute the once-rounded
order fee, with original item IDs breaking ties. The calculation splits integer
products at 10,000 to avoid overflow. Full refunds reverse that same allocation.
Activation fees and refunds, unfulfilled-payment compensation and zero attendee
processing charges are separate. Those event-level amounts do not acquire an
invented ticket-type allocation. No activation fee is deducted again from ticket
revenue or estimated payout.

Campaign reporting uses matching, committed promo allocations. It counts distinct
completed orders once across their items and retains consumed redemptions after
refunds. Ticket quantities, original gross/discount, confirmed refunds and net
revenue follow the attributed order items. Order/redemption counts across ticket
types can overlap when one order contains several types; monetary allocations
and quantities remain additive.

## Current state and bounded reads

Capacity and attendance are explicitly separate current-state values with an
`asOf` timestamp. Remaining inventory comes from enabled inventory and live
reservation deadlines. It is not capacity minus historical sales. The sold
percentage excludes cancelled/refunded tickets. Attendance requires an eligible
completed order, an unblocked ticket and event, and an active canonical check-in.
Reversed check-ins remain in history. Empty attendance yields zero percent.

Unresolved uploaded offline reports are separate from confirmed attendance.
The server reports the unsynchronized device count as unknown, because it cannot
observe a disconnected journal. Provisional local counts belong in the native
scanner. Date filters change sales/refund/campaign metrics, while the ticket-type
filter also scopes current inventory and attendance.

Every statement in the D1 report batch independently selects the currently
authorized event and planned time zone. Revocation or a changed time zone before
that batch denies the result. Current title and counts are read in that batch.
Daily output is capped at 180 rows; ticket types and campaigns use separate
bounded pages of at most 50 rows. Summary totals do not shrink to the displayed
chart page.

Migration 0019 adds payment/refund reporting indexes and an event/scope/time
audit index. Query-plan inspection caught a planner choice that traversed broad
payment/item indexes. Explicit join ordering now selects the bounded sales and
refund date ranges before loading their order items. No aggregate tables have
been added without load evidence.

## Validation and remaining acceptance

Five civil-date tests and eleven real D1 integration tests pass. They cover held and
completed inventory, original snapshots after price changes, refunds on later
days, mixed-type fee rounding near the safe integer limit, campaign attribution
and pagination, free cancellation, unfulfilled compensation, admission/reversal
history, current permission and time-zone races, and simultaneous reporting,
checkout and scanning, plus analytics-only assignment listing and revocation.
Query-plan assertions confirm indexed sales/refund reads.
An independent backend review found no blocking issue in these paths.

The combined reporting/history/support UI run passed 46 tests across six files.
Scoped formatting/lint/type checks and the web/Worker/Astro build pass. This is
local API evidence. Dashboard browser acceptance, the Almaty multi-event overview,
GA4 integration and the required deployed 50-event/10,000-ticket, ten-minute mixed
workload remain pending. The small concurrent D1 test does not establish the
deployed scan-latency target.
