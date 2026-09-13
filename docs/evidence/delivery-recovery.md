# Operator delivery inspection and recovery

The API implementation is in `apps/api/src/delivery/recovery.ts`. Shared request and response schemas are in `packages/shared/src/delivery-api.ts`. Route mounting and operator controls belong to the integration unit.

## Contract

- `GET /admin/deliveries` calls `listDeliveries(db, actorId, query)`. It accepts `after`, `limit` (default 20, maximum 50), `emailState`, `pdfState`, `kind`, and `eventId`. Results are ordered by delivery ID and return `{ items, nextCursor }`.
- `GET /admin/deliveries/:id` calls `readDelivery(db, actorId, id)` and returns `{ delivery }`.
- `POST /admin/deliveries/:id/recover` calls `requestDeliveryRecovery(db, actorId, id, body)`. The body contains `requestId`, `reason`, `expectedUpdatedAt`, and `mode`. Success returns `{ deliveryId, requestId, mode, state: "queued", updatedAt }`.

Every operation requires a verified, unsuspended account with the current `platform:recover` grant. The mutation batch rechecks that authority and the delivery snapshot. A successful receipt replay also requires current authority. Missing delivery IDs return 404 to authorized operators; inaccessible callers receive 403 before any delivery lookup.

Inspection exposes IDs, source and entity references, delivery kind, PDF and email states, timestamps, attempt and failure counts, error codes, and provider receipt IDs and status. It includes `busyUntil` and `allowedRecoveryModes` for controls. It never returns recipient addresses, message bodies, metadata, PDF bytes, attachment data, or private payload keys and hashes. Responses use an explicit field allowlist and strict shared schemas.

## Recovery rules

`retry_preparation` is available only before the first send attempt, in failed, suppressed, or review-needed states. It clears an unsent payload pointer and returns PDF preparation to pending when a PDF is required. Existing payload tracking records remain available for cleanup.

`retry_same_request` requires an unknown provider ID, a retained frozen payload, and a previous attempt within the original 23-hour window. The exact boundary is rejected, as is a clock earlier than the previous attempt. Recovery preserves the delivery ID, frozen payload pointer and hash, first and last attempt timestamps, and total attempt count. The consumer derives the same provider idempotency key from that delivery ID.

`reconcile` requires a known external provider UUID and the retained attempted payload. It queues the accepted state for provider lookup, including when the previous provider status is missing. It remains available after the POST retry window. A failed provider lookup returns to review-needed without erasing the provider ID or issuing a POST.

Delivered, bounced, and locally completed deliveries cannot be recovered. A current lease rejects recovery. Optimistic state and lease guards reject a worker transition that occurs after the initial read. The same batch updates the job, restores its existing `email:<deliveryId>` outbox record, appends a platform audit entry, and inserts the request receipt. A duplicate request replays the exact response; changed reuse conflicts. Explicit recovery resets consecutive failures while preserving attempt history and provider receipts.

Operator actions do not read private objects, render PDFs, or call providers. Queue consumption still rechecks the current recipient and canonical source before sending.

## Validation

Migration `0023_delivery-inspection-indexes.sql` indexes each exposed filter with the delivery ID cursor. A single email-state, PDF-state, event, or kind filter can seek directly into its matching ID range without sorting that filter's entire history. The query-plan regression captures the actual SQL and bindings used by `listDeliveries`, then runs D1 `EXPLAIN QUERY PLAN` for each single-filter path. It checks the cursor seek and absence of a temporary ordering tree or delivery-table scan.

Combined filters use one leading filter index chosen by SQLite. The remaining filters are residual predicates, so their scan cost depends on how many records match the leading filter. The 50-item response limit does not bound those residual reads. The API supports these combinations but does not promise constant scan work for every combination.

The integration tests use isolated D1 databases with all repository migrations. The provider reconciliation and later recipient-revocation cases also use isolated Miniflare R2 storage. Synthetic adapters never contact external services. Each runtime is disposed after its test.

The tests exercise bounded pagination and privacy, current permissions, suspension and grant revocation during a mutation, original retry-window boundaries, active and competing leases, stale and terminal state changes, concurrent exact replay, audit failure rollback, preserved frozen requests, known-provider lookup failure, recipient revocation before consumption, and unchanged existing financial records.

`vp test apps/api/src/delivery/recovery.integration.test.ts --maxWorkers=1` passed all 15 tests on 2026-09-13. The financial-canary case runs with the default production database clock. The query-plan case checks all four filter cursor indexes against the SQL issued by the service. Scoped checks cover the implementation, shared schema, tests, and this evidence file.

This evidence does not claim live provider delivery or browser acceptance of the separate operator UI.
