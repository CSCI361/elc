# elc implementation plan

Updated: 2026-09-14

Work resumed at the user's request from checkpoint `3edfe08`. The
[resume checkpoint](./resume-checkpoint.md) records the saved payment/web work,
incomplete activation modules, credentials setup and ordered next steps. The
release remains in progress.

Commit `0456053` adds [offline access and cached mobile attendee details](./evidence/offline-operations-api-mobile.md)
and the [web operations workspace](./evidence/offline-operations-web.md). The 75
API/mobile cases, 19 web cases and both mobile exports pass. Browser acceptance passes owner loss reporting, exact retry after a lost
response, both admission-review outcomes, review-only discovery, platform role
separation, revoked access, pagination and KK/RU/EN layouts at 390 pixels. All
synthetic browser fixtures were removed. Commit `8a2d2c1` extends the [nonempty restore rehearsal](./evidence/backup-recovery.md),
which passes both resume and unresolved-admission cases, including all six notification
jobs and three ticket PDFs. All 34 backup safety cases also pass. Full checks
pass 457 files, and web/Worker/Astro builds pass without a chunk-size warning.
The combined full regression passes 1,408 tests across 84 files in 633.07 seconds.

Commits `dbb6136` and `7b7e94c` close [protected-read authorization races](./evidence/protected-read-authority.md)
and add [scheduled reservation expiry](./evidence/reservation-expiry.md). Final
authorized snapshots cover tickets, orders, account lists, payments and activation.
Cron processes at most 50 reservations per invocation; lazy event cleanup uses
bounded transactions. Migration 0031 adds indexed selection and inventory release.
All 124 focused cases pass, including 42 new cases. Actual disposable Worker Cron
acceptance proves recovery pause, a 50/2/0 progression and preservation of a live
hold. Full checks across 443 files, builds, backup verification and the refunded
ticket browser rerun pass. The combined full regression passes 1,358 tests across
81 files in 590.24 seconds.

Commit `e1ac9b3` adds [saved organizer profiles](./evidence/organizer-profile-web.md)
and an [account-scoped profile API](./evidence/organizer-profile-api.md). A separate
profile table preserves locale and moderation behavior. Atomic revisions and
stable acknowledgements handle stale or uncertain saves. Activation prefill is
explicit, and account edits preserve event checklist/payment snapshots. Migration
0030 is applied locally after a protected export. Browser acceptance passes in
all three languages at phone width, along with 52 focused cases, full checks and
builds. Full regression passes 1,316 tests across 79 files in 548.22 seconds.
The first run exposed an existing auth-email fixture clock race; commit
`e7b287e` aligns JWT and delivery clocks, and the fresh full run passes.

Commit `4da23aa` adds [organizer attendee, order and check-in records](./evidence/organizer-records-web.md)
and a [retained event records API](./evidence/organizer-records-api.md). The
workspace supports localized search, pagination and linked records, preserves
historical ticket and refund snapshots, and separates reported offline admission
from canonical check-ins. Its browser flow passes in all three locales at phone
width, including cancellation, reversal and permission revocation. Full checks
pass across 430 files and all builds pass. Full regression passes 1,264 tests across 77 files in 574.34 seconds.

Commit `a109124` adds [organizer campaign management and QR distribution](./evidence/campaigns-web.md)
and [attendee campaign resolution](./evidence/campaigns-api.md). Campaign creation
preserves disabled defaults and exact event windows; managers review before
explicitly enabling. Downloaded QR images contain only validated event links and
promotional labels. The attendee page displays server-owned terms while checkout
retains final pricing and redemption authority. The local browser flow verifies
10% pricing and a fully discounted completed order, using synthetic activation.

Commit `8360634` adds [event image storage](./evidence/event-images-api.md) and
[the web gallery and organizer preview](./evidence/event-images-web.md). Events
have up to five ordered JPEG/PNG images with required alternative text. Uploads
use validated immutable objects and durable retry intents. Duplication retains
shared assets; reference-aware retention removes them after their last use.
Migrations through 0029 are applied locally; campaigns need no new migration.

