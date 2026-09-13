# Provider readiness

Reviewed on 2026-09-13 (Asia/Almaty). This records provider documentation, access
checks, completed sandbox activation and ticket payments, and a confirmed full
refund for a paid abandoned reservation. See [compensation evidence](./polar-compensation.md).
Signed webhook delivery and the fulfilled-order voluntary refund now pass through
the local Worker. See [signed delivery and refund evidence](./polar-webhooks-refund.md).
Cloudflare deployment acceptance remains pending.

Polar documents KZT pricing, quantity pricing, discounts, refunds and signed
webhooks. Its checkout buys one product; a list of products offers a choice.
A completed mixed-ticket basket and a late-payment compensation refund now
establish those sandbox paths. Business eligibility would require a provider decision
before a production launch, which is outside this academic release. Missing
credentials are an access limitation, not evidence that Polar cannot support ELC.
No alternative provider has been selected by this investigation.

## Access available during inspection

Only environment variable names and configuration key names were inspected for
credentials at the initial inspection. Secret values are excluded from this
document and version control; the authorized sandbox token is stored locally.

| Check                  | Observation                                                                                                                | What it establishes                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Process environment    | No names containing `POLAR`, `CLOUDFLARE` or `WRANGLER`                                                                    | No matching credential was supplied through this process environment.                                                       |
| Repository root        | No `.env`, `.env.*`, `.dev.vars` or `.dev.vars.*` existed at the initial check                                             | No root environment file was available for this acceptance run. Other work may add example files later.                     |
| Polar configuration    | `~/.polar` and `~/.config/polar` absent; `polar` absent from PATH                                                          | No Polar CLI/config access found through these locations. A signed-in browser or another secret store was not investigated. |
| Wrangler configuration | A saved OAuth login exists; the subsequent root-task `wrangler whoami` succeeded with D1, Workers and Queues write grants. | Cloudflare authentication and these grants are verified. No account identifiers or email addresses are recorded here.       |
| Tool commands          | `vp`, `pnpm`, `node` present; `wrangler` absent from PATH at initial inspection                                            | Existing Vite+ commands can run. This does not rule out a project-local Wrangler installed by subsequent work.              |

The user subsequently signed in to the `elc` sandbox organization through their
existing Helium browser session. The sandbox banner explicitly states that
payments are not processed. A private, one-time product named `elc sandbox
ticket order` was created with KZT 9,000 pricing; the catalogue confirmed the
product and displayed ₸9,000. Its sandbox product ID is
`66720b47-54e1-453f-91a1-58f6a35cbd30`.

The user approved a 30-day token named `elc-academic-sandbox`, scoped to checkout
read/write, order and product read, refund read/write, and webhook read/write.
It was created through the existing browser session and saved to the ignored
`apps/api/.dev.vars` file with mode 0600. The file preserves the existing auth
and ticket encryption keys. No token value was printed or committed.

Authenticated product list and product detail requests returned HTTP 200 with
`Polar-Version: 2026-04`; the detail matched the product ID and KZT currency.
The probe used `User-Agent: elc-sandbox-acceptance/1.0`; the initial default
Python user-agent received 403. The completed checkout, refund and signed-delivery evidence extends this initial
access probe. No provider contact or production operation occurred.

