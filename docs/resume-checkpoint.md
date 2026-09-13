# Resume checkpoint

Saved on 2026-09-13 at the user's request to pause and resume later. This
checkpoint supersedes the historical continuation notes below. The academic
release is incomplete.

## Resume here

Repository: `/Users/yerassyl/dev/elc`. Branch: `feat/academic-release`.
The local `chore: checkpoint platform campaign review` commit saves the current
API, shared contract, web implementation, tests and evidence. Find its hash with
`git log -1 --oneline`; do not reset to the preceding baseline. The last complete
integration baseline is `c6e4271`, with 1,408 tests across 84 files passing.

Platform campaign review is implemented but awaiting integration acceptance.
Both agents finished, returned ownership and have no remaining processes or
edits. No full regression or browser fixture is running. The owned web/Worker
and Astro development servers were stopped for this checkpoint. The existing
browser session and local database are preserved.

Focused results for the pending unit:

- API: 12 new campaign cases passed; 20 existing operations/schema checks also
  passed. Scoped checks passed seven code files. The executed query plan uses a
  bounded materialized page and `promo_usage` for both counters. No migration.
- Web: 25 policy tests passed. Scoped formatting, lint and type checks passed.
  The localized catalog, validated order/audit links and exact CSV filters are
  implemented. Browser acceptance has not run.
- Evidence: [API](./evidence/platform-campaigns-api.md) and
  [web](./evidence/platform-campaigns-web.md). These documents distinguish the
  focused results from pending integration checks.

Resume in this order:

1. Read this checkpoint, the [implementation plan](./implementation-plan.md),
   and [architecture decisions](./architecture-decisions.md). Architecture
   overrides the [SRS](./elc_SRS_Initial_Draft.pdf). Inspect `git status` and run
   `vp install` before development. Keep the full academic-release scope.
2. Review the campaign reader, shared contract and operations filters, then the
   web catalog and URL initialization. The API is `GET /api/admin/campaigns`;
   the browser route is `/admin/campaigns`. No organizer codes, token hashes or
   redeemable URLs belong in the platform response.
3. Start `vp run dev` for port 5173. Start `vp run dev:marketing` only when
   marketing verification is needed. Rediscover the `elc-web-admin` browser
   session; do not rely on an old CDP port or tool session ID.
4. Inspect and run the prepared private helper
   `.wrangler/web-platform-campaigns-acceptance.mjs`. Its syntax check passed,
   but it has never run and has created no fixtures. The CSV button's actual
   English label is `Export this page as CSV`. The helper uses disposable
   synthetic accounts and explicitly synthetic local paid activation, with no
   Polar call. Verify its exact selectors before running. It covers usage,
   pagination, KK/RU/EN mobile layout, order/audit drilldowns, CSV, authority
   loss and failed-read clearing. Check cleanup and visually inspect screenshots.
5. Resolve integration findings, update evidence, then run `vp check --fix`.
   Freeze application/test edits before `vp test`; also run `vp run build`.
   A full regression commonly takes about ten minutes with quiet logs. Poll the
   same process rather than restarting it. Do not edit during commit hooks.
6. Record the actual integration result and commit any fixes. Continue the
   remaining provider, deployment and physical-device acceptance gates in the
   plan. Do not treat local tests as proof of those gates.

Preserve ignored `apps/api/.dev.vars` (mode 0600), `.wrangler/state`, private
Polar acceptance files, and the protected pre-migration 0030/0031 exports until
their manifest deadlines. No secrets are part of the checkpoint commit. Local
builds copy `.dev.vars` into `apps/web/dist/elc_local/.dev.vars`; never deploy
that local build output. Do not repeat the preserved Polar checkouts or mutate
the compensated event to test cancellation. The original fulfilled order is
already refunded, and the abandoned order already has one compensation refund.
The temporary Polar webhook endpoint remains disabled. No provider action,
push or deployment was performed while making this checkpoint.

## Previously validated work

