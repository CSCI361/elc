# Polar sandbox late-payment compensation

Verified on 2026-09-13 using the saved Helium sandbox checkout and the real local
Worker's configured Polar adapter. The sandbox explicitly states that payments
are not processed. No production payment was made.

The prepared payment `49249daf-eefa-4817-8061-4cc493d898d5` belonged to order
`99fc69b5-1a2f-4a25-925c-84aef1b9d522`. Before submission, provider reconciliation
reported a pending KZT 9,000 payment, an abandoned order and zero tickets. The
existing checkout was submitted once using its already-prepared test card.
Polar returned to the corresponding local payment-return route. No replacement
checkout was created.

The real adapter then observed a successful payment and completed compensation
through Polar. The order remained abandoned. The new
`node scripts/verify-polar-sandbox.mjs verify-compensated` probe repeated
reconciliation twice and verified the canonical records:

| Check                          | Observed result                                            |
| ------------------------------ | ---------------------------------------------------------- |
| Payment state                  | Succeeded                                                  |
| Order state                    | Abandoned                                                  |
| Refund state                   | Succeeded, with provider refund ID and confirmation time   |
| Refund amount                  | 900,000 minor units, equal to the complete KZT 9,000 order |
| Refund records for the payment | Exactly one after repeated reconciliation                  |
| Tickets issued                 | Zero                                                       |
| Sold or held inventory slots   | Zero                                                       |
| Active promo allocations       | Zero                                                       |

The private acceptance state records the verified compensated order. Preserve
that state and the local sandbox fixtures for subsequent acceptance. Do not
submit this checkout again. The repeatable probe prints only state, amounts and
counts; it does not print credentials, customer details or checkout tokens.

This establishes actual sandbox full-refund compatibility and compensation for
a paid abandoned reservation. Signed provider delivery and a fulfilled-order voluntary refund now have
[separate evidence](./polar-webhooks-refund.md). Deployed runtime and paid
event-cancellation refund acceptance remain pending. The existing activation and completed mixed-ticket
basket results remain recorded in [provider readiness](./provider-readiness.md).
