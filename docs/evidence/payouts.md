# Simulated payout evidence

Updated: 2026-09-13

Payouts are internal demonstration records. They never send money or call a
bank or payment provider. Cron processes up to five eligible events per sweep,
with at most twenty orders in each atomic payout run.

The full balance stays held until seven days after event end. A run includes
completed, confirmed attendee payments and deducts the orders' frozen processing
fees. Activation payments stay separate. Pending or failed refunds and unresolved
refund, dispute or compensation cases withhold their affected orders. Resolving
a case makes an otherwise eligible order available to the next sweep. Ordinary
support cases and later changes to sales activation do not create an extra reserve.

The commit rechecks every selected order, payment, event end time and financial
hold. Unique order/payment allocations prevent concurrent runs from paying twice.
The payout, immutable item snapshots, audit and notification outbox record commit
together. A subsequently confirmed full refund records a linked negative adjustment
in the refund transaction. Original payout amounts and fees remain in history.

`GET /api/events/:eventId/payouts` requires current event analytics permission;
event owners have that permission implicitly. The authorized D1 read transaction
returns the event's time zone, release date, balance breakdown and bounded payout
history with linked adjustments. Provider credentials are excluded. Cursor pages
recheck access and cannot return more than fifty payout records.

Twelve real D1 tests pass. They cover the exact seven-day boundary, database-clock
Cron execution, partial holds and later release for each financial case category,
pending and failed refunds, sales suspension, multi-order rollback during races,
competing runs, immutable history, post-payout cancellation/refund adjustments,
current authorization and cursor pagination. The integrated financial run passed
58 tests across payouts, voluntary refunds, cancellation and payment orchestration.

[Payout browser verification](./web-payouts.md) now covers all displayed amounts,
linked adjustments, access revocation, pagination and the three languages.
Deployed Cron execution and notification delivery remain pending. These local
tests do not establish external-provider refund compatibility.
