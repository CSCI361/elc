# Polar sandbox on the preview Worker

The preview Worker (`elc-preview`) has no Polar keys by default, so paid sales
there stay unavailable and every sale is free. This guide turns on Polar
**sandbox** payments for preview. The adapter only talks to
`https://sandbox-api.polar.sh`; no real money moves.

Who can do it: someone with access to the Polar sandbox organization and to the
Cloudflare account that owns `elc-preview` (Wrangler stores the secrets there).

## 1. Sandbox organization, product and token

Any sandbox organization works; the app only needs its ID, one product and a
token. Sandbox tokens expire: the token recorded in
[provider readiness](./evidence/provider-readiness.md) was created on 2026-09-13
for 30 days.

1. Sign in at `https://sandbox.polar.sh` and open (or create) the organization.
   Its ID is under Settings → General → Identifiers.
2. Products → New Product: a **one-time** purchase, **fixed price in KZT** (any
   amount; checkout replaces it with the app's frozen basket total) and
   **private** visibility. Copy the product ID from its URL.
3. Settings → Access Tokens → Create token. Pick 90 days or longer and the
   scopes `checkouts:read`,
   `checkouts:write`, `orders:read`, `products:read`, `refunds:read`,
   `refunds:write`, `webhooks:read` and `webhooks:write`.
4. Copy the token once; Polar does not show it again. It starts with
   `polar_oat_`. The Polar dashboard may also copy IDs to the clipboard on its
   own, so check what you paste.

## 2. Local values

Put the values in the ignored `apps/api/.dev.vars` (run `vp run setup:local`
first if the file does not exist). The keys are listed in
`apps/api/.dev.vars.example`:

```sh
POLAR_ACCESS_TOKEN=polar_oat_…
POLAR_ORGANIZATION_ID=<sandbox organization UUID>
POLAR_PRODUCT_ID=<product UUID from step 1>
```

The product ID in `.dev.vars.example` belongs to the original `elc` sandbox
organization; a product from another organization is rejected. Never put these values
in `VITE_*` variables, commits or chat.

## 3. Webhook endpoint and Worker secrets

Sign in to Wrangler as the Cloudflare account owner (`vp exec wrangler login`,
or set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`), then run:

```sh
node scripts/configure-polar-webhook.mjs preview
```

The script:

- reads the preview origin from `env.preview.vars.APP_ORIGIN` in
  `apps/api/wrangler.jsonc` and registers (or re-enables) one sandbox webhook
  endpoint named `elc-preview` at `<origin>/api/webhooks/polar`, with API
  version `2026-04` and the order, checkout and refund events the adapter reads;
- stores `POLAR_ACCESS_TOKEN`, `POLAR_ORGANIZATION_ID`, `POLAR_PRODUCT_ID` and
  the endpoint's own `POLAR_WEBHOOK_SECRET` as secrets on `elc-preview`. Values
  go to Wrangler on stdin and are never printed. The local `.dev.vars` webhook
  secret is left alone, because it belongs to a different endpoint;
- remembers the endpoint ID in the ignored
  `.wrangler/polar-webhook-endpoint.preview.json`, so running it again updates
  the same endpoint instead of creating another.

Secrets survive later CI deployments; `wrangler deploy` only replaces code and
`vars`. Run the script again after rotating the token.

Check deliveries at any time:

```sh
node scripts/configure-polar-webhook.mjs deliveries preview
```

## 4. Paid event-cancellation refund check

Use the demo accounts on `https://elc-preview.ertaev-19102007.workers.dev`.
Pay with Polar's sandbox test card (`4242 4242 4242 4242`, any future expiry,
any CVC). Demo accounts use reserved `.test` addresses, which Polar refuses, so
the checkout does not prefill the email; enter any real-looking address there.
The app matches the payment by account ID and metadata, not by that email.

1. Organizer: create an event and a paid ticket type of at least KZT 300
   (Polar's smallest sandbox checkout), complete the paid-sales activation
   checklist and pay the activation fee. Publish the event.
2. Attendee: buy one paid ticket. After returning from Polar, the order shows
   completed and the ticket is issued.
3. Organizer: Cancel event → "Cancel event and start refunds".
4. Within a few minutes the minute cron prepares a full refund for each paid
   order and sends it to Polar; the `refund.*` and `order.refunded` webhooks
   confirm it. Done when the Polar sandbox order shows **Refunded** and the
   attendee's order and ticket show **Refunded** in the app.

The activation fee is not refunded; that is intended.

## Turning it off

```sh
node scripts/configure-polar-webhook.mjs disable preview
vp exec wrangler secret delete POLAR_ACCESS_TOKEN --env preview --config apps/api/wrangler.jsonc
```

Without `POLAR_ACCESS_TOKEN` the adapter reports `NOT_CONFIGURED` and paid
sales are unavailable again.