Commits `dbb6136` and `7b7e94c` save protected reads and reservation expiry.
Commits `0456053` and `8a2d2c1` save offline operations web/API/mobile and the
nonempty recovery rehearsal. Root API/mobile tests pass 75 cases across three files in
94.37 seconds; 19 web cases and both Metro exports pass. Browser acceptance
passes all 12 workflows in `.wrangler/web-offline-operations-results.json`, with
no page errors and all synthetic fixtures removed. The main local application
and Polar records remain preserved. Both agents returned ownership. Independent
API/mobile review found no actionable issue. The two nonempty restore cases,
34 safety cases and separate Node smoke pass; notification reconciliation now
covers all six local jobs, including three ticket PDFs.

Full checks pass 457 files. Web/Worker/Astro builds pass; the web entry is now
388.10 kB and its shared UI chunk is 291.64 kB, without a chunk-size warning.
This is a bundler split, not evidence of reduced total initial download. Build
session 78303 completed. The full regression passes 1,408 tests across 84 files
in 633.07 seconds. Session 55885 exited 0; its log is
`.wrangler/offline-recovery-tests.log`. Check/build logs use
`.wrangler/offline-recovery-{check,build}.log`. This result applies to the committed offline/recovery baseline. The pending
platform campaign integration is described in the current checkpoint above.

The latest validated integration closes protected-read authorization races and
adds scheduled reservation expiry. See the two evidence documents linked from
the implementation plan. All 124 focused cases pass, including 42 new tests.
Migration 0031 adds reservation/event and inventory lookup indexes and is applied
locally after a protected export in `.wrangler/pre-migration-0031.{sql,json}`.
Preserve that export until its manifest's 30-day deadline.

Actual Cron acceptance used an isolated disposable Worker on 127.0.0.1:8798,
without provider credentials. Paused mode left 53 holds untouched; running ticks
expired 50, then two, then zero, while preserving one live hold. Audit, receipt,
inventory and promo counts matched. That Worker/browser are stopped and the
disposable database state removed. Results remain in
`.wrangler/expiry-runtime/results.json`. The preserved application still runs on
localhost:5173; its database and sandbox transactions were not used for the Cron
fixture.

Full checks pass 443 files, builds pass (665.07 kB entry, existing warning), and
backup verification passes 34 safety cases plus the full-schema restore. The
refunded-ticket browser rerun passes in KK/RU/EN, with all three credentials
rejected as refunded and its temporary scan grant restored. The combined full
suite passes 1,358 tests across 81 files in 590.24 seconds; session 2652 exited 0.
Its log is `.wrangler/authority-expiry-tests.log`. Build session 2973 and backup
session 45060 completed successfully. Both agents returned ownership, and the
independent expiry review found no actionable issue. The source freeze is lifted.
Next: offline operator/admin screens, cached mobile seat/status labels and the
nonempty recovery rehearsal. Preparation for those units was read-only; implementation has since begun as
recorded above.

Updated on 2026-09-13 after organizer profiles and actual Polar refund/webhook
acceptance. The historical sections below preserve the original offline
checkpoint. The academic release remains in progress.

The branch is `feat/academic-release`. Committed baselines include `9de6914`
(durable authentication mail and retention), `cd28130` (backup recovery) and
`8360634` (event image galleries and organizer previews). Campaign commit `a109124`
adds an organizer workspace, local Campaign QR generation/downloads and a
server endpoint for attendee offer resolution. That campaign unit needed no
migration. The profile unit below applies migration 0030 to persistent local D1.

Campaigns start disabled with 10%, 100 redemptions and the exact event window.
Managers can create percentage or fixed-KZT offers, review and enable/disable
them, and distribute separately labelled QR images. Sharing rereads manager
access and permits only exact same-origin event links. Production requires HTTPS;
local development HTTP is explicitly labelled. The attendee resolver uses token
hash lookup and rechecks current event/access/window state. Checkout remains the
authority for prices, inventory and redemption limits. Revoked managers cannot
receive codes from an in-flight read.

Validation completed so far:

- Full checks pass across 421 files without warnings. Web/Worker/Astro builds
  pass; the web entry is 662.25 kB minified, with its existing size warning.
- All 29 resolver integration cases, 40 web campaign policy/QR cases and 15
  event cases pass. Full regression passes 1,207 tests across 75 files in
  505.91 seconds.