The preceding commits add [durable authentication mail](./evidence/durable-authentication-mail.md),
[retention cleanup](./evidence/retention.md) and
[backup recovery](./evidence/backup-recovery.md). Commit `9de6914` saves encrypted
expiring authentication intents, retention and the recovery gate; `cd28130`
saves backup tooling and its disposable restore rehearsal.

Earlier completed units include [platform administration](./evidence/administration.md)
and [operational searches/CSV export](./evidence/operational-records.md).
Account/event suspension, activation inspection, paid-sales controls, exact fee
settings, order/payment/audit search and audited page exports have real local
browser evidence. Suspension preserves signed offline snapshots and records a
separate invalidation timestamp. Operational searches expose retention deadlines
and unresolved-work holds.

The preceding image integration passed 1,137 tests across 73 files. Campaign
checks pass across 421 files, along with 29 resolver cases, 40 web policy/QR
cases and 15 event cases. Web/Worker/Astro builds pass; the web entry is 662.25 kB
minified with the existing size warning. The full campaign regression passes 1,207 tests across 75 files in 505.91 seconds. Backup verification also passes 34 safety
tests and one disposable restore rehearsal. Local Worker authentication and
complete ticketing regressions pass. The new durable-auth browser flow passes
in all three languages, including password reset. Administration and operational-record browser
checks pass in all three languages at 390 pixels, including stale updates,
session removal, revoked access and CSV downloads.

The earlier resumed work includes authorized GA4 caching, localized traffic
reports and consent-based public collection in React and Astro. See
[GA4 reporting](./evidence/ga4-reporting.md) and
[collection evidence](./evidence/ga4-collection.md). Live GA4 configuration and
Google-side receipt remain pending. The saved Polar late-payment test passes
with one confirmed KZT 9,000 refund, zero tickets and no held inventory; see
[compensation evidence](./evidence/polar-compensation.md).

The local image browser flow passes uploads, gallery edits, a lost-response
retry, all three localized phone previews, public covers and access revocation.
Event-scoped organizer registration/order views (SRS 4.4 and 4.16) are integrated
and verified by the full regression. Organizer contact/payout profiles (SRS 4.1) pass the full regression. The
requirements review identified the concrete gaps below. The new workspace keeps purchaser order access separate
from authorized organizer records.

The daily backup workflow is checked in but disabled until its reviewed target,
credentials and environment are configured. External and device acceptance below
remains required before release completion.

## Remaining local work from the requirements review

On 2026-09-14 the checkboxes below were reconciled with the linked evidence.
An item is checked when its local tests or browser evidence pass and it names no
external provider or physical device. Two-device conflicts, conflict review,
paid event-cancellation refunds and payment replay are covered by D1 tests;
their physical-device and Polar acceptance remain listed under M7-M8 and the
external checks. Reported-event review and local seed data were added afterwards on the same day; see [event reports](./evidence/event-reports.md) and [seed data](./evidence/seed-data.md).

Protected reads and scheduled expiry pass the full regression. Offline
operations, cached mobile seat/status labels and nonempty recovery reconciliation
now pass their focused/runtime acceptance and the combined full regression.

The platform campaign catalog and promotional-code activity view (SRS 4.12)
are implemented and saved at the 2026-09-13 checkpoint. The dedicated reader
requires current `platform:moderate` authority and exposes bounded retained
metadata with active-hold and committed-redemption counts. It excludes codes,
hashes and sharing URLs. The localized catalog links to campaign-filtered orders
and lifecycle audit; CSV preserves the displayed filters. No migration was needed.
The API's 12 new cases and 20 existing operations/schema checks pass, as do the
web's 25 policy cases and both scoped checks. On 2026-09-14 disposable browser acceptance passed all 24 checks, the full regression passed 1,445 tests across 86 files, and full checks and builds passed. An independent integration review of the campaign unit found no correctness or security issues; its one open question, whether the campaign audit link returns rows, is answered by the browser run's audit CSV. See
[API evidence](./evidence/platform-campaigns-api.md),
[web evidence](./evidence/platform-campaigns-web.md), and the exact restart steps
in the [resume checkpoint](./resume-checkpoint.md). The previous full-suite baseline was 1,408 tests across 84 files.

