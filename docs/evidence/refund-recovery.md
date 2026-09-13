# Refund recovery evidence

Updated: 2026-09-13

`GET /api/refunds/:refundId/recovery` reports available recovery actions to the
event owner or staff with current `refund:initiate` permission. Other staff and
the purchaser receive no recovery details. The corresponding POST requires a
reason, the current refund update timestamp and an idempotency key.

Reconciliation reads provider status without sending a new refund request. An
authorized retry is available only after a definite rejection with no provider
refund identity. Its durable outbox job performs a fresh lookup before claiming
one financial attempt. A lost response retains that claim, so queue retries can
only look up the existing request. Each new definite rejection needs another
explicit authorization. A failed refund with an assigned provider identity stays
available for reconciliation; it cannot create another refund through this action.

Recovery keeps the original full-refund request, amount, approval and accounting
identity. The authorization audit preserves the earlier failure state, error code,
timestamp and recovery reason. Failed attempts also record their error category
and recovery identifier in audit history. Admission and payout holds remain in
place until verified refund confirmation completes the existing obligation.

Ten real D1 tests pass. They cover request replay, repeated rejection and renewed
authorization, uncertain responses with temporarily empty lookups, competing
authorizations and queue consumers, discovery of an existing refund before POST,
read outages, provider-assigned failed refunds, independent/revoked permission,
stale state and changed idempotency input. The expanded financial run passed
70 tests across recovery, orchestration, voluntary refunds, payouts and webhooks.

The provider is a recorded test adapter in these tests. Actual Polar recovery
through these operator controls and deployed queue execution remain pending.
[Signed webhook delivery and a fulfilled-order refund](./polar-webhooks-refund.md)
have since passed through the local Worker.
[Browser recovery controls](./web-refund-recovery.md) passed contract checks in
all three languages using intercepted responses, without sending provider requests.
