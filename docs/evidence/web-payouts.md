# Organizer payout web view

The protected route `/organizer/events/:eventId/payouts` reads `GET /api/events/:eventId/payouts`. Event editors, including cancelled-event editors, link to it. The report uses the shared response schema and server amounts, dates, event title and time zone. It adds no payment or payout mutation.

The summary separates original simulated payouts from later negative refund adjustments. Each immutable payout expands into an order table with its frozen payment, processing fee and contribution, plus any subsequent refund adjustment. Order references are plain text because analytics access does not grant access to order credentials or refund conversations.

Kazakh, Russian and English copy explains the seven-day delay after event end, full contribution holds for unresolved financial cases and pending or failed refunds, and the absence of a bank transfer. Tables have captions and row/column headers. Their narrow-screen scroll regions support keyboard navigation. Pagination uses the server cursor, displays 20 records per page, and moves focus to the history heading after a page change.

The report requires an active verified account and current ownership or `analytics:read` permission. The API checks that authority. Requests use the existing same-origin, no-store resource helper, with a 15-second refresh. Errors take precedence over previously loaded data, so failed requests and permission revocation remove the financial figures. Changing the account or event resets the report. Loading states are announced, and denial/error notices receive focus and offer retry.

## Validation

- `vp check apps/web/src/payouts apps/web/src/App.tsx apps/web/src/events/editor.tsx` passed.
- `vp test apps/web/src/payouts/policies.test.ts` passed all three route, cursor and financial-display boundary tests.
- `vp exec tsc -p apps/web/tsconfig.json --noEmit` passed.
- `vp run --filter @elc/web build` passed. The payout page is a separate 12.50 kB JavaScript chunk. The existing entry chunk remains above the 500 kB warning threshold at 585.68 kB.
- React review covered the lazy route, account-keyed report, abortable resource lifecycle, separate record component, pagination focus and semantic tables.

## Local browser acceptance

Independent `elc-payout-owner` and `elc-payout-analyst` agent-browser sessions used the existing local Worker at `http://localhost:5173`. Two synthetic accounts were registered and verified through the real authentication endpoints and private development mailbox. Event `ec7bef04-f50c-4231-9005-3ef0bbe263f5` was created through the event API.

The owner first saw an empty report with zero amounts and a seven-day eligibility date. To exercise historical presentation without calling a provider, the fixture then inserted 23 explicitly synthetic completed payments and 21 payout records into local D1. It set the event end eight days in the past, inserted one later confirmed refund with a negative adjustment, and left one unpaid order under an unresolved refund case. Database constraints and guards remained enabled. This proves report integration, not provider payment processing or the scheduled simulation transition; those are covered separately by the API payout tests.

All nine displayed values matched the API response exactly:

| Measure                           |       KZT |
| --------------------------------- | --------: |
| Confirmed ticket payments         | 21,700.00 |
| Confirmed refunds                 |  1,000.00 |
| Remaining processing fees         |    621.00 |
| Estimated organizer contribution  | 20,079.00 |
| Original simulated payouts        | 20,370.00 |
| Later refund adjustments          |   -970.00 |
| Outstanding contribution          |    679.00 |
| Held contribution                 |    485.00 |
| Available for the next simulation |    194.00 |

The first expanded record kept its original 1,000.00 payment, 30.00 fee and 970.00 contribution alongside the later -970.00 adjustment. Pagination returned 20 records followed by one, with no duplicate and no further cursor. Focus returned to the history heading. The editor link opened the report.

An account granted only `analytics:read` could read the report. Replacing that grant with `event:manage` made the API return 404; refreshing removed all amounts and records and focused the denial notice. An intentionally aborted report request also removed the figures, and retry after restoring the request loaded the real report again. Signed-out navigation required sign-in.

At a 390 × 844 viewport, all three languages stayed within the page width. The expanded order table scrolled inside its region; ArrowRight moved it 40 pixels while keyboard focus stayed on that region. Axe 4.10.3 found zero violations in the report's main content in each language. Browser page-error lists were empty. A mobile screenshot was inspected for wrapping and spacing.

Both browser sessions were closed. The exact synthetic payout adjustments, payout items, payouts, refunds, support case, reservations, payment attempts, orders, event, permissions, audit/receipt/outbox rows, mail and accounts were removed. Cleanup confirmed that the event and both accounts were absent, then deleted the private fixture file. No external provider operation or bank transfer was performed.
