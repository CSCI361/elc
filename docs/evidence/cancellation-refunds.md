# Cancellation and refund evidence

Updated: 2026-09-13

These results cover application transitions in isolated, real D1 databases with
a recorded payment adapter. Actual Polar compensation and a fulfilled-order
voluntary refund now pass. See [provider readiness](./provider-readiness.md) and
[signed delivery and refund evidence](./polar-webhooks-refund.md). A paid
event-cancellation refund still needs provider acceptance.

## Event cancellation

`POST /api/events/:eventId/cancel` requires current event-management authority,
the current event revision and a reason. Its atomic commit sets the cancellation
time, advances the calendar sequence, blocks admission, cancels issued tickets
and zero-total orders, and releases incomplete reservations and promo holds.
Completed promo redemptions remain consumed. Completed paid orders keep their
price and fee snapshots while their full refunds settle.

The same commit records the audit entry and queues a bounded cancellation sweep.
Each attendee refund gets a separate durable reconciliation job. In-flight
payments are reconciled independently; a later success that cannot issue tickets
receives technical compensation. Successful event activation remains separate
and non-refundable. Cancellation never returns sold inventory to sale.

Eight D1 tests cover admission before and after cancellation, cancellation after
the voluntary cutoff, retained activation, zero-total tickets and promos,
incomplete holds, late payment, a cancellation racing issuance, stale revisions,
revoked staff, rollback on inventory mismatch, concurrent retries and uncertain
refund recovery. The 17 existing payment-orchestration tests also pass with the
new cancellation and restocking code.

## Voluntary refunds and free cancellation

`POST /api/orders/:orderId/refund` requires the current order revision, approval
reason, and an unresolved attendee refund case matching the order, event and
purchaser. The event owner or staff with `refund:initiate` may approve it. This
permission does not reveal the support conversation; support access remains
independent.

Approval records the actor, case and reason with an immutable full-refund
request. The order becomes admission-blocked before financial I/O. The commit
rechecks the event start time, active canonical check-ins, unresolved reported
offline admissions, current authority, support-case state and order revision.
Only verified provider confirmation sets refunded status. Failures retain the
refund and its approval history; uncertain operations use lookup instead of
another financial POST.

`POST /api/orders/:orderId/cancel-registration` applies the same authority,
cutoff and admission rules to zero-total orders. It records a cancellation
reason and notification job without a provider refund. Completed promo
redemptions remain consumed, including fully discounted paid ticket types.

`GET /api/orders/:orderId/refund` is restricted to the purchaser, event owner or
refund staff. It reports frozen amounts, current approval permission and
eligibility, refund progress, fee reversal and estimated payout contribution.
It excludes provider credentials and conversation text. A confirmed full refund
reduces the original order's remaining simulated processing fee and payout
contribution to zero; the original snapshots remain unchanged.

Twenty-one D1 tests cover approval and replay, blocked admission before dispatch,
independent permissions, support-case resolution during approval, cutoff and
permission races, check-in and reversal, competing approvals, immutable approval
records, failed provider requests, free cancellation and retained promo history.
Restocking tests cover unpublication, paid-sales suspension, changed activation
checks, suspended owners, hidden or closed ticket types, and disabled inventory.
Eligibility is evaluated inside the refund/cancellation batch using D1's clock.
The statements separate the paid-eligibility calculation to stay within D1's
expression-depth limit.

## Integrated follow-on evidence

[Offline backend tests](./offline-backend.md) cover report-first and refund-first
ordering through synchronization services. [Browser tests](./web-support-refunds.md)
cover support, separate financial permission, free cancellation and event
cancellation. [Simulated payouts](./payouts.md) retain financial holds and create
linked adjustments after later refunds. A free event-cancellation sweep also
passes without payment-provider credentials.

## Remaining acceptance

- Complete the actual Polar paid event-cancellation refund check.
- Verify actual provider recovery using the [authorized recovery workflow](./refund-recovery.md).
- Verify deployed scheduling. The [payout browser view](./web-payouts.md) passes
  local acceptance.
- Deliver queued notifications and verify physical scanner invalidation after
  synchronization or snapshot expiry.
