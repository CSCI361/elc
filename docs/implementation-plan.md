# elc implementation plan

Updated: 2026-09-13

Work resumed at the user's request from checkpoint `3edfe08`. The
[resume checkpoint](./resume-checkpoint.md) records the saved payment/web work,
incomplete activation modules, credentials setup and ordered next steps. The
release remains in progress.

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
transport, scanner access and Expo authentication. Native offline storage and
support attachments are in progress.

This is partial release coverage. Actual refunds and signed webhooks, remaining
web workflows, delivery, reporting, Expo/offline, external OAuth/email/analytics,
deployment and physical-device checks remain open. The last full integration
baseline passed 424 tests across 32 files. Scoped formatting/lint/type checks
and the complete web/Worker/Astro build also pass. Native bundling and the next
web/attachment units are being validated separately.
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
| M7  | Marketing, localization, accessibility and operational safeguards | M1; integrated workflows for acceptance | Integration                                | Pending     |
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
- [ ] Provide documented local setup, migrations, seed data and development commands.
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
- [ ] Verified-account transactions and support; matching-email private invitations
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
- [ ] Implement KZT 5,000 activation and compensation on failed activation;
      organizer-paid 3% fee, full-refund fee reversal and seven-day payout holds.
- [x] Ten-minute holds, one active checkout/account/event, six-ticket default,
      immutable payment-attempt contents and server-calculated price snapshots.
- [x] Prove atomic last-ticket, same-seat, multi-seat and limited-promo races on
      D1/Workers. Zero-row conditional writes must not allow partial commits.
- [ ] Prove duplicate/out-of-order payment events, expired/abandoned holds,
      cancellation during payment, late-payment compensation and refund retries.
- [x] Prove simultaneous check-ins, idempotent retries and authorized reversals.
- [ ] Orders, inventory, promo, tickets, audit and outbox commit together; queue
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
for the unfinished staff-assignment endpoint. This proves the local free flow;
external delivery, deployed load and native-device acceptance remain pending.
Activation and mixed discounted payments now pass against Polar; synthetic D1
tests cover compensation and queue replay. Actual refunds and signed webhook
delivery still need acceptance. Polar sandbox access
and KZT product creation are recorded in
[provider readiness](./evidence/provider-readiness.md); transaction and webhook
compatibility are not yet proven.

### M3: web workflows and product policy

- [x] Web registration, verification, sign-in, password reset, account language,
      other-session revocation and sign-out with real local browser evidence.
- [ ] Attendee discovery, event details, private invitation acceptance, registration,
      checkout, confirmation, account orders, ticket downloads and support entry points.
- [ ] Organizer profiles, event creation/edit/preview/publish/unpublish/cancel,
      visibility, capacity, ticket types/windows/hiding, staff and activation checklist.
- [x] Accessible SVG seat map for the specified 80-seat hall, state labels,
      keyboard selection, atomic holds and preserved seat snapshots.
- [ ] Platform search, reported-event review, user/event suspension, activation
      inspection, fee/settings configuration, operational exports and audit records.
- [ ] Full refunds requested through cases; voluntary cutoff/admission checks,
      automatic event-cancellation refunds, pending-refund admission block,
      conditional restocking and consumed completed promo redemptions.
- [ ] Simulated payout records, unresolved-order holds and later adjustments.

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
Staff/invitation management, cancellation, platform administration screens and
refund/payout workflows remain in progress or pending.

### M4: tickets, delivery, campaigns and calendars

- [x] Versioned opaque admission credentials distinct from campaign links; digital
      and printed copies share one admission and survive safe PDF regeneration.
- [ ] Protected A4 PDFs include all required fields and Kazakh/Russian fonts;
      grayscale paper scanning succeeds on physical iOS and Android devices.
- [ ] Resend notifications cover all documented account, ticket, payment, event,
      refund, payout and support events. Delivery failures remain separate.
- [ ] Campaign creation/defaults/enabling, percentage/fixed discounts, applicability,
      expiry, limits and attributed reporting; scanners reject campaign QR codes.
- [ ] Calendar links and `.ics` on event/confirmation views; stable UID, sequence,
      time zones, cancellation metadata and fresh IDs when events are duplicated.
- [ ] Verify replacement procedures that leave one calendar entry in Google web,
      Outlook web and Apple Calendar iOS/macOS; no automatic-sync claims.

Current evidence: [PDF/calendar verification](./evidence/ticket-exports.md) covers
real Worker downloads, three languages, private R2 access, canonical QR recovery,
grayscale raster decoding, calendar identifiers/time zones and cancellation
metadata. Physical paper scanning, supported calendar clients, frontend export
controls and external/background delivery remain pending.

### M5: mobile and offline

- [ ] Expo native development builds, Google/email sign-in, assigned-event list,
      camera scans, attendee search, counts and permission-checked reversal.
- [ ] SQLCipher cache with SecureStore keys; signed account/device/event snapshots,
      token hashes without raw credentials and four-hour expiry capped by event end.
- [ ] Minute refresh while connected; provisional results, snapshot age and separate
      pending counts; unknown/expired data and clock rollback require connectivity.
- [ ] Stable scan operation IDs, local atomic duplicate prevention, restart-safe
      journals, batch replay, per-operation results and audited local undo.
- [ ] Two disconnected devices produce one canonical admission and a recorded
      conflict after sync; current cancellation/refund/revocation checks apply.
- [ ] Same-account journal recovery after sign-out, device revocation/loss incident,
      24-hour acknowledgement cleanup and seven-day unsynchronized expiry.
