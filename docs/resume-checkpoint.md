# Resume checkpoint

Saved on 2026-09-13 at the user's request before going offline. The user has since
explicitly resumed from this checkpoint. This file preserves the saved state;
current progress is tracked in the implementation plan. This is a development
checkpoint, not a completed academic release.

## Current continuation state

Updated on 2026-09-13 after event image integration. The historical sections
below preserve the original offline checkpoint. The academic release remains
in progress.

The branch is `feat/academic-release`. Its committed baseline includes
`9de6914` (durable authentication mail and retention) and `cd28130` (private SQL
backups and recovery rehearsal). The commit containing this checkpoint adds migration 0029,
shared gallery contracts, immutable validated R2 uploads, authorized downloads,
revision-guarded gallery edits, shared-asset duplication and reference-aware
retention. The web editor has localized uploads, alternative text, ordering,
removal and reliable retries. Draft/published organizer previews show galleries
and read-only ticket/seat details with event analytics disabled.

Migrations through 0029 are applied to persistent local D1. Full integration
validation is complete; no test or build process remains running. No deployment
or push was performed.

Validation completed for the image unit:

- `vp test`: 1,137 tests across 73 files pass in 473.37 seconds.
  Log: `.wrangler/event-images-tests.log`.
- Full formatting, lint and type checks pass without warnings across 408 files.
- The image suite verifies 25 cases. All 21 retention cases pass; the combined
  first 44 cases took 121.60 seconds and two additional cases took 7.11 seconds.
- Event/history integration passed 27 cases, including ordered image DTOs and
  duplication that shares assets but creates fresh image associations.
- Web/Worker/Astro builds pass. The web entry is 658.10 kB minified, with its
  existing size warning. Build log: `.wrangler/event-images-build.log`.
- `vp run verify:backup` passes 34 Node safety tests and one complete migrated
  D1/R2 restore rehearsal with the new image tables.
- `vp run verify:local-ticketing` passes against the real local Worker, including
  issuance, protected PDFs, calendars, scanning, reversal and fixture cleanup.
- `.wrangler/web-event-images-results.json` records a passing browser run with
  no page errors. It covers PNG/JPEG uploads, lost-acknowledgement retry without
  duplicates, gallery edits, KK/RU/EN phone previews, public covers and image
  access revocation. All synthetic D1/R2/mail fixtures were removed.

See [API evidence](./evidence/event-images-api.md) and
[web evidence](./evidence/event-images-web.md). The API cleanup accounts for a
first successful object sweep after more than 30 days by recording the asset's
deleted state in the same guarded batch that removes its object job.

The preceding integration passed 1,111 tests across 72 files, full checks/build,
local Worker auth/ticketing regressions, and localized durable-auth browser
registration/reset. Authentication uses encrypted expiring D1 intents. Daily
retention preserves financial and admission holds. `RECOVERY_MODE=paused` is
outside D1 and gates APIs, background work and support connections. Backup CI
is checked in but remains disabled until its target and credentials are set.
See the [runbook](./backup-recovery.md) and [implementation plan](./implementation-plan.md).

Next: implement organizer campaign management and Campaign QR generation.
The APIs already exist; the organizer screen and QR renderer are missing. The
acceptance flow is campaign QR -> event -> discount -> attributed order, with
campaign QR rejection at admission. Further local gaps include event-scoped
organizer registration/order views and editable organizer contact/payout
profiles. Both agents have returned ownership and have no running processes.

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
