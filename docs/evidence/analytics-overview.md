# Organizer analytics overview

Implementation reviewed on 2026-09-13. The API is
`GET /api/organizer/analytics/overview`; its service is
`readOrganizerAnalytics` in `apps/api/src/reporting/overview.ts`.
The shared query and response contracts are in
`packages/shared/src/analytics-overview-api.ts`.

## Scope and dates

The overview includes every matching event currently owned by the verified,
active account or covered by its current `analytics:read` grant. Event management,
scanning and platform moderation do not grant analytics access. A literal title
search applies to the entire scope. The per-event table uses an ID cursor and a
page of at most 50 events; summary and daily totals include the entire scope on
every page. The cursor is bound to the account, search and selected dates.

All financial dates use `Asia/Almaty`, including events configured in another
time zone. The default is 30 calendar days including today; seven-day and custom
inclusive ranges of at most 180 days are supported. The response labels its zone
and returns both civil dates and half-open UTC boundaries. Empty days remain in
the daily series. Each event row retains its own time zone and links to its
event-local report.

## Measures

Completed order snapshots supply original gross, discount, ticket quantity and
the once-rounded processing fee. Later cancellation or refund preserves those
original sale measures. A confirmed full refund contributes ticket refunds and
the frozen fee reversal on its confirmation date. A period containing only a
refund can have negative net revenue and estimated payout contribution.
Committed campaign redemptions count the matching completed order once and
remain in its original sale period after a refund or campaign change.

Activation fees, activation refunds and compensation for an unfulfilled payment
are separate amounts. Attendee processing charges remain zero. Recorded simulated
payouts use their completion date; negative payout adjustments use their recorded
creation date. These amounts are separate from estimated payout derived from
the selected ticket sales, confirmed refunds and fees.

Current inventory and admission counts have a separate `asOf` timestamp and are
independent of the selected financial dates. Live reservation deadlines determine
held and remaining inventory. Attendance requires a currently eligible ticket,
order and event plus a non-reversed canonical check-in. Uploaded unresolved
offline reports are counted separately. The count of reports still on disconnected
devices remains `null`, because D1 cannot observe those journals.

## Read consistency and limits

The service uses one D1 batch with five read statements for authorization and
scope, summary, daily rows, current counts and the event page. Every statement
rechecks account and event authority in SQL. It does not call the per-event report
in a loop. Owner/grant candidates and existing sales, refund, payment, inventory,
admission and payout indexes scope the reads. The financial entry CTE groups its
seven sources into compound queries of at most five terms, matching D1's limit.

Returned integers must be safe JavaScript integers. Derived totals use `BigInt`
before conversion. SQLite integer overflow and totals outside the safe range
produce HTTP 409 with an explicit instruction to narrow the date or event-title
scope, rather than a rounded report.

## Validation status

Scoped formatting, lint and type checks pass. The full integration run passed
926 of 927 tests; its sole failure found global ticket and offline-operation
scans in the overview query plan. The query now starts with authorized events,
then uses indexed event/order lookups. Its strengthened regression checks for
constrained searches and rejects those global scans. All eleven overview D1
tests and six frontend policy/loader tests passed together after that fix.

The runner uses two workers and a 30-second setup timeout. The full run had no
setup timeouts under those limits; an earlier four-worker run exceeded the
default ten-second setup timeout.

The final integration file contains eleven real D1 cases. It exercises all-event
totals across pages, Almaty midnight across different event zones, empty dates,
current authority and revocation, refund-only periods, free cancellation and late
payment compensation, recorded payout and later event-cancellation adjustment
dates, committed discounts after catalog changes, literal search privacy,
simultaneous checkout/reporting/admission and reversal, safe-integer overflow,
and indexed query plans. Financial transitions use an injected provider adapter;
they make no external payment or email requests.

The [overview browser checks](./web-analytics-overview.md) pass. Deployed query
plans and the required 50-event/10,000-ticket mixed workload remain pending. Existing event-level
definitions and evidence are recorded in [analytics.md](analytics.md).