Actual [Polar signed delivery and a fulfilled-order refund](./evidence/polar-webhooks-refund.md)
now pass through the local Worker. Five genuine events, exact replay, tampered
body rejection and provider redelivery preserve one event/outbox row per event.
The KZT 9,000 refund invalidated all three tickets; their credentials reject
admission. The earlier compensated order remains intact. The temporary endpoint
is disabled and the tunnel stopped. Paid event-cancellation refund and deployed
runtime acceptance remain pending.

## Scope and evidence rules

Implement the academic release in [architecture decisions](./architecture-decisions.md)
and [SRS v0.3](./elc_SRS_Initial_Draft.pdf). The architecture's explicit overrides
govern. All former stretch features, Google sign-in, and Astro marketing are
required. Payments, verification, and payouts remain sandboxed or simulated.
The documented production, native attendee/organizer, and store-publication
exclusions remain in force. No feature is removed by implementation ordering.

Status uses `pending`, `in progress`, `implemented`, and `verified`. Implemented
means code exists; verified requires the evidence listed below. Local tests do
not prove deployed behavior, provider compatibility, browser usability, or
physical-device acceptance. Missing access stays explicitly pending. Each
milestone requires integration review, relevant checks, and a conventional local
commit. The integration owner maintains this plan after each coherent unit.

## Starting state

This section records the historical baseline, before the integrated work below.

- Baseline commit: `762c289`; clean worktree at implementation start.
- React web starter only; no product services, migrations, or tests.
- `vp install` and `vp run build` pass.
- `vp check` fails on the button's mixed component/utility export.
- `vp test` exits with no test files.
- Branch: `feat/academic-release`.

## Current integration

The workspace now has web accounts, event/campaign authoring and discovery,
atomic GA/assigned-seat checkout, canonical tickets, online scanning and reversal,
paid-sales activation, payment reconciliation/compensation services, protected
multilingual A4 PDFs and calendar exports. Browser evidence covers GA and the
80-seat layout, competing reservations, free issuance, mobile layouts and
activation checklist entry. Real Polar sandbox payments have activated one event
for KZT 5,000 and completed a mixed discounted KZT 9,000 order with three tickets.

Staff and private invitations, support conversations, event cancellation and
voluntary refund/free-cancellation workflows now have API and browser evidence.
PDF and calendar actions are verified in the browser. Current focused suites
cover 29 access tests, 22 support tests, 8 cancellation tests, 21 voluntary refund
tests, 33 offline backend tests and 12 simulated payout tests. Support live tests
run through workerd with real authentication and Durable Objects. The mobile
scanner and payout web view have passed their scoped checks. Refund recovery
adds ten D1 tests; the mobile online unit adds twenty-four tests across native
transport, scanner access and Expo authentication. Support attachments now have
11 passing D1/R2/workerd tests, and all 33 support tests pass together. Content
validation, private downloads, atomic message links and cleanup are implemented.
The attachment composer has passed multilingual browser acceptance, including
upload/message response loss and revoked access. Native offline storage and the
encrypted journal have 46 passing native tests, including 33 offline tests on
actual SQLCipher files, and iOS/Android JavaScript bundles. Physical-device
acceptance remains pending. Event reporting and retained history now have API
and browser evidence, including exact reporting totals and duplication recovery
after a lost response.

Queued notifications now cover ticket PDFs, payment failures, activation,
event updates/cancellation, refunds, payouts, support and free-registration
cancellation. The coordinator freezes each attempted message, preserves provider
receipts, separates PDF and delivery failures, and cleans up abandoned private
payloads. Operator recovery has 14 D1 tests and browser evidence for exact replay
after response loss, stale requests, expired send windows and revoked access.
The delivery adapter, localized templates, coordinator, canonical sources,
fanout, review and workflow suites have passed their focused checks. Real
Resend and deployed queue acceptance remain pending.

