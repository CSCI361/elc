# Support case REST, history and live delivery evidence

Implemented on 2026-09-13 against SRS sections 4.10 and 4.13 and the architecture's support, permissions, audit and payout rules. D1 owns the cases and history; a Durable Object delivers committed update references to authenticated WebSocket subscribers. Email and attachments remain pending.

## Contracts and access

`support_cases` stores the requester, audience, issue category, subject, optional event/order/ticket context, assignee, four-state status, revision and last update sequence. `support_messages` and `support_case_changes` preserve the ordered conversation and state history. Migrations `0010_support_cases.sql` and `0011_support_guards.sql` add the tables and scope/immutability guards.

An attendee request must identify an event, order or ticket so it has an organizer support team. Order and ticket references must belong to the requester; the server derives missing parent context and rejects mismatches. A named attendee does not acquire account ownership. A purchaser can request help about an owned order after an event is unpublished. Event-only requests use current event read access, including accepted private invitations.

Organizer-to-platform cases may omit event context for account or technical issues. Any linked event must belong to the requester, and linked orders/tickets must belong to that event. Event management permission alone does not authorize opening a platform conversation on the owner's behalf.

Attendee conversations are readable by their requester, the event owner, currently assigned `support:manage` staff, and accounts with `platform:support` or `platform:moderate`. Organizer-to-platform conversations are readable only by their requester and those platform roles. Scanner, refund and unrelated event permissions do not grant conversation access. Assignment itself never grants access, and new assignees must already have current staff authority for that case.

Requesters can post messages. Authorized staff assign cases and explicitly change status among `open`, `in_progress`, `waiting_for_customer` and `resolved`. A resolved case must be reopened by staff before another reply. There are no message, case-history or audit edit/delete routes. SQL update triggers also reject changes to message/history records and support audit entries; privileged retention deletion remains a separate future operation.

## Financial integration

`voluntaryRefundSupportSql(actorId, caseId, orderId)` validates an unresolved attendee case in the `refund` category, with exact order/event/requester ownership, and current event-owner or `refund:initiate` authority. `requireVoluntaryRefundSupport` performs the same read check and returns the predicate for the final financial transaction. It returns no conversation data.

Refund permission can act on this validated reference without `support:manage`. Conversely, support permission alone cannot approve a refund. This follows the architecture's separate support/refund grants; it does not create a new requirement that financial staff also receive private conversation access. The financial service must still enforce cutoff, admission, payment and full-amount rules.

`unresolvedOrderSupportSql(orderId)` reports unresolved order-linked `refund`, `dispute` or `compensation` cases. These hold the affected order's simulated payout, including a refund request awaiting a decision. Other payment questions do not hold payouts automatically. Pending financial records and reported admissions remain additional sources checked by their own services. Resolving a case alone does not override those other holds.

## Transactions and REST

Every successful create, message, assignment or status operation commits one D1 batch containing the case revision, a sequential change, any message, a generic audit entry, two stable outbox jobs and the request receipt. The jobs are `support.notify` and `support.live`; their payload contains only case ID, committed change ID and sequence. Live delivery rechecks current access before each frame. Notification jobs remain pending until email delivery is implemented.

The case sequence advances once per mutation, and the current revision is required for every mutation after creation. SQL guards recheck account eligibility, case access, contextual references and assignee authority at commit. A zero-row update aborts the batch. Duplicate request IDs with the same normalized operation replay the committed response; changed payloads are rejected. Replay rechecks current access.

The exported `supportRoutes` module mounts under `/api`:

| Method     | Path                                | Purpose                                               |
| ---------- | ----------------------------------- | ----------------------------------------------------- |
| GET / POST | `/support/cases`                    | Paginated list / create with first message            |
| GET        | `/support/cases/:caseId`            | Current case and caller capabilities                  |
| GET / POST | `/support/cases/:caseId/messages`   | Paginated messages / append reply                     |
| GET        | `/support/cases/:caseId/changes`    | Ordered catch-up including messages and state changes |
| GET        | `/support/cases/:caseId/assignees`  | Current manager's paginated eligible assignee picker  |
| GET        | `/support/cases/:caseId/live`       | Authenticated WebSocket upgrade with update cursor    |
| PATCH      | `/support/cases/:caseId/assignment` | Assign or clear an eligible staff member              |
| PATCH      | `/support/cases/:caseId/status`     | Explicit staff status transition                      |

Creation uses `openSupportCaseSchema` with `requestId`, `audience`, `category`, `subject`, `body` and optional context IDs. Later mutations include `requestId` and `expectedRevision`. These REST contracts live in `packages/shared/src/support-api.ts`; the earlier planning schemas in `operations.ts` are not the REST request format.

Case lists offer `mine`, `staff` and `assigned` views, with event/status/category filters and account/filter-bound cursors. Messages and changes accept `after` as the last observed sequence and a bounded `limit`. Responses contain `throughSequence`, `caseRevision`, and `nextCursor`; finish each page before advancing to `throughSequence`. Changes include all mutation kinds, so clients can recover gaps and deduplicate committed IDs after reconnect.