- [ ] Organizer/check-in-lead conflict review with reasons; unauthorized operations
      may be audited but cannot gain admission authority.

### M6: support, analytics and history

- [ ] Contextual attendee and organizer-to-platform cases, categories, assignment,
      four statuses, messages, notifications and relationship-scoped access.
- [ ] JPEG/PNG/PDF validation, quarantine, 5 MiB/three-file limits, metadata removal,
      safe PDF restrictions, authorized attachment downloads and abandoned cleanup.
- [ ] Durable Object WebSockets publish committed updates; permission revocation,
      reconnect/cursor catch-up and duplicate handling preserve D1 history.
- [ ] Authoritative capacity, ticket, gross/discount/refund/net/payout, ticket-type,
      campaign and attendance metrics with correct date/time-zone semantics.
- [ ] Required charts with matching tables, event/date/type filters and bounded
      queries; provisional offline results excluded from confirmed attendance.
- [ ] GA4 opt-in per origin, sanitized approved public-route events, reporting IDs,
      server credentials, scoped aggregates, one-hour cache and failure fallback.
- [ ] Retained past/cancelled events, append-only scoped activity timeline and
      allowlisted duplication into a fresh unactivated draft without transactions.

### M7-M8: complete release evidence

- [ ] Astro marketing deployed separately with application links and required locales.
- [ ] Kazakh/Russian/English across web/mobile/marketing/email/PDF; preference and
      fallback behavior; organizer content remains as entered.
- [ ] WCAG 2.1 AA event pages and keyboard/focus/labels/errors/contrast through checkout.
- [ ] Current/previous browser versions recorded; iOS 16.4+/Android 10+ acceptance
      with physical models, OS/build IDs and minimum-version simulator coverage.
- [ ] Isolated local/preview/demo bindings, reviewed deployment configuration,
      server-only secrets, protected assets, HTTPS and redacted operational logs.
- [ ] Daily retryable retention cleanup, 180-day history, documented expiry/holds,
      30-day logs/outbox payloads/SQL exports and private backup access.
- [ ] D1 recovery window recorded; pre-migration exports/bookmarks; disposable
      restore rehearsal pauses mutations/consumers/sync, reapplies cleanup and
      reconciles payments, delivery, snapshots and admissions before resumption.
- [ ] Full automated checks, deployed mixed workload, browser end-to-end scenarios,
      physical print/offline acceptance and final integrated demonstration recorded.
- [ ] Every acceptance item links to source/tests/run evidence; no required pending
      checks remain before claiming release completion.

## Evidence log

The offline checkpoint additionally passes 219 tests across 19 files, full
format/lint/type checks, and the web/Worker/marketing build. Its newer event
screens and partial activation code still need the acceptance work recorded in
[resume checkpoint](./resume-checkpoint.md).

| Date       | Evidence                                                    | Result                                                                                                                      |
| ---------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-13 | Repository inspection at `762c289`, dependency installation | Clean baseline; install passes; starter validation issues recorded above                                                    |
| 2026-09-13 | [Foundation validation](./evidence/foundation.md)           | 49 tests pass; local Worker/D1 authentication and browser/API integration pass                                              |
| 2026-09-13 | [Provider readiness](./evidence/provider-readiness.md)      | Cloudflare access available; actual Polar compatibility proof remains pending                                               |
| 2026-09-13 | [Events and campaigns](./evidence/events.md)                | Integrated event/campaign routes and D1 mutation/race tests; product screens and delivery pending                           |
| 2026-09-13 | [Checkout and ticketing](./evidence/checkout.md)            | Atomic local D1 tests and complete free ticketing HTTP flow through workerd pass; paid/provider/deployed acceptance pending |
| 2026-09-13 | [Web authentication](./evidence/web-authentication.md)      | Real browser account flows, preferences, reset and session revocation pass; external OAuth/email pending                    |
| 2026-09-13 | Integrated automated suite                                  | 106 tests pass; `vp check` and the complete web/Worker/marketing build pass                                                 |

## External checks awaiting access or execution

Cloudflare account grants and Polar sandbox browser access/KZT product creation
are established. Cloudflare deployment, refund/webhook delivery, Google OAuth, Resend delivery,
GA4 reports, supported
calendar clients and physical iOS/Android tests have no acceptance evidence yet.
Missing credentials do not establish provider incompatibility. Continue local
implementation and integration while these checks remain pending.

Recent external constraints: the Mac locked before submitting the prepared
late-payment test. The user has been asked to unlock it. Both UDP and TCP tunnel
connections on port 7844 failed; no webhook endpoint was created. Cloudflare R2
is not enabled in the account. The local server and private sandbox run state
remain available, and no unrelated remote database was changed.

Resumed integration validation: 281/281 tests across 22 files passed, followed
by scoped checks for the test setup change. Full checks and web/Worker/Astro
builds passed. The web entry chunk is 548 kB minified and still emits a build
warning. Full-suite setup initially exhausted macOS loopback ports; batching
migration DDL and bounding parallel workerd test files fixed the run without
changing the tests' concurrent business operations. `vp env doctor` passed.

Latest integration validation: 424/424 tests across 32 files passed in 133 seconds.
Scoped checks covered all API, web, shared, script and documentation files; the
web/Worker/Astro build passed. The web entry chunk is now 584 kB minified and
still emits the existing size warning. This integration includes support live
delivery, cancellation/refunds, offline backend and simulated payout records.
The full `vp check` reached three lint findings in the unfinished mobile files;
that work remains outside this checkpoint and is being corrected by its owner.