This historical integration was partial release coverage. Subsequent units
record actual refunds and signed webhooks above. Remaining web workflows,
external delivery, Expo/offline acceptance, OAuth/email/analytics,
deployment and physical-device checks remain open. The last full integration
baseline passed 424 tests across 32 files. The subsequent 633-test run passed
632 tests; its remaining test expected an older audit-trigger error name. The
updated assertion passed separately. Scoped formatting/lint/type checks and
the complete web/Worker/Astro build also pass. The next complete run will include
the queued delivery implementation. Its first attempt hit the default 10-second
database setup timeout under four workers. An isolated review suite passed;
the test runner now uses two workers and a 30-second setup timeout. That bounded
run passed 926 of 927 tests across 61 files without setup timeouts. Its one
failure found an organizer overview query plan that scanned tickets/offline
operations before restricting event scope. The corrected query and stronger
regression passed all eleven overview API tests and six frontend tests. Account
email localization has 47 passing pure tests and nine real Better Auth/D1
callback tests. Delivery recovery now passes all 15 tests, including cursor
index checks.
The organizer overview also passes browser acceptance for totals across 22
authorized events, date/search changes, refunds, stale responses, permission
revocation and all three locales at 390 px. The GA4 adapter passes 89 injected
transport tests; its server cache, dashboard integration and consent-controlled
collection remain pending.
The saved checkpoint is historical; use the current evidence documents for work
completed since resuming.

## Dependency-ordered milestones

| ID  | Milestone                                                         | Depends on                              | Owner                                      | Status      |
| --- | ----------------------------------------------------------------- | --------------------------------------- | ------------------------------------------ | ----------- |
| M0  | Plan, workspace, checks, and development commands                 | None                                    | Integration                                | In progress |
| M1  | Shared contracts, policies, authentication, schema and migrations | M0                                      | Contracts + integration                    | In progress |
| M2  | Workers ticketing flow, payment adapter and correctness proof     | M1                                      | Integration + provider verification        | In progress |
| M3  | Attendee, organizer and platform administration web workflows     | M1, M2                                  | Web implementation                         | In progress |
| M4  | Tickets, delivery, campaigns and calendar exports                 | M2, M3                                  | API + web implementation                   | In progress |
| M5  | Expo online/offline check-in and reconciliation                   | M1, M2, M4                              | Mobile implementation                      | In progress |
| M6  | Support, attachments, live updates, analytics and history         | M2, M3                                  | API + web implementation                   | In progress |
| M7  | Marketing, localization, accessibility and operational safeguards | M1; integrated workflows for acceptance | Integration                                | In progress |
| M8  | Deployed integration, physical devices and release rehearsal      | M0-M7                                   | Integration + user-provided access/devices | Pending     |

Owners above describe work areas, not an invented assignment to human team
members. Focused agents may implement independent areas after their contracts
are reviewed; the integration owner reviews changes and commits deliberately.

## Acceptance tracking

### M0: workspace and tooling

- [x] Move the existing UI to `apps/web` without losing its design system.
- [x] Establish `apps/api`, `apps/mobile`, `apps/marketing`, and `packages/shared`.
- [x] Configure pnpm workspaces, Vite+ formatting/lint/type checks and tests.
- [x] Fix existing validation failures; configure meaningful application builds.
- [x] Provide documented local setup, migrations, seed data and development commands.
- [ ] Commit CI checks, secret exclusions, and local/preview/demo resource configuration.

Current evidence: the React and Hono Worker build together, local D1/R2/Queue/
Durable Object bindings are configured, and CI checks and secret exclusions are
authored. The Expo online scanner now exports iOS and Android Hermes bundles;
native installation, seed commands and remote API resources remain pending.
Astro builds all four static routes. Root checks include Astro diagnostics and
both application builds; local browser checks cover its three locales and
narrow layout. Deployment and GA4 remain pending.

### M1: contracts, access and data

- [ ] Shared Zod schemas cover ownership, states, endpoint errors, pagination,
      money/time rules, seating, calendar IDs, scan operations, attachment metadata
      and analytics reporting IDs. Public responses exclude database internals.
- [ ] Better Auth email/password, verification, reset and Google sign-in work on
      web and Expo; native API requests attach their authenticated session.
- [ ] Better Auth-generated schema and application Drizzle schema have reviewed
      SQL migrations applied through Wrangler, with reproducible seed fixtures.
- [x] Verified-account transactions and support; matching-email private invitations
      with expiry/revocation; event staff permissions; explicit platform grants.
- [ ] Negative authorization tests cover unrelated events/orders/tickets/cases,
      downloads, exports, analytics, history and unassigned mobile users.

