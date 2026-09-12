# Polar sandbox adapter

The API has a Polar sandbox adapter in `apps/api/src/payments/polar.ts`. It uses
`@polar-sh/sdk` pinned to `1.0.0-alpha.21`, the versioned `2026-04` exports, and
`Polar-Version: 2026-04`. The transport fixes the API origin to
`https://sandbox-api.polar.sh` and sends `User-Agent: elc-sandbox-acceptance/1.0`.
The adapter has no production mode.

Configure `POLAR_ACCESS_TOKEN`, `POLAR_PRODUCT_ID`, `POLAR_ORGANIZATION_ID`,
`POLAR_WEBHOOK_SECRET`, `APP_ORIGIN`, and `ENVIRONMENT`. Secrets belong in the
ignored local variables file or deployment secret storage. The committed example
contains no token or webhook secret. Configure the provider webhook endpoint for
API version `2026-04` separately from the outgoing request version.

## Payment and refund mapping

Each checkout contains one configured, one-time product with an ad-hoc fixed KZT
price equal to the complete frozen attendee basket. The adapter sets inclusive
tax and disables discount codes and trials. An organizer fee remains internal to
elc. The checkout's gross amount must equal the attendee amount; tax is extracted
from that amount. Positive amounts below KZT 300 are rejected before a provider
request. Free orders use the API's free-order path.

`PaymentBinding` carries the internal attempt ID, purpose, subject ID, account ID,
request hash, gross minor-unit amount, and currency. The adapter sends these
values and the environment in provider metadata. Every lookup compares them with
the frozen expected binding. It also checks the configured product and
organization, external customer ID, checkout/order linkage, gross total,
discounts, balance credits, and refunded totals. Null or malformed metadata fails
validation. Errors omit provider response bodies and customer data.

`providerPaymentId` always means the Polar checkout ID. `providerOrderId` means
the distinct Polar order ID. `lookupPayment` reads the checkout and its order,
using `GET /v1/orders/?checkout_id=…` until the order ID is known, then
`GET /v1/orders/{id}`. A checkout in `confirmed` or `succeeded` state cannot
establish payment by itself. A validated paid order establishes payment;
`refundedAmountMinor` includes both refunded net amount and refunded tax.

Refunds are full refunds keyed by a stable internal `refundId`. Polar's refund
POST takes the remaining net amount, while its response reports net and tax
separately. The adapter requires their sum to equal the frozen gross amount. For
example, a KZT 9,000 payment containing KZT 1,500 tax produces a refund POST with
`amount: 750000`, and the response must contain `amount + tax_amount === 900000`.
The metadata includes the internal refund ID and both provider IDs. A provider
refund in `pending` state remains pending. Only `succeeded` confirms completion;
`canceled` maps to failed.

## Dispatch and recovery

The shared `PaymentAdapter` contract exposes `createCheckout`, `recoverCheckout`,
`lookupPayment`, `refund`, `lookupRefund`, and `verifyWebhook`.

The adapter does not assume a provider `Idempotency-Key` guarantee and never
automatically retries a financial POST. The caller must claim each dispatch in
durable storage before invoking it. A network error, timeout, server failure, or
invalid financial response has an uncertain outcome and requires reconciliation.
A conclusive client rejection is reported separately through
`ProviderOperationError`; ambiguous conflict responses require reconciliation.

`recoverCheckout` lists checkouts for the configured product and external account,
then matches the immutable attempt metadata. `lookupRefund` validates the linked
payment and lists refunds for its order, then matches the stable internal refund
ID. Recovery scans at most 20 pages of 100 items and rejects duplicates or an
incomplete scan. A null lookup result does not prove that a prior POST failed to
reach the provider. It is not permission to resubmit. An existing failed refund
is returned as failed; this adapter does not create an implicit replacement.

## Webhook acknowledgment

`verifyWebhook` verifies the signature over the raw body using the SDK verifier,
then validates the API version and relevant runtime fields. Both legacy literal
secret encoding and StandardWebhooks `whsec_` base64 encoding are tested. Missing
signatures, altered bodies, and timestamps outside the five-minute tolerance fail.
Verified irrelevant events return null.

Verification performs no provider I/O. It returns only normalized signed facts.
Checkout facts carry no order ID and do not establish payment. Order facts carry
the paid state, order linkage, and refunded gross total. Refund facts retain the
signed refund state. The API must compare the normalized binding with its frozen
database values, store the delivery and outbox entry, and acknowledge it. The
outbox worker performs authoritative payment lookups after acknowledgment. A
redirect does not establish payment, and older deliveries must not reverse a
committed refund or payment result.

## Validation and remaining acceptance

The adapter and shared contract suite passed 75 tests with
`vp test apps/api/src/payments/polar.test.ts packages/shared/src/contracts.test.ts`.
The suite covers the actual SDK's request origin, version header, user agent and
single POST through a stubbed fetch, exact checkout/refund totals, identity
mismatches, provider ambiguity, recovery, runtime payload validation, both
signature encodings, and zero-I/O webhook verification. Scoped lint passes.

These tests use injected transport responses and signed local fixtures. This
document does not claim a completed provider checkout, real webhook delivery, or
provider refund. Those sandbox acceptance results must be recorded separately.
Provider expiry does not replace elc's reservation deadline; the API must still
handle a late successful payment through its compensation workflow.

## Primary references

- [Polar TypeScript SDK](https://polar.sh/docs/integrate/sdk/typescript)
- [API environments](https://polar.sh/docs/api-reference/2026-04/introduction)
- [API and webhook versioning](https://polar.sh/docs/api-reference/2026-04/versioning)
- [Create a checkout](https://polar.sh/docs/api-reference/2026-04/checkouts/create-checkout-session)
- [Tax-inclusive pricing](https://polar.sh/docs/features/tax-inclusive-pricing)
- [Supported currency minimums](https://github.com/polarsource/polar/blob/main/server/polar/kit/currency.py)
- [Create a refund](https://polar.sh/docs/api-reference/2026-04/refunds/create-refund)
- [List refunds](https://polar.sh/docs/api-reference/2026-04/refunds/list-refunds)
- [Refund net and tax calculation](https://github.com/polarsource/polar/blob/main/server/polar/refund/service.py)
- [SDK transport](https://github.com/polarsource/polar/blob/main/sdk/typescript/src/base.ts)
- [SDK webhook signature verification](https://github.com/polarsource/polar/blob/main/sdk/typescript/src/webhooks.ts)