- `.wrangler/web-campaigns-results.json` records passing browser creation,
  uncertain-request retry, enabling, KK/RU/EN QR downloads and native QR decoding
  at 390 pixels, a discounted reservation, a fully discounted completed order,
  admission rejection and access revocation. The local activation fixture is
  synthetic and no payment provider was called. All synthetic fixtures were removed.
- Build/check/test logs use `.wrangler/campaigns-{build,check,tests}.log`.

See [campaign UI evidence](./evidence/campaigns-web.md) and
[resolver evidence](./evidence/campaigns-api.md). The preceding image integration
passed 1,137 tests, the local Worker ticketing regression and the backup restore
rehearsal. The backup workflow remains disabled until reviewed configuration is
available. Preserve the recovery gate and durable authentication/retention design.

Commit `4da23aa` saves organizer attendee/order/check-in records and passed 1,264
tests across 77 files. Commit `e1ac9b3` adds saved organizer profiles through
private GET/PATCH `/me/organizer-profile`. Its independent `organizer_profiles`
table avoids implicitly saving a locale or altering moderation. Profile saves
atomically guard revisions and commit stable retry acknowledgements and audit
entries. Explicit activation prefill preserves checks and terms; later account
edits leave event snapshots and eligibility unchanged.

Migration 0030 is applied locally. Before migration, a protected local SQL export
was saved at `.wrangler/pre-migration-0030.sql` with its SHA-256 and 30-day expiry
in `.wrangler/pre-migration-0030.json` (both mode 0600). Preserve it until its
recorded deadline, then remove this local export. This is not provider Time
Travel or remote lifecycle evidence. The first export probe used an unsupported
Miniflare persistence option and found an empty ephemeral database; the corrected
resourcePersistencePath read the known local acceptance fixture before export.

The API's 30 cases, 22 web policy cases and extended real retention-cascade case
pass. `.wrangler/web-organizer-profile-results.json` records a complete passing
browser run with missing/read-only profile, lost acknowledgement recovery,
locale preservation, stale edits, explicit activation prefill, unchanged event
snapshots and automatic access/error refresh. It records no page errors and all
fixtures cleaned. Russian mobile overflow was corrected and visually verified.
Full checks pass 440 files; all builds pass (665.07 kB entry, existing warning).
All 34 backup safety cases and the full-schema disposable restore pass.

The first profile regression passed 1,315 of 1,316 tests in 572.60 seconds.
Its one existing authentication-email failure came from different JWT and
delivery clocks crossing a wall-clock second. Commit `e7b287e` makes the fixture sign with the same clock as delivery; all 11
authentication-email cases pass. The fresh full regression passes 1,316 tests
across 79 files in 548.22 seconds. Session 77043 completed with exit 0; its output
is `.wrangler/profile-tests-final.log`. Full checks pass 440 files and builds pass.
Commit `e1ac9b3` saves the profile integration.

Real Polar signed delivery and the existing fulfilled-order voluntary refund now
pass. See [evidence](./evidence/polar-webhooks-refund.md). The completed order
`afe29372-a6b2-41e2-9519-5a7de409abac` is now refunded through its support case and
organizer approval. One confirmed KZT 9,000 refund exists and all three original
credentials reject admission as refunded. Do not submit that checkout again.
The private `.wrangler/polar-voluntary.json` holds stable operation identities.

The temporary HTTP/2 tunnel carried five genuine Polar events, all 202. Exact
concurrent replays and actual provider redelivery kept one canonical event and
outbox item per event; tampered bodies returned 400. Sanitized evidence is in
`.wrangler/polar-webhook-results.json`; all 21 raw capture files were removed.
The temporary endpoint was disabled and verified disabled. Proxy/tunnel sessions
10729 and 39020 were stopped. The ignored `.dev.vars` now includes its signing
secret, mode 0600; preserve it. The Worker was restarted in session 75107 and
remains on localhost:5173. The temporary scan grant was restored through the API.

The read-only requirements audits identified remaining local units in the plan:
offline device/conflict screens and cached seat labels, platform campaign review
and a nonempty restored-state reconciliation rehearsal. Protected reads and
bounded reservation expiry have since passed the full regression above.
Keep the external/device acceptance gates explicit; the release is incomplete.

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
paid event-cancellation refunds, Google OAuth, Resend,
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