Initial evidence: the foundation suite passed 106 tests across shared rules,
authentication/access, migrations, API boundaries, events, checkout, ticket
credentials/admission and web-account behavior. Reviewed migrations include
cross-event scope guards, active-ticket uniqueness, order revisions and frozen
refund-policy snapshots. Local HTTP checks use real verification and sign-in
sessions; browser checks cover registration, reset, preferences, session
revocation and suspended-account handling. Native authentication, external
Google OAuth and Resend delivery remain unverified. Later workflows still need
additional schema and authorization coverage.
See [foundation validation](./evidence/foundation.md) and
[authentication evidence](./evidence/authentication.md) for the initial unit, and
[web authentication evidence](./evidence/web-authentication.md) for the integrated
account screens.

### M2: first complete ticketing flow and infrastructure proof

- [ ] Publish -> activate -> reserve inventory/promo -> KZT sandbox checkout ->
      verified payment -> canonical ticket/PDF/email -> check in -> reject duplicate.
- [ ] Repeat with general admission, assigned seats, free registration and a
      fully discounted paid ticket (activation still required; no provider checkout).
- [x] Implement KZT 5,000 activation and compensation on failed activation;
      organizer-paid 3% fee, full-refund fee reversal and seven-day payout holds.
- [x] Ten-minute holds, one active checkout/account/event, six-ticket default,
      immutable payment-attempt contents and server-calculated price snapshots.
- [x] Prove atomic last-ticket, same-seat, multi-seat and limited-promo races on
      D1/Workers. Zero-row conditional writes must not allow partial commits.
- [x] Prove duplicate/out-of-order payment events, expired/abandoned holds,
      cancellation during payment, late-payment compensation and refund retries.
- [x] Prove simultaneous check-ins, idempotent retries and authorized reversals.
- [x] Orders, inventory, promo, tickets, audit and outbox commit together; queue
      failure/replay cannot duplicate tickets or lose required side effects.
- [ ] Record actual Polar KZT checkout/refund compatibility. Use the documented
      internal-simulation fallback only with recorded evidence and decision.
- [ ] Run a deployed smoke test and mixed reporting/checkout/scanner workload.
      Target 95% of scan results within two seconds using the specified dataset.

Current evidence: [checkout verification](./evidence/checkout.md) covers real D1
inventory/promo races, replacement rollback and revisions, immutable deadlines,
expiry/abandonment, payment-attempt edit freeze, current eligibility and capacity,
and database-clock checks. Zero-total issuance creates one canonical credential
and commits its audit/outbox records atomically. Admission tests cover concurrent
scans, cancellation/refund blocks, permission revocation and corrections after
event end without permitting new admission.

`vp run verify:local-ticketing` passed through the running Worker: real account
verification/sign-in, event/type creation and publication, free reservation,
zero-total completion, purchaser credential retrieval, explicit scanner grants,
retry/duplicate handling, reversal and rescan. Private fixture grants stand in
for the initial staff-assignment setup; the staff API and UI are now implemented. This proves the local free flow;
external delivery, deployed load and native-device acceptance remain pending.
Activation and mixed discounted payments now pass against Polar; synthetic D1
tests cover compensation and queue replay. An actual late-payment compensation
refund, fulfilled-order voluntary refund and signed provider delivery now pass.
See [provider readiness](./evidence/provider-readiness.md) and
[refund/webhook acceptance](./evidence/polar-webhooks-refund.md). Paid
event-cancellation and deployed acceptance remain pending.

### M3: web workflows and product policy

- [x] Web registration, verification, sign-in, password reset, account language,
      other-session revocation and sign-out with real local browser evidence.
- [x] Attendee discovery, event details, private invitation acceptance, registration,
      checkout, confirmation, account orders, ticket downloads and support entry points.
- [x] Organizer profiles, event creation/edit/preview/publish/unpublish/cancel,
      visibility, capacity, ticket types/windows/hiding, staff and activation checklist.
- [x] Accessible SVG seat map for the specified 80-seat hall, state labels,
      keyboard selection, atomic holds and preserved seat snapshots.
