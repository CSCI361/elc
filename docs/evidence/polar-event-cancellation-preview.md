# Paid event-cancellation refund on the preview Worker

Verified on 2026-11-23 (Asia/Almaty) on the deployed preview,
`https://elc-preview.ertaev-19102007.workers.dev`, with the real Polar sandbox
adapter, the deployed minute cron, the delivery queue and signed webhooks. All
payments used Polar's sandbox test card; no real money moved. Setup and
repeatable steps are in [the preview setup guide](../polar-preview-setup.md).

## Configuration

- Polar sandbox organization `elc_swe`
  (`bb276083-5213-493a-aba7-ab02042340c2`) with a private one-time KZT product,
  `b33c505e-90b5-4702-a54d-d8e0b68edad1`.
- A 90-day organization token with checkout, order, product, refund and webhook
  scopes, stored only as a Worker secret and in an ignored local file.
- Webhook endpoint `0e4bb740-460b-4795-841d-49fc5a9067f4` at
  `/api/webhooks/polar`, API version `2026-04`, registered by
  `node scripts/configure-polar-webhook.mjs preview`, which also stored the four
  Polar secrets on `elc-preview` without printing them.

No token, webhook secret, card detail or customer email is recorded here.

## Defects found and fixed during the run

1. **Reserved demo emails.** Every checkout failed before reaching Polar: the
   adapter prefilled `customer_email`, and Polar returns 422 for special-use
   domains such as the demo accounts' `@example.test`. The adapter now prefills
   only deliverable domains; otherwise the buyer types an email on Polar's page.
   Merged in CSCI361/elc pull request 1.
2. **Reused Polar customer.** Polar keeps one customer per email. The buyer paid
   with the email already used for the organizer's activation, so Polar attached
   the ticket order to the organizer's customer, whose `external_id` is the
   organizer's account. The adapter compared that field with the buyer and
   rejected the order: every `order.*` webhook returned 400 and the payment stayed
   pending although Polar had it paid. Ownership is still bound by the order's
   checkout (whose `external_customer_id` is checked) and the metadata binding,
   which includes the account, amount and request hash; the redundant comparison
   was removed. Merged in CSCI361/elc pull request 2.

Both fixes have unit tests in `apps/api/src/payments/polar.test.ts` (68 tests).

## Event cancellation (the acceptance case)

Event `2f0f471c-16b7-4f04-9842-f456fbf39189` ("Polar refund test"), one
general-admission ticket type at KZT 1,000.

| Step                  | App record                                                   | Polar record                                                     |
| --------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| Activation fee        | Payment `bced9eac…` succeeded, KZT 5,000; paid sales enabled | Order `4be3ec56…` paid, KZT 5,000                                |
| Ticket purchase       | Order `a09109cb…` completed, 1 valid ticket `375c3ba5…`      | Order `ef12f703…` paid, KZT 1,000                                |
| Organizer cancels     | Event cancelled; admission blocked at once                   | —                                                                |
| Cron sweep (~1 min)   | Refund `13e34f48…`, reason `event_cancelled`, KZT 1,000      | Refund `0bfd8cff…` created with `elc_refund_id` = `13e34f48…`    |
| Provider confirmation | Refund succeeded, confirmed 19:43:35; order `refunded`       | Refund succeeded; order `ef12f703…` refunded, KZT 1,000 of 1,000 |

After confirmation the organizer's registrations view shows the ticket as
**Refunded** and **Admission blocked**. The order's remaining processing fee
(originally KZT 30) and estimated payout contribution are both zero. The
activation fee stays paid: activation is non-refundable once it succeeds.

Webhooks delivered after the second fix (`checkout.updated`, `order.created`,
`order.paid`, `order.updated`, `refund.created`, `refund.updated`,
`order.refunded`) were all acknowledged with 202. The endpoint's delivery list
also holds 40 earlier 400 responses: Polar's attempts and retries for the
reused-customer order before fix 2 was deployed.

## Late payment compensation (additional path)

The first ticket order, `48e3884a…`, was the one stuck by defect 2. Its
reservation expired while the fix was being deployed. Once deployed, the next
reconciliation accepted the payment (`677b5a20…` succeeded), found the
reservation expired, issued no ticket and requested a full technical
compensation refund (`eef1ca65…`). Polar shows order `7e09a337…` refunded,
KZT 1,000, refund `79b873b5…` succeeded. The order is `expired` with its fee and
payout contribution at zero.

## Limits

This covers one paid order in one cancelled event. It does not cover a
cancellation sweep across many orders, provider refund failure or timeout
recovery on the deployed Worker, or the 50-event/10,000-ticket workload.
