# Event analytics web dashboard

The protected event report at `/events/:eventId/analytics` reads `GET /api/events/:eventId/analytics` through the shared response schema. `/organizer/analytics` lists only currently authorized reports through `GET /api/organizer/analytics/events`, with search and cursor pagination. Staff with only `analytics:read` can discover and open private-event reports without `event:manage`. Both pages are lazy imports; the charts use SVG and add no chart dependency.

The default query requests 30 calendar days, including today. The server determines the dates in the event's time zone. Seven-day and custom periods share the ticket-type filter; custom periods accept at most 180 inclusive calendar days. Changing a filter resets both breakdown cursors. Ticket-type and campaign pages advance independently, while period totals include every page.

Daily original-sales and net-revenue lines have a matching daily table. Ticket-type and campaign bars have matching paged tables. The tables include completed orders, issued tickets, original gross, discounts, refunded tickets and amounts, net revenue, organizer-paid processing fees and reversals, estimated payout, and committed campaign redemptions. Money is formatted in KZT and visibly labeled as a simulation. Activation payments, activation refunds, unfulfilled-payment compensation, attendee processing charges, and their refunds are separate from ticket revenue.

Current inventory, configured capacity, ticket states and attendance carry an explicit current-state label and timestamp. Copy states that the date filter does not apply to these counts, while the ticket-type filter does. Attendance uses eligible tickets and confirmed active admissions. The unknown number of unsynchronized scans is shown separately from reported offline incidents awaiting review. This dashboard does not request GA4 data or show traffic estimates. Its event selector does not calculate a multi-event overview.

Kazakh, Russian and English copy covers filters, metrics, charts, errors and navigation. Tables have captions, row and column headers, and labeled keyboard-scrollable regions. Successful manual report navigation moves focus to period totals. Errors use the existing focused error notice. Account or event changes create a fresh report state. Requests use same-origin credentials and no-store caching. New requests discard the previous report, abort the old request, and ignore its eventual response. Revocation errors remove private figures and controls.

## Validation

- `vp check apps/web/src/analytics` passed formatting, lint and type checks.
- `vp run --filter @elc/web typecheck` passed.
- `vp test apps/web/src/analytics/loader.test.ts` passed nine tests. They cover inclusive date boundaries, invalid ranges, preset dates resolved by the server, filter/cursor resets, route parsing, date/type and page races, revocation, account/unmount cancellation, mismatched responses and recovery.
- React review covered account keys, abort cleanup, stale-response handling, bounded charts and tables, lazy imports, focus, and semantic controls.

## Local browser acceptance

An independent headless `elc-web-analytics` session used the existing Worker at `http://localhost:5173`. Synthetic accounts were registered and verified through the real local authentication endpoints and development mailbox. The dashboard context used `America/Los_Angeles`; the selected event used `Asia/Almaty`. The default report still returned and displayed 30 event-local calendar days.

Two private events and a bounded synthetic history were inserted into local D1 with database guards enabled. The history contained 23 ticket types, 23 campaigns, completed paid and free orders, a cancellation, a later confirmed refund, a current hold, an active check-in and one reported offline incident. Separate synthetic activation and compensation records exercised those labels. These rows verify report integration and presentation; they do not demonstrate provider processing or payment transitions.

All 11 summary values and all five separate-payment values displayed in the browser matched the real API exactly. The financial summary was:

| Measure                                          |      KZT |
| ------------------------------------------------ | -------: |
| Original gross ticket amount                     | 2,500.00 |
| Discounts                                        |   200.00 |
| Confirmed ticket refunds                         |   500.00 |
| Net ticket revenue                               | 1,800.00 |
| Organizer-paid processing fees                   |    69.00 |
| Processing fee reversals                         |    15.00 |
| Estimated organizer payout                       | 1,746.00 |
| Activation fees                                  | 5,000.00 |
| Activation refunds                               | 5,000.00 |
| Unfulfilled-payment compensation                 |   700.00 |
| Attendee processing charges and refunded charges |     0.00 |

The API and current-state presentation distinguished 31 configured slots, 28 remaining slots, one reservation, four historically issued tickets, one cancelled ticket, one refunded ticket, two eligible attendees and one confirmed attendee. One reported offline incident remained separate from the unknown unsynchronized count.

The daily table contained exactly 30 rows. Ticket-type and campaign tables each paged from 20 rows to three independently, with matching bars and unchanged overall totals. Focus returned to period totals after navigation. A custom refund-only day displayed negative net revenue and retained current attendance. A seven-day type filter reset both pages and kept event-level activation and compensation figures separate. An oversized custom period was rejected before a request replaced the valid report. A deliberately aborted refresh removed old figures; retry restored the selected period and ticket type.

At 390 × 844, all three languages fit the page width. Expanded tables scrolled with ArrowRight while keyboard focus remained in their scroll region. The mobile screenshot was inspected for labels, wrapping and section order. Event selection opened the other authorized report and reset the period to 30 days. Analytics-only access worked for a private event. Manage-only access returned 404; revoking analytics access removed figures, title and filter controls on refresh. Signed-out navigation required sign-in. Browser page-error lists were empty.

The dashboard's exact synthetic records, events, grants, accounts, development mail and private credential file were removed after acceptance. No provider operation or external message was sent.

## Report discovery acceptance

The discovery check used 23 additional private fixture events. An analytics-only account could list 22 reports across pages of 20 and two; the event with only an `event:manage` grant was absent. Pagination focused the heading. Search reset the cursor and opened the matching report through its authenticated route. A delayed response from a real earlier search could not replace the newer search result.

The discovery page fit a 390-pixel viewport in all three languages. Revoking its analytics grants removed all private reports from the open page on refresh. All fixture events, grants, accounts, mail and credentials were removed after the check. The browser session was closed; the shared development server remained running.