- [x] Platform search, reported-event review, user/event suspension, activation
      inspection, fee/settings configuration, operational exports and audit records.
- [x] Full refunds requested through cases; voluntary cutoff/admission checks,
      automatic event-cancellation refunds, pending-refund admission block,
      conditional restocking and consumed completed promo redemptions.
- [x] Simulated payout records, unresolved-order holds and later adjustments.

Current evidence: the [web account flows](./evidence/web-authentication.md) work
in Kazakh, Russian and English, with saved preferences, safe return paths and
focused accessibility checks. Google availability is shown accurately; external
OAuth remains pending. [Event APIs](./evidence/events.md) provide discovery,
management/preview/publication, ticket types/windows/visibility, capacity,
assigned-seat inventory and campaign creation/enabling. Those APIs are integrated
with checkout and preserve held/sold inventory and historical snapshots. Their attendee/organizer screens now have [browser evidence](./evidence/web-events.md)
for discovery, GA/assigned-seat purchase, protected QR display and the activation
checklist. [Activation evidence](./evidence/activation.md) covers fee snapshots,
current eligibility, administrative fee/moderation APIs and compensation races.
Staff/invitation management, cancellation, refunds and simulated payouts have
subsequent evidence in their dedicated records. Account/event administration,
activation inspection and settings now have [browser evidence](./evidence/administration.md).
Operational searches/exports now have [separate evidence](./evidence/operational-records.md).
The remaining external acceptance is pending.

### M4: tickets, delivery, campaigns and calendars

- [x] Versioned opaque admission credentials distinct from campaign links; digital
      and printed copies share one admission and survive safe PDF regeneration.
- [ ] Protected A4 PDFs include all required fields and Kazakh/Russian fonts;
      grayscale paper scanning succeeds on physical iOS and Android devices.
- [ ] Resend notifications cover all documented account, ticket, payment, event,
      refund, payout and support events. Delivery failures remain separate.
- [x] Campaign creation/defaults/enabling, percentage/fixed discounts, applicability,
      expiry, limits and attributed reporting; scanners reject campaign QR codes.
- [x] Calendar links and `.ics` on event/confirmation views; stable UID, sequence,
      time zones, cancellation metadata and fresh IDs when events are duplicated.
- [x] Initial export from a live-preview ticket confirmation into Google Calendar
      web and Apple Calendar macOS; title, location and Asia/Almaty start/end match.
      See [calendar client acceptance](./evidence/calendar-clients.md).
- [ ] Verify replacement procedures that leave one calendar entry in Google web,
      Outlook web and Apple Calendar iOS/macOS; no automatic-sync claims.

Current evidence: [PDF/calendar verification](./evidence/ticket-exports.md) covers
real Worker downloads, three languages, private R2 access, canonical QR recovery,
grayscale raster decoding, calendar identifiers/time zones and cancellation
metadata. Initial Google web and Apple macOS imports and confirmation-page calendar
controls now have [live-preview evidence](./evidence/calendar-clients.md).
Physical paper scanning, remaining calendar clients, update/cancellation replacement
and external delivery remain pending. Background notification processing
and operator recovery now have [coordinator](./evidence/queued-email.md),
[fanout](./evidence/notification-fanout.md), [source](./evidence/notification-sources.md)
and [web recovery](./evidence/web-delivery.md) evidence. Account email localization
and durable delivery now have [D1/R2 and browser evidence](./evidence/durable-authentication-mail.md).
Actual Resend acceptance remains pending.

### M5: mobile and offline

- [ ] Expo native development builds, Google/email sign-in, assigned-event list,
      camera scans, attendee search, counts and permission-checked reversal.
- [x] SQLCipher cache with SecureStore keys; signed account/device/event snapshots,
      token hashes without raw credentials and four-hour expiry capped by event end.
- [x] Minute refresh while connected; provisional results, snapshot age and separate
      pending counts; unknown/expired data and clock rollback require connectivity.
- [x] Stable scan operation IDs, local atomic duplicate prevention, restart-safe
      journals, batch replay, per-operation results and audited local undo.
- [x] Two disconnected devices produce one canonical admission and a recorded
      conflict after sync; current cancellation/refund/revocation checks apply.
