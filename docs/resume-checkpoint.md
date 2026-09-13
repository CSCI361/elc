# Resume checkpoint

Saved on 2026-09-13 at the user's request before going offline. The user has since
explicitly resumed from this checkpoint. This file preserves the saved state;
current progress is tracked in the implementation plan. This is a development
checkpoint, not a completed academic release.

## Current continuation state

Updated on 2026-09-13 after durable authentication mail, retention and backup
recovery integration. The sections below this update preserve the original
offline checkpoint and are historical. The academic release remains in progress.

The branch is `feat/academic-release`. Commit `9de6914` adds durable authentication
mail, retention cleanup and the recovery gate. The commit containing this update
adds backup/restore tooling, CI checks and a disabled daily backup workflow.
Earlier completed units include `8ca0c4f` (operational search/CSV), `186836e`
(administration), `66371ee` (actual Polar compensation), `f4fc144` (analytics
consent), `677e080` (GA4 reporting) and `5d90c8f` (organizer overview).

Validation for this integration:

- `vp test`: 1,111 tests across 72 files pass in 452.65 seconds.
- `vp run verify:backup`: 34 Node safety tests and one complete migrated-schema
  D1/R2 restore rehearsal pass. The rehearsal uses production auth cleanup,
  retention and backlog checks; provider outcomes remain synthetic.
- Full formatting, lint and type checks pass without warnings across 397 files.
  Web/Worker/Astro builds pass. The web entry remains 647.22 kB minified with its
  existing size warning. The build log is `.wrangler/recovery-build.log`.
- `vp run verify:local-auth` and `vp run verify:local-ticketing` pass against the
  local Worker. The latter covers PDFs, calendars, scanning and reversal as well
  as ticket issuance. Both remove their synthetic D1/R2 fixtures.
- `.wrangler/web-auth-durable-results.json` records passing registration,
  verification and sign-in in all three languages at 390 pixels, plus browser
  password reset. There are no page errors. Private fixtures were removed.

Migrations through 0028 are applied to persistent local D1. The next migration is 0029. No deployment or push was performed. No validation process remains running
for these completed units.

Authentication callbacks now commit encrypted one-hour intents and durable email
jobs. Token expiry, consumption, account changes and suspension stop sends.
Accepted provider IDs are reconciled by lookup. Local mail still uses the private
mailbox. A separate account-activity record supports retention without changing
saved-locale behavior. See [authentication evidence](./evidence/durable-authentication-mail.md).

Daily retention is declared at 00:00 UTC. Atomic D1 retirement preserves current
payment/refund/admission holds and captures R2 deletion jobs before deleting
records. Jobs retry and repeat sweeps for late writes. The recovery API exposes
deadlines and holds. See [retention evidence](./evidence/retention.md).

`RECOVERY_MODE=paused` is a deployment setting outside D1. It blocks all API reads
and writes, skips scheduled work, retries queue batches and restricts support
Durable Objects. Deployment draining and provider reconciliation remain required.
The SQL importer restores tables/data before transition triggers and verifies
foreign keys. The daily GitHub backup workflow remains disabled until its target,
credentials and environment are configured. See the [runbook](./backup-recovery.md)
and [local recovery evidence](./evidence/backup-recovery.md).

Next local implementation: event images. SRS section 4.2 requires them, but the
current event schema has no image records. The SRS gives no image type/count/size
limits. A read-only design review recommends validated JPEG/PNG uploads, an ordered
gallery with alt text, immutable shared assets for event duplication, access checks
through the event API, and reference-aware retention. Reuse the complete image
validator in `support/attachments/images.ts`; support-specific limits are not SRS
requirements for event images. Coordinate shared contracts/schema before API/web
work. Both focused agents have finished and hold no writable files.

The completed Polar compensation fixture must be preserved: payment
`49249daf-eefa-4817-8061-4cc493d898d5` succeeded; order
`99fc69b5-1a2f-4a25-925c-84aef1b9d522` remains abandoned. Exactly one confirmed
KZT 9,000 refund exists, with zero tickets or held inventory. Do not submit that
checkout again. Repeat assertions with
`node scripts/verify-polar-sandbox.mjs verify-compensated`.

Preserve `.wrangler/polar-acceptance.json`, local D1/R2 state and ignored
`apps/api/.dev.vars` with mode 0600. The web/Worker server is available on port
5173; Astro's development daemon is on `127.0.0.1:4321`. Local builds copy
`.dev.vars` into Worker output, so never deploy that local build directory.

Remaining acceptance includes Cloudflare R2 enrollment and preview provisioning,
signed Polar webhooks and other actual refund scenarios, Google OAuth, Resend,
live GA4, remote retention/recovery and workload testing, supported calendar
clients and physical iOS/Android devices. None is established by local tests.

## Historical offline checkpoint

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
