# Organizer overview web interface

Implemented on 2026-09-13 at `/organizer/analytics`. The route's existing lazy
module now includes the multi-event overview and retains available-report search
and pagination beneath it. The overview reads the shared canonical contract from
`GET /api/organizer/analytics/overview`.

The page labels `Asia/Almaty` and offers seven-day, 30-day and custom inclusive
periods of at most 180 days. The server resolves preset dates. The event-title
filter applies to all displayed overview totals. A separate event table uses the
API cursor; it never recalculates aggregate totals from the visible page.

Daily sales and net revenue charts have a matching exact-value table. Original
sales, discounts, confirmed refunds, processing fees and the estimated payout
remain separate. Recorded simulated payouts and later adjustments have their
own section and date explanation. Current capacity, reservations and confirmed
attendance carry an independent timestamp and are explicitly outside the date
filter. Disconnected scanner counts are shown as unknown.

KZT values preserve every minor unit through integer decomposition, including
values near JavaScript's safe-integer limit. Charts use compact axis labels;
tables and metric values retain the complete amount. All labels and explanations
are available in Kazakh, Russian and English.

Filter changes, event page changes and refreshes clear the previous private
result before a request starts. Errors leave no report visible. Cancelled or late
responses cannot restore earlier account or filter data. The account ID keys the
entire overview and report-discovery subtree. Window focus rechecks current
authority; a manual refresh starts from the first event page. Permissions are
enforced again by the API on every read.

The filters use labelled native controls. User-requested period or event-page
changes focus the corresponding heading after loading. Tables have captions,
keyboard-focusable scroll regions and visible focus outlines. Progress indicators
have text values. The layout collapses into one column on narrow screens.

Six policy/loader tests passed alongside all eleven overview API tests. They
cover inclusive dates, literal query encoding, cursor resets, exact money,
asynchronous page/scope races, revocation and network failures, response
mismatches, and account changes.

Browser acceptance passed on 2026-09-13 against the running local Worker and
real Better Auth sessions. Twenty-three synthetic events contained completed
orders, linked payment reservations, issued tickets, a confirmed full refund
and an active admission. The reporting account had analytics access to 22 events
and management-only access to the remaining event.

- A browser set to Los Angeles showed 30 Asia/Almaty days, exact original sales,
  refunds and net revenue, and recorded payouts separate from estimates.
- The event table paged as 20 and 2 distinct records without changing aggregate
  totals. The management-only event was absent and pagination focused its heading.
- A refund-only custom period preserved negative revenue and current capacity
  and attendance. Date changes reset the event cursor.
- Event-title search scoped the overview's totals and current counts while the
  available-report list kept its independent search and pagination.
- A delayed earlier search response could not replace a newer scope. A failed
  refresh cleared private figures; retry restored the selected scope.
- Kazakh, Russian and English screens fit 390 px. Wide tables scrolled with the
  keyboard without widening the page.
- Revoking analytics grants removed every private event and its totals on
  refresh. Signed-out visitors could not see report data. No page errors occurred.

All synthetic events, orders, payments, refunds, tickets, admissions, permissions,
accounts and private development mail were removed. Deployed workload acceptance
remains pending.

Backend definitions and validation status are in
[analytics-overview.md](analytics-overview.md).