- [x] Same-account journal recovery after sign-out, device revocation/loss incident,
      24-hour acknowledgement cleanup and seven-day unsynchronized expiry.
- [x] Organizer/check-in-lead conflict review with reasons; unauthorized operations
      may be audited but cannot gain admission authority.

### M6: support, analytics and history

- [x] Contextual attendee and organizer-to-platform cases, categories, assignment,
      four statuses, messages, notifications and relationship-scoped access.
- [x] JPEG/PNG/PDF validation, quarantine, 5 MiB/three-file limits, metadata removal,
      safe PDF restrictions, authorized attachment downloads and abandoned cleanup.
- [x] Durable Object WebSockets publish committed updates; permission revocation,
      reconnect/cursor catch-up and duplicate handling preserve D1 history.
- [x] Authoritative capacity, ticket, gross/discount/refund/net/payout, ticket-type,
      campaign and attendance metrics with correct date/time-zone semantics.
- [x] Required charts with matching tables, event/date/type filters and bounded
      queries; provisional offline results excluded from confirmed attendance.
- [ ] GA4 opt-in per origin, sanitized approved public-route events, reporting IDs,
      server credentials, scoped aggregates, one-hour cache and failure fallback.
- [x] Retained past/cancelled events, append-only scoped activity timeline and
      allowlisted duplication into a fresh unactivated draft without transactions.

Evidence: [native offline](./evidence/mobile-offline.md),
[event analytics](./evidence/analytics.md), and
[web history](./evidence/web-history.md). Multi-event reporting, GA4 and native
device acceptance remain separate required checks.

### M7-M8: complete release evidence

- [ ] Astro marketing deployed separately with application links and required locales.
- [ ] Kazakh/Russian/English across web/mobile/marketing/email/PDF; preference and
      fallback behavior; organizer content remains as entered.
- [ ] WCAG 2.1 AA event pages and keyboard/focus/labels/errors/contrast through checkout.
- [ ] Current/previous browser versions recorded; iOS 16.4+/Android 10+ acceptance
      with physical models, OS/build IDs and minimum-version simulator coverage.
- [ ] Isolated local/preview/demo bindings, reviewed deployment configuration,
      server-only secrets, protected assets, HTTPS and redacted operational logs.
- [x] Event images use validated immutable object keys, authorized organizer
      changes, public event delivery and deletion under the event's retention policy.
      Verified locally through D1/R2 tests and the browser evidence above; deployed
      R2 acceptance remains part of the infrastructure gate.
- [ ] Daily retryable retention cleanup, 180-day history, documented expiry/holds,
      30-day logs/outbox payloads/SQL exports and private backup access.
- [ ] D1 recovery window recorded; pre-migration exports/bookmarks; disposable
      restore rehearsal pauses mutations/consumers/sync, reapplies cleanup and
      reconciles payments, delivery, snapshots and admissions before resumption.
- [ ] Full automated checks, deployed mixed workload, browser end-to-end scenarios,
      physical print/offline acceptance and final integrated demonstration recorded.
- [ ] Every acceptance item links to source/tests/run evidence; no required pending
      checks remain before claiming release completion.

Local operational evidence now covers encrypted authentication intents,
daily cleanup declarations, current retention holds, atomic aggregate deletion,
retryable private-file cleanup and a full migrated-schema SQL/R2 restore.
See [retention](./evidence/retention.md), [recovery](./evidence/backup-recovery.md)
and the [runbook](./backup-recovery.md). Deployed pause/drain/resume, real provider
reconciliation, IAM, lifecycle expiry and scheduled exports remain open.

## Evidence log

The offline checkpoint additionally passes 219 tests across 19 files, full
format/lint/type checks, and the web/Worker/marketing build. Its newer event
screens and partial activation code still need the acceptance work recorded in
[resume checkpoint](./resume-checkpoint.md).