Platform-conversation audit records have platform scope and no event ID, even when the case links to an event. Audit descriptions exclude subject and message content. A future event-history API must check case access before exposing attendee support entries, rather than treating general event-history access as permission to read a support conversation.

The assignee picker returns only user IDs and names. It rechecks the caller's management authority around the read and uses the same current account, permission and audience rules as assignment. Organizer-to-platform cases list eligible platform staff only. Requester access alone does not expose the picker; neither email addresses nor unrelated account records are returned.

## Live delivery

The API requires a persisted Better Auth session, current case access, an exact configured `Origin`, and the `elc.support.v1` WebSocket subprotocol. Cross-site requests and caller-supplied internal identity headers cannot authorize a subscription. The Durable Object independently checks the stored session ID, actor, expiry, account state and current case ACL. It repeats that D1 check before each outgoing update, on application `ping` messages, and through a 30-second alarm. Connection attachments contain internal identifiers and counters, never a cookie or session bearer token.

The room uses `acceptWebSocket` and serialized attachments instead of keeping canonical conversations in memory. This follows Cloudflare's [WebSocket Hibernation API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) and [alarm lifecycle](https://developers.cloudflare.com/durable-objects/api/alarms/). There are no interval timers keeping the object awake.

The shared protocol contains `ready`, `case_update` and `pong` frames. Updates contain only the case ID, immutable update ID and sequence. Subjects and message bodies always come from authorized REST reads. Clients use `after` on reconnect, deduplicate update IDs and sequences, and fetch `/changes` to recover gaps. A newer sequence can arrive before an older queue job; the room suppresses that stale delivery, and REST retains both changes.

Each case permits at most 32 sockets, with three per session and eight per actor. Connections expire after 30 minutes. Application messages are limited to 256 UTF-8 bytes and 12 pings per minute; conversation writes are REST-only. Outgoing case updates are limited to 120 per socket per minute. Reaching a limit closes the subscription so the client can recover through REST.

After a REST mutation commits, `waitUntil` attempts its stable `support.live` outbox job immediately. The room loads the referenced canonical change from D1 and rejects missing, cross-case or altered payload references. Queue dispatch reads at most 20 due jobs; failed queue sends preserve the pending record. Failed room delivery records a bounded retry delay. Cron dispatch and the Queue consumer retry these same jobs. Successful delivery marks completion after fan-out. Replays are harmless because sockets track their highest delivered sequence and clients recover through REST. The root consumer checks support jobs before constructing any payment adapter.

## Verification and remaining acceptance

`apps/api/src/support/support.integration.test.ts` uses real Miniflare D1 with every migration. It exercises canonical checkout/issuance context, foreign references, role separation, platform privacy, independent refund authority, payout holds, duplicate creates, competing replies, revoked staff/assignee/account/private-invitation races, history pagination, cursor isolation and immutable records. An actual D1 trigger rejects one outbox insert to prove that case, message, history, audit and receipt all roll back together.

The REST integration file passes all 13 tests. The existing six D1 authorization tests also pass with the support migrations. Routes are mounted in the application at `/api`.

`apps/api/src/support/live/live.integration.test.ts` builds the actual support handlers and Better Auth into a workerd test Worker, applies all migrations to real Miniflare D1, and uses actual WebSocket upgrades and a local Queue consumer. It covers concurrent authenticated subscriptions, rejected origins/protocols/forged identity headers, logout and permission revocation before delivery, account suspension, stored session expiry, durable retry, immediate HTTP-save delivery, duplicate/out-of-order updates, REST reconnect catch-up, subscription/message limits and the assignee picker. The test bundle explicitly uses the `workerd` SSR resolve condition; a browser-only AsyncLocalStorage fallback is unsuitable for concurrent server requests.

All nine live integration tests pass. Focused format, lint and type checks pass, and `vp run build` passes for the Worker, web app and marketing site. The web build retains the existing warning for a JavaScript chunk larger than 500 kB.

Hibernation is exercised with Miniflare's runtime eviction API while keeping sockets open, then a ping verifies restored attachments. Idle revalidation is exercised by invoking the real alarm handler through a test-only subclass method; this does not claim a deployed scheduler fired. Publish-time revocation immediately removes the subscription and sends no unauthorized frame. Miniflare did not surface the client close event on that path within five seconds, despite server removal. Tests assert detachment and absence of unauthorized updates; separate ping/alarm tests verify the `1008` close code. Remote transport timing remains an acceptance item.

Browser support, assignment, live refresh and revocation checks are recorded separately in [web support and refunds evidence](web-support-refunds.md).

Remote deployment, actual notification delivery, reconnect/idle-alarm behavior against a deployed Durable Object, multi-region load, attachment validation and retention cleanup remain pending. The deployment prerequisites are recorded in [the preview plan](../deployment-preview-plan.md).