Polar sandbox uses a separate account, organization and token, with API base
`https://sandbox-api.polar.sh/v1`. Production tokens do not authenticate there.
It supports test card payments; customer emails are limited to organization
members and their sub-address aliases. A sandbox organization token and webhook
secret are required to complete the cases below. [Polar sandbox](https://polar.sh/docs/integrate/sandbox)

## Actual sandbox checkout evidence

The resumed run used authenticated HTTP accounts with sandbox-member aliases,
a real event and two ticket types, a 10% campaign, publication and the activation
checklist. It used the existing sandbox organization and the pinned SDK adapter
inside the local Worker. No payment result or activation flag was seeded into D1.
The browser submitted Polar's documented test card through its hosted checkout.

- Activation displayed and charged KZT 5,000 (`500000` minor units). Authoritative
  provider lookup matched the frozen metadata, amount and currency, and the app
  recorded one successful activation with current eligibility `active`.
- A basket containing one KZT 5,000 adult ticket and two KZT 2,500 student tickets
  had a KZT 10,000 subtotal and KZT 1,000 discount. Polar displayed KZT 9,000 with
  inclusive taxes of zero. Its aggregate product represented the frozen basket;
  ticket-type lines and attendee names remained in elc's canonical order.
- After the test card payment, authoritative lookup returned the matching paid
  order. The app completed exactly one order, issued three canonical tickets,
  sold exactly three inventory slots and committed one promo allocation.
  The organizer-paid processing fee snapshot was `27000` minor units (KZT 270).
- All nine PDF downloads (three tickets in kk/ru/en) returned protected PDFs
  through the running Worker. Credential retrieval before and after generation
  was identical. The command `node scripts/verify-polar-sandbox.mjs verify-paid`
  asserted those facts without printing the credentials.
- Polar added a customer session bearer value to its browser return URL. The app
  now removes it before rendering navigation or constructing sign-in return URLs.
  A subsequent actual return retained only the app payment-attempt identifier.

A second KZT 9,000 checkout was paid after its local reservation was abandoned.
The app confirmed a full compensation refund, issued no tickets and retained no
inventory. That fixture remains intact. The first completed mixed-ticket order
was subsequently refunded through the attendee support and organizer approval
flow; its three tickets now reject admission as refunded.

The later HTTP/2 tunnel connected successfully. A temporary sandbox endpoint
using Standard Webhooks and API version `2026-04` delivered five real events to
the local Worker, all HTTP 202. Exact duplicates and Polar redelivery retained
one canonical event/outbox row per event; tampered bodies returned 400. The
endpoint was disabled and the proxy/tunnel stopped after acceptance. See
[signed delivery and refund evidence](./polar-webhooks-refund.md).

Cloudflare's read-only R2 inventory request returned code `10042`, requiring R2
activation in the account dashboard. The existing remote D1 database belongs to
another project and was not modified. No elc remote resource has been deployed.

## Documented Polar capabilities

The table preserves the questions from the initial documentation review. The
actual evidence above resolves KZT checkout, aggregate basket amounts, reference
matching, compensation, a fulfilled-order refund and genuine signed delivery.
Remaining variants in the acceptance matrix still need their stated evidence.

| Requirement                | Evidence                                                                                                                                                                                                                                                                                                                                     | Original acceptance question                                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KZT                        | KZT is explicitly listed among product pricing currencies. Server-created sessions should forward the actual customer IP if relying on automatic currency selection. [Products](https://polar.sh/docs/features/products)                                                                                                                     | KZT checkout, payment, receipt and refund in the intended sandbox organization.                                                                                                                         |
| Currency and price control | Checkout schema accepts `currency`, and `prices` maps a product ID to ad-hoc prices. Fixed prices use `price_amount` and `price_currency`. Top-level `amount` applies to custom pricing, not fixed-price overrides. [Create checkout](https://polar.sh/docs/api-reference/2026-04/checkouts/create-checkout-session)                         | Exact currency/amount returned by the chosen API version, including tax and discounts.                                                                                                                  |
| Several ticket types       | Multiple `products` are alternatives. Polar explicitly says customers purchase one product per checkout. [Checkout links](https://polar.sh/docs/features/checkout/links)                                                                                                                                                                     | Whether one aggregate product with an immutable ELC basket reference meets the required checkout and receipt experience. This is a candidate to test, not an accepted substitute for native cart lines. |
| Quantities                 | Unit-based pricing supports one-time purchases, integer quantities and fixed, graduated or volume rates. It grants benefits once per customer, not once per unit. [Unit-based pricing](https://polar.sh/docs/features/unit-based-pricing)                                                                                                    | A quantity locked to ELC's reserved inventory, with exactly that many app-issued tickets.                                                                                                               |
| Seat pricing               | Seat-based products support people who claim membership benefits. One-time orders have their own seat pool. [Seat-based guide](https://polar.sh/docs/guides/seat-based-pricing)                                                                                                                                                              | ELC tickets must not inherit invitation, claim or perpetual-license behavior by accident.                                                                                                               |
| Discounts                  | Percentage and fixed discounts can apply to one-time products. Restrictions include products, dates and redemption limits. [Discounts](https://polar.sh/docs/features/discounts)                                                                                                                                                             | KZT fixed discounts, percentage rounding, invalid/expired codes and concurrent redemption limits.                                                                                                       |
| Order reference            | Checkout metadata is copied to the order/subscription. It allows 50 flat entries, keys up to 40 characters, string values up to 500 characters, or numeric/boolean values. [Checkout API](https://polar.sh/docs/features/checkout/session), [Create checkout](https://polar.sh/docs/api-reference/2026-04/checkouts/create-checkout-session) | An app order ID and basket hash survive checkout, payment, webhook and refund reconciliation. Keep the full basket snapshot in ELC storage.                                                             |
| Full refund                | Refunds operate on an order. The refundable base is the remaining net amount; Polar calculates the corresponding tax refund. [Refund behavior](https://polar.sh/docs/features/refunds)                                                                                                                                                       | Correct KZT refund totals and app ticket revocation after successful completion.                                                                                                                        |
| Refund API                 | `POST /v1/refunds/` requires `order_id`, `reason`, integer `amount`, and `refunds:write`. It supports metadata and `revoke_benefits`; resulting status can be pending, succeeded, failed or canceled. [Create refund](https://polar.sh/docs/api-reference/2026-04/refunds/create-refund)                                                     | Full refund and recovery when a request times out. A created refund must not be assumed successful.                                                                                                     |
| Payment/refund events      | Events include `order.paid`, `order.refunded`, `refund.created`, `refund.updated` and `checkout.expired`. [Webhook events](https://polar.sh/docs/integrate/webhooks/events)                                                                                                                                                                  | Actual payloads, delivery ordering and reconciliation against app state.                                                                                                                                |

Ticket sales appear under restricted businesses requiring closer review and may
not be accepted. This is a business eligibility gate separate from API support.
The reviewed policy does not establish that ELC has been approved or rejected.
[Polar acceptable use policy](https://polar.sh/legal/acceptable-use-policy)

## Webhook and SDK compatibility

Polar changed signing key interpretation on 2026-09-08 at 00:00 UTC. New secrets
use Standard Webhooks; older secrets use the UTF-8 bytes of the entire secret as
the HMAC key. The docs state SDK versions `1.0.0-alpha.19` and later accept both.
Use the exact raw body and verify before acting. Deliveries retry up to ten times;
the documented timeout is ten seconds and the recommended response time is under
two seconds. Redelivery is available in the dashboard.
[Webhook delivery](https://polar.sh/docs/integrate/webhooks/delivery)

Published package metadata on the review date reports `@polar-sh/sdk` latest as
`0.49.0` and next as `1.0.0-alpha.21`. In-memory inspection of the published
`0.49.0` package's `src/webhooks.ts` confirmed that its verifier uses only the
legacy full-secret encoding. Installing `latest` does not establish compatibility
with a newly generated webhook secret.
[Published SDK metadata](https://registry.npmjs.org/@polar-sh/sdk)

The current TypeScript documentation describes the preview SDK, a versioned
`createPolar` import and `environment: "sandbox"`. Older examples use
`new Polar({ server: "sandbox" })`. Do not mix constructors, option names or
webhook parsers from these two SDK generations.
[TypeScript SDK](https://polar.sh/docs/integrate/sdk/typescript)

The examined API pages resolved to the `2026-04` reference. Versioning docs say to
pin `Polar-Version` for requests and `api_version` for webhook endpoints. Supported
versions change quarterly; the sandbox endpoint and actual delivered payloads were verified with
credentials at version `2026-04`. Choose and verify the supported version before executing acceptance,
then record the response version and `webhook-api-version`. Do not infer support
from the reference URL or calendar alone.
[API versioning](https://polar.sh/docs/api-reference/2026-04/versioning)

## Sandbox acceptance procedure

Product API access, activation, the mixed-ticket payment, compensation, a
fulfilled-order voluntary refund and signed webhook delivery are verified. The
procedure below also covers remaining event-cancellation and deployment cases.
Use a dedicated sandbox organization and synthetic
customers. Store evidence with the chosen API/SDK version, request shape, object
IDs, status, currency, amounts, event IDs and assertions. Exclude access tokens,
webhook secrets, checkout client secrets and customer payment details.

First, supply `POLAR_SANDBOX_ACCESS_TOKEN` and a verified `POLAR_API_VERSION`
through the execution environment. This read-only probe prints no response body
or token and can establish whether the supplied access works:

```sh
python3 - <<'PY'
import os
import urllib.error
import urllib.request

request = urllib.request.Request(
    "https://sandbox-api.polar.sh/v1/products/?limit=1",
    headers={
        "Authorization": "Bearer " + os.environ["POLAR_SANDBOX_ACCESS_TOKEN"],
        "Polar-Version": os.environ["POLAR_API_VERSION"],
        "Accept": "application/json",
    },
)
try:
    with urllib.request.urlopen(request, timeout=20) as response:
        print("http_status", response.status)
        print("api_version", response.headers.get("Polar-Version"))
except urllib.error.HTTPError as error:
    print("http_status", error.code)
PY
```

| Case                          | Execute                                                                                                                                                                                                         | Pass condition                                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1: Access and contract       | Run the probe. Confirm the organization in the sandbox dashboard and pin the same supported version for the webhook endpoint.                                                                                   | Authorized response and explicit version; required product, checkout, order, refund and webhook permissions available. Authentication failure remains an access failure.                |
| P2: Single ticket             | Create a one-time KZT product, create a hosted checkout, pay with the documented test card, retrieve the resulting order.                                                                                       | Checkout, order and receipt show the expected KZT price; the verified `order.paid` event fulfills exactly once.                                                                         |
| P3: Quantity                  | Use a unit-based product at 3,000 KZT with quantity 3; set checkout quantity bounds to the reservation quantity. Attempt a quantity change.                                                                     | The charged quantity matches the reservation; the 9,000 KZT subtotal produces exactly three tickets. Inventory cannot be expanded at checkout.                                          |
| P4: Different ticket types    | Record an ELC basket with one 5,000 KZT adult ticket and two 2,000 KZT student tickets. Test an aggregate fixed-price checkout with the app order reference, if that representation is accepted for evaluation. | One 9,000 KZT subtotal, preserved ticket-type snapshots and three correctly typed tickets. Record receipt/itemization limitations explicitly. A product selector alone fails this case. |
| P5: Discounts                 | Apply a 10% discount to the 9,000 KZT fixture, then test a KZT fixed discount, invalid code, expiry and exhausted redemptions.                                                                                  | Expected discounted net amounts, one application of the discount, correct tax treatment and no fulfillment for a rejected checkout.                                                     |
| P6: Reference integrity       | Compare metadata on session, order and signed payment event. Submit a payment event for another order/currency/amount to the app's verifier tests.                                                              | Valid payment matches the immutable basket; mismatches cannot issue tickets.                                                                                                            |
| P7: Refunds                   | Fully refund a paid KZT order and wait for final status. Retry/redeliver the resulting events. Exercise timeout recovery separately.                                                                            | Refunded net/tax totals reconcile; all tickets in the refunded order become invalid; a retry cannot cause duplicate financial requests or duplicate ticket transitions.                 |
| P8: Signatures and replay     | Deliver a genuine sandbox event. Repeat it, alter one body byte, omit a required signature header, use a stale timestamp and test both key encodings if supporting older secrets.                               | Genuine signature succeeds; altered/invalid events fail; repeats have no duplicate effects. Local signed fixtures alone do not prove provider delivery.                                 |
| P9: Failure recovery          | Let a checkout expire; test a declined test payment; temporarily return a controlled error from the test endpoint and inspect redelivery.                                                                       | No unpaid tickets; reservations released by app policy; a later valid event reconciles once.                                                                                            |
| Future production eligibility | Obtain and retain a provider decision for ELC's ticket-sales business before production launch.                                                                                                                 | The actual business and transaction representation are accepted. No provider contact was made during this review.                                                                       |

For P4, the following is a proposed request body to
`POST https://sandbox-api.polar.sh/v1/checkouts/`. Replace the UUID and metadata
with an existing sandbox product and synthetic app order. The app must compute
the price from its stored basket rather than accept a browser-supplied amount.
This fixture does not claim native ticket-type line items. [Create checkout](https://polar.sh/docs/api-reference/2026-04/checkouts/create-checkout-session)

```json
{
  "products": ["SANDBOX_PRODUCT_UUID"],
  "currency": "kzt",
  "prices": {
    "SANDBOX_PRODUCT_UUID": [
      {
        "amount_type": "fixed",
        "price_currency": "kzt",
        "price_amount": 900000,
        "tax_behavior": "inclusive"
      }
    ]
  },
  "allow_discount_codes": false,
  "metadata": {
    "elc_order_id": "acceptance-mixed-001",
    "elc_cart_hash": "HASH_OF_IMMUTABLE_BASKET"
  }
}
```

Validate the minor-unit conversion, provider minimum and displayed KZT subtotal
before payment. Use inclusive tax and require the final total to match the
frozen app amount. Apply a discount once: either send the undiscounted price with the provider discount or
send the final app-calculated price with checkout discounts disabled.

## Hono, Workers, D1 and Vite+

`vp toolchain` reported Vite+ `0.3.1`, bundled Vite `8.2.2`, Rolldown `1.2.7` and
Vitest `4.1.11`. The local Vite+ troubleshooting guide requires Vite 8+ and Vitest
4.1+. It recommends `lazyPlugins` so checks and task discovery do not initialize
runtime plugins unnecessarily. The migration guide requires a common aliased
Vite and aligned Vitest versions across the workspace.

- Local sources: `node_modules/vite-plus/docs/guide/troubleshooting.md` and
  `node_modules/vite-plus/docs/guide/migrate.md`.
- Preserve project imports from `vite-plus` and `vite-plus/test` and the
  `vite` alias to `@voidzero-dev/vite-plus-core`.

Cloudflare publishes a Hono API + React SPA + Vite plugin template. Hono receives
D1 through its typed `c.env` binding; the Worker configuration declares the
binding. Both Wrangler and the Vite plugin support local D1 simulation, so local
API/database acceptance does not require a deployed database.
[Cloudflare Hono guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/hono/),
[D1 with Hono](https://developers.cloudflare.com/d1/examples/d1-and-hono/),
[Local bindings](https://developers.cloudflare.com/workers/local-development/bindings-per-env/)

| Published package checked on review date | Compatibility evidence                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@cloudflare/vite-plugin` 1.54.8         | Declares Vite `^6.1.0`, `^7.0.0` or `^8.0.0`; published Wrangler peer is `^4.131.1`. [Official source](https://github.com/cloudflare/workers-sdk/blob/main/packages/vite-plugin-cloudflare/package.json), [Published metadata](https://registry.npmjs.org/@cloudflare/vite-plugin/1.54.8) |
| `wrangler` 4.131.1                       | Requires Node `>=22.0.0`. [Published metadata](https://registry.npmjs.org/wrangler/4.131.1)                                                                                                                                                                                               |
| `@cloudflare/vitest-pool-workers` 0.22.0 | Declares Vitest, runner and snapshot peers `^4.1.0`. [Published metadata](https://registry.npmjs.org/@cloudflare/vitest-pool-workers/0.22.0)                                                                                                                                              |
| `hono` 4.13.7                            | Official Workers guide documents typed bindings and Worker export. [Hono guide](https://hono.dev/docs/getting-started/cloudflare-workers), [Published metadata](https://registry.npmjs.org/hono/4.13.7)                                                                                   |

These declarations support trying the existing Vite+ toolchain. They are not a
runtime compatibility test of ELC's eventual monorepo. Package managers may still
warn about the Vite alias version; do not replace the alias solely to silence a
peer warning without checking the resolved toolchain.

Set an explicit Worker `configPath` when the monorepo's Vite and Wrangler configs
live in different directories. Keep local persistence paths aligned between
migration commands and the runtime. The plugin defaults to `.wrangler/state` and
supports an explicit `persistState.path`. Use local bindings for the initial
acceptance run; ensure no binding is marked remote.
[Cloudflare plugin API](https://developers.cloudflare.com/workers/vite-plugin/reference/api/)

Local Workers startup, migrated D1 queries through Hono, browser authentication,
free-ticket transactions, and the web/Worker/marketing build now pass. See
[checkout evidence](./checkout.md) and [web authentication](./web-authentication.md).
Actual sandbox activation and mixed-ticket transactions now pass as recorded
above. A full late-payment refund also passes as recorded in
[compensation evidence](./polar-compensation.md). A fulfilled-order voluntary
refund and genuine signed delivery also pass, as recorded in
[signed delivery and refund evidence](./polar-webhooks-refund.md). Paid event
cancellation, operator recovery variants and deployed runtime acceptance remain
pending. Node-only mocks cannot establish those results.