| Date       | Evidence                                                                 | Result                                                                                                                      |
| ---------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-13 | Repository inspection at `762c289`, dependency installation              | Clean baseline; install passes; starter validation issues recorded above                                                    |
| 2026-09-13 | [Foundation validation](./evidence/foundation.md)                        | 49 tests pass; local Worker/D1 authentication and browser/API integration pass                                              |
| 2026-09-13 | [Provider readiness](./evidence/provider-readiness.md)                   | Cloudflare access available; actual Polar compatibility proof remains pending                                               |
| 2026-09-13 | [Events and campaigns](./evidence/events.md)                             | Integrated event/campaign routes and D1 mutation/race tests; product screens and delivery pending                           |
| 2026-09-13 | [Checkout and ticketing](./evidence/checkout.md)                         | Atomic local D1 tests and complete free ticketing HTTP flow through workerd pass; paid/provider/deployed acceptance pending |
| 2026-09-13 | [Web authentication](./evidence/web-authentication.md)                   | Real browser account flows, preferences, reset and session revocation pass; external OAuth/email pending                    |
| 2026-09-13 | Integrated automated suite                                               | 106 tests pass; `vp check` and the complete web/Worker/marketing build pass                                                 |
| 2026-09-13 | [Durable authentication mail](./evidence/durable-authentication-mail.md) | Encrypted one-hour intents, eleven D1/R2 cases and real browser flows in three languages pass                               |
| 2026-09-13 | [Retention cleanup](./evidence/retention.md)                             | 21 D1/R2 cases cover holds, atomic deletion, retries, account expiry and restore backlog                                    |
| 2026-09-13 | [Backup recovery](./evidence/backup-recovery.md)                         | 34 safety tests and a disposable full-schema restore with production cleanup pass; remote acceptance pending                |
| 2026-09-13 | Campaign integration                                                     | 1,207 tests in 75 files, full checks/builds and campaign QR browser acceptance pass                                         |
| 2026-09-13 | [Organizer records](./evidence/organizer-records-web.md)                 | Local browser, 57 focused cases, full checks/builds and all 1,264 regression tests pass                                     |

| 2026-09-13 | [Organizer profiles](./evidence/organizer-profile-web.md) | Browser, 52 focused cases and full regression of 1,316 tests pass |
| 2026-09-13 | [Polar refund and signed delivery](./evidence/polar-webhooks-refund.md) | One fulfilled-order refund, three invalidated credentials, five genuine events and provider redelivery pass |
| 2026-09-14 | Fresh-clone validation | Added the missing web `zod` dependency; `vp check`, 1,445 tests across 86 files and all builds pass |
| 2026-09-14 | [Platform campaigns](./evidence/platform-campaigns-web.md) | All 24 disposable browser checks pass in three locales at 390 pixels; fixtures removed |
| 2026-09-14 | [Event reports](./evidence/event-reports.md) | Migration 0032, 12 API, 2 retention and 6 web tests, a fixed resubmission race and 19 browser checks pass |
| 2026-09-14 | [Seed data](./evidence/seed-data.md) | 6 plan tests pass; two local runs create then reuse 4 demo accounts and 2 events |
| 2026-09-14 | Final local integration | `vp check`, all builds, 6 seed tests and 1,465 tests across 88 files pass in 682.70 seconds |

## External checks awaiting access or execution

Polar sandbox access, KZT activation and mixed-ticket checkout, late-payment
compensation, a fulfilled-order voluntary refund, signed webhook delivery and
provider redelivery now have acceptance evidence. The temporary endpoint is
disabled and its HTTP/2 tunnel stopped. Preserve the private sandbox transaction
state; both paid ticket orders have now been refunded through their respective
compensation and voluntary flows.

Remaining external checks include the paid event-cancellation refund, Cloudflare
preview provisioning and deployed workload, R2 enrollment and backup lifecycle,
actual Time Travel recovery, Google OAuth, Resend receipt, GA4 collection/reports,
supported calendar clients and physical iOS/Android devices. No unrelated remote
database was changed. Missing credentials do not establish provider
incompatibility. Continue the concrete local units listed above while those
checks remain pending.

The current integration passes 1,316 tests across 79 files in 548.22 seconds,
full checks across 440 files, and web/Worker/Astro builds. The web entry is
665.07 kB minified and retains its existing size warning. Backup verification
passes 34 safety cases and the disposable full-schema restore. Local browser
checks pass for organizer profiles and the actual refunded ticket in all three
languages at 390 pixels. These checks do not establish deployed or physical-device
acceptance.
