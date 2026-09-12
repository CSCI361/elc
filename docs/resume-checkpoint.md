# Resume checkpoint

Saved on 2026-09-13 at the user's request before going offline. Work is paused
at this checkpoint; do not start further implementation until the user resumes.
This is a development checkpoint, not a completed academic release.

## Start here

Repository: `/Users/yerassyl/dev/elc`, branch `feat/academic-release`.
Read this file, [implementation plan](./implementation-plan.md), and
[architecture decisions](./architecture-decisions.md). Architecture overrides
the [SRS](./elc_SRS_Initial_Draft.pdf). Every committed feature, including former
stretch features, Google sign-in, Astro marketing and native offline scanning,
remains required. Preserve the documented exclusions and demonstration policies.

Earlier commits:

- `38fd522`: implementation plan.
- `e24bb56`: Worker monorepo, schema and authentication foundation.
- `e48eae9`: event/checkout APIs, web accounts, zero-total ticket issuance and
  online admission. That integration passed 106 tests, full checks/build, real
  Worker HTTP free-ticket acceptance and browser authentication.
- The commit containing this file saves the next payment/web/activation work
  described below. Inspect `git log -4 --oneline` for its hash.

All agents stopped and returned file ownership. The local web/Worker and Astro
development servers were stopped for the checkpoint. Preserve local D1 data and
ignored credentials. No deployment, push or real financial operation occurred.

## Saved work

The Polar adapter uses `@polar-sh/sdk@1.0.0-alpha.21`, versioned API `2026-04`,
and sandbox endpoints only. It validates frozen metadata, customer/order links,
KZT amounts and net/tax full refunds. Webhook verification checks signatures and
normalizes locally before durable acknowledgement; it makes no provider calls.
See [adapter evidence](./evidence/polar-adapter.md).

Payment services prepare immutable attempts, claim one financial dispatch,
recover uncertain responses through reads, and reconcile authoritative provider
facts. Paid and zero-total orders share atomic ticket issuance. Late/ineligible
success schedules full compensation without reclaiming released inventory.
Refunds block admission before dispatch, retain failures, and preserve original
order/fee snapshots. Completed orders cannot lose a race to technical
compensation. Never repeat an uncertain financial POST automatically.

`payments/webhooks.ts`, `outbox.ts`, and Worker queue/Cron handlers persist and
replay payment work. Their real queue/runtime and provider delivery acceptance
is still pending. A final checkpoint fix strips the refund webhook envelope
before passing its strict normalized status to `applyRefundStatus`.
See [reconciliation evidence](./evidence/payment-reconciliation.md).

Web event modules cover discovery/details, organizer configuration, assigned-seat
SVG selection, checkout, orders, ticket QR rendering and payment-return polling.
Source checks and seven policy tests passed before checkpoint. Browser checks
only reached discovery, authentication and the organizer form; no event was
submitted in that run. Complete flows, mobile layout and accessibility review
remain pending. See [web event evidence](./evidence/web-events.md).

Activation is an **unfinished savepoint**. Shared contracts and three modules
(`activation/guards.ts`, `store.ts`, `complete.ts`) compile. Schema/migration
`0007` adds `activation_settings`, `event_activations`, and `activation_attempts`.
There are no activation routes, checklist mutations, payment preparation,
settings seed, immutable success/refund race guards or activation tests yet.
Do not mount these modules or claim activation works until those parts are done.

## Local configuration and external evidence

The user approved creating and saving a 30-day `elc-academic-sandbox` token.
It is in ignored `apps/api/.dev.vars`, mode 0600, alongside the preserved auth
and ticket encryption keys. Keys present: `AUTH_SECRET`,
`TICKET_ENCRYPTION_KEY`, `POLAR_ACCESS_TOKEN`, `POLAR_PRODUCT_ID`,
`POLAR_ORGANIZATION_ID`. Never print or commit values. The webhook secret is
still missing. Do not request token creation approval again for this token.

Authenticated sandbox product list/detail requests returned HTTP 200 and
`Polar-Version: 2026-04`. Product: `elc sandbox ticket order`, ID
`66720b47-54e1-453f-91a1-58f6a35cbd30`, KZT 9,000. A default Python user-agent
received 403; the named acceptance user-agent succeeded and is used by the SDK
wrapper. No checkout, payment, refund or genuine webhook has been executed yet.

The existing Helium session is signed in to the sandbox. Its User Settings
confirmed the member email; use a member sub-address alias for test checkout,
as required by Polar sandbox. Do not use unrelated synthetic domains for Polar
customers. Reinspect that account if needed without exposing credentials.

`scripts/verify-polar-sandbox.mjs` is prepared but **unrun**. It uses an explicit
`POLAR_TEST_CUSTOMER_EMAIL`, stores private resume data in `.wrangler`, and
provides `create`/`status` commands. Review it before running. Its event's paid
eligibility is set by a private fixture, so it cannot prove activation. Prefer
replacing that fixture step with the completed activation API. Its HTML checkout
launcher keeps the checkout URL out of console output. No manual probe state or
checkout launcher has been generated yet.

Local migrations through `0006` were applied. `0007` is generated and pending
application to the persistent local database. Test databases read all migrations.
Dependencies are installed. `vp env doctor` passed. An optional temporary `tsx`
runner hit an ignored esbuild installation-script check; the prepared probe is
plain JavaScript and does not need that runner or an approval workaround.

## Resume order

1. Inspect Git status and this checkpoint's validation results below. Use
   `vp install`, `vp run setup:local`, `vp run db:migrate`, then `vp run dev`.
   The web/Worker share `http://localhost:5173`; marketing uses
   `vp run dev:marketing` at `http://127.0.0.1:4321`.
2. Complete activation's owner checklist/payment preparation and platform
   settings/suspension. Add the database guards and D1 tests. Wire
   `activationEligibilitySql` into `claimPaymentDispatch`, and
   `completeActivation` into `processPayment`. Currently activation dispatch
   eligibility is deliberately false and completion returns pending.
3. Add the successful activation guard to `ensureCompensation`, preserving a
   previously successful, non-refundable fee through later cancellation or
   suspension. Test activation/refund concurrency and configured-fee snapshots.
4. Exercise complete event, seat, checkout, ticket and payment UI flows. Preserve
   working account flows. The QR uses local `qrcode`, never a remote service.
5. Run real Polar KZT checkout/full refund and genuine signed webhook acceptance
   through Workers. Keep the provider fallback contingent on demonstrated
   incompatibility and a recorded architecture revision.
6. Continue the remaining implementation-plan milestones. Support/refund approval,
   PDFs/email delivery, cancellations/payouts, offline Expo, analytics/history,
   Google OAuth, deployment, retention/recovery and physical devices remain open.

Use focused agents with disjoint ownership and frequent local commits. Only the
integration owner starts/stops the shared development server. If Vite dependency
optimization becomes stale, stop it and move the cache aside reversibly before
restarting; preserve local D1 and `.dev.vars`.

## Checkpoint validation

- `vp check --fix`: formatting completed; no lint warnings/errors or type errors
  across 123 checked files.
- `vp test`: **219 tests passed across 19 files**, including all ten webhook/
  outbox cases and the refund-envelope regression. Runtime: 88.73 seconds.
- `vp run build`: TypeScript, Astro diagnostics and web/Worker/marketing builds
  passed. The web bundle has a non-failing size warning (about 600 kB minified);
  review route splitting when resuming the web work.
- Full product browser acceptance, live paid/refund/webhook proof, activation
  acceptance, deployment and physical-device checks remain pending.
