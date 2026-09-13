# Organizer history

Verified locally on 2026-09-13. This unit implements the retained event list, chronological event activity and past-event duplication required by architecture decisions and SRS 4.16. SRS 4.15 reporting is implemented separately in the reporting module.

## Access and API

| Method | Path under `/api`            | Purpose                                                               |
| ------ | ---------------------------- | --------------------------------------------------------------------- |
| GET    | `/organizer/history`         | Retained completed/cancelled events under current history authority.  |
| GET    | `/events/:eventId/history`   | Event metadata, retention information and filtered activity timeline. |
| POST   | `/events/:eventId/duplicate` | Copy reusable past-event configuration into a new draft.              |

The shared request/response schemas are in `packages/shared/src/history-api.ts`. `historyRoutes` is mounted by the application. Authentication uses the same persisted Better Auth session as other APIs.

The event owner has history access. Staff require the separate `history:read` grant; `event:manage`, `analytics:read`, scanner assignment and platform moderation alone do not grant it. All reads require a verified, unsuspended account and current event authority. Duplication instead requires `event:manage` or ownership. A delegated manager becomes the organizer of the newly created draft; no source permissions are inherited.

The timeline reads only audit entries whose scope is `event` and whose event matches the requested event. Account and platform entries are excluded even if they contain the event ID. Every support entry also requires a matching attendee case and current case access. This hides platform conversations, deleted/missing case references and support records from history-only staff. The default latest-activity date uses the same support filter. Message subjects, message bodies, credentials and provider payloads are not introduced into the history response.

Activity entries contain the timestamp, actor ID/name/type, action, affected entity, description and correlation ID. System actor identifiers are preserved; missing actor identities are labelled unknown. Names resolve from current account records, while the immutable actor ID remains the historical identity. There are no audit update/delete API routes. Migration 0019 supplies a general D1 trigger rejecting audit updates, including entries outside support. Privileged retention deletion remains separate.

## Filters and pagination

The list supports completed/cancelled state, title search, an optional inclusive civil-date range and bounded pagination. Multi-event date filters use Asia/Almaty and filter the event start date. An individual timeline uses its event's IANA time zone. It defaults to the last 30 calendar days ending at the latest visible event activity, capped at today, and supports seven days or a custom period of at most 180 days. The shared reporting date helper handles DST, midnight gaps and skipped dates.

Activity-type filters cover event changes, ticket types/seats, campaigns, permissions/invitations, activation, moderation, payments/orders, refunds, check-ins, support, payouts, offline work and other event-scoped actions. Entries sort chronologically by timestamp and immutable ID. Event lists sort by event start and ID descending. Page sizes are capped at 50. Cursors include a hash of the current actor and query filters, so they cannot be reused across accounts or date/type filters.

The final timeline event metadata and audit rows come from one D1 read batch. Each statement repeats current history authorization; audit rows repeat support authorization. The planned time zone is a SQL condition. If the zone changes while the date range is being prepared, the API returns `409` and requires a reload rather than relabelling old boundaries with the new zone.

## Retained event exposure

Completed/cancelled event history expires 180 days after the latest of event end, cancellation or linked support-case activity. Responses include the calculated expiry and whether an unresolved workflow currently holds the records. Expired events are omitted from the list and unavailable through the timeline/duplication service unless a hold applies.

Holds cover pending/failed refunds, pending or uncertain payment reconciliation, confirmed unfulfilled ticket payments awaiting compensation, unresolved order-linked refund/dispute/compensation cases, and unresolved reported admissions. Hold reasons contain categories only, not private case content. A failed refund remains held until financial reconciliation resolves it. A new linked case advances the event's retention anchor; resolving its status does not erase other financial/admission holds.

This unit restricts history exposure; it does not run general deletion. The full daily D1/R2 retention cleanup, draft/account deadlines, backup expiry and post-restore cleanup remain separate acceptance work. The cleanup implementation must use the same event holds before deleting operational records.

## Duplication transaction

The source must be ended or cancelled, retained, and not suspended by moderation. The caller supplies the current source revision and a future event start/end plus registration opening/closing. Registration must close after opening and no later than the new event starts. Every copied ticket type uses the new registration window. A resolved source cancellation or a source's paid activation is not copied into the draft.

The explicit allowlist copies event title/description/category, venue name/address, time zone, visibility, seating mode/layout identifier, capacity, per-order limit and refund instructions. It copies ticket-type names/descriptions, free/paid kind, price, quantity and hidden flag. Assigned-seat configuration copies section/row/number, accessibility and whether that place is enabled. Disabled places stay disabled as configuration; all holds and sales are cleared.

The new event, ticket types and inventory receive fresh IDs. The calendar UID and reporting identifier are new, calendar sequence/revision begin at zero, publication is `draft`, and paid-sales state is `pending`. Paid sales require the new event's own checklist, terms and fee. No attendee, order, ticket, payment, activation record, refund, check-in, support case, audit history, permission, invitation, campaign or campaign token is copied.

Duplication uses three bulk `INSERT ... SELECT` statements inside one D1 batch. Configuration is selected at commit, with the current source revision, account authority, source availability, future deadline and inventory consistency guarded in that same transaction. It supports up to 100 ticket types and 10,000 inventory places. Ticket-type ID mapping is bounded, and the server copies seating rows in SQL without sending the full venue as request bindings.

The batch appends one new-event audit entry, one `event.changed` outbox job and one request receipt. It does not mutate the source event or append new history to it. Repeating the same request returns the same draft; changing a request under an existing ID is rejected. A failed audit/outbox insert or changed source/permission rolls back every copied row. Concurrent independent duplication requests may each create a draft, while identical request IDs create only one.

## Verification

`apps/api/src/history/history.integration.test.ts` passes 12 tests on real Miniflare D1 with every migration, including 0019. Tests cover current history/manage/analytics/scanner/platform separation; unverified, revoked and suspended accounts; retained completed/cancelled filters; support/platform/account audit privacy; DST date filtering; tied-timestamp pagination; cursor isolation; and range bounds.

Duplication tests preserve a real completed free order and its canonical ticket in the source event, retain the original support case and campaign, and prove the new event contains no historical transactions or grants. An 80-seat source uses the actual activation service before duplication; the new draft retains its layout and disabled place but has no activation/payment record. Tests also cover identical concurrent requests, changed requests, stale ticket configuration, authority/deadline races, moderation suspension, upcoming sources, an injected outbox failure, the inventory bound and general audit immutability.

A separate test changes the event time zone between period preparation and the final read batch, expects `409`, then reloads successfully with the new zone. History format/lint/type checks and API typechecking pass. Browser history/duplication flows, deployed query performance, broad retained-record views and general retention/recovery remain acceptance work; this evidence does not claim them complete.
