# Academic retention evidence

The cleanup engine in `apps/api/src/retention` applies the academic retention rules in `docs/architecture-decisions.md`. It uses the same financial and admission holds as organizer history. A Platform Admin with `platform:recover` can read event deadlines and hold reasons through `GET /api/admin/retention`; authorization is checked again before returning the result.

## Deadlines and holds

- Completed or cancelled events expire 180 days after the latest of their event end, cancellation, or linked support activity. Their orders, tickets, payments, refunds, campaigns, admissions, event audit, support cases, transport records, request receipts and files expire together.
- Drafts expire 180 days after their last edit only when they have no orders or unfinished support, reservation, payment or refund work. A draft's planned future date does not postpone its last-edit deadline.
- A standalone support case expires 180 days after its own activity. Its messages, changes, attachments and linked notification work expire with it.
- Account and platform audit entries without an event expire after 180 days. A support audit remains with its case when later case activity extends the deadline.
- Completed outbox payloads expire after 30 days once their delivery work is complete. Event audits remain. Completed standalone email deliveries and their private payloads also expire after 30 days; unfinished sources prevent premature transport deletion.
- Inactive accounts expire 180 days after the later of creation and the recorded last sign-in, only when no retained business record, staff grant, session or platform grant needs the account relationship. The migration gives existing accounts a full 180-day grace period because earlier sign-in history cannot be reconstructed. Cleanup removes the login, credentials, profile and matching local authentication artifacts together, so removing a suspended profile cannot reactivate an old login.

Pending or failed unresolved refunds, pending/uncertain payment reconciliation, a successful payment requiring compensation, unresolved financial support cases and reported admissions postpone event deletion. The retention API returns the original deadline and the specific hold reasons. It does not expose support content, credentials or account identities.

The mobile client's expired snapshots and local journal have their shorter documented lifetimes. Server snapshot proofs remain until seven days after snapshot expiry because synchronization accepts operations captured during the valid snapshot window for up to seven days. Deleting the server proof at snapshot expiry would reject those legitimate delayed operations. Canonical scan results and incident reviews are event audit records and remain through the event deadline.

## Atomic deletion and retries

Each event or case retirement executes in one D1 batch. Its first guard recomputes eligibility using current database state. The batch records all immutable private object keys or ticket PDF prefixes in `retention_object_jobs`, then removes children in foreign-key order and finally removes the aggregate. A support update, new financial hold, competing retirement or failed constraint cannot produce partial canonical deletion. Existing snapshot and payment invariants remain enabled.

R2 work starts after this commit. D1 remains the durable job queue if R2 is unavailable. Each job uses a unique lease token, a 60-second lease and guarded acknowledgements. Prefix deletion is paginated. A stale worker cannot overwrite a newer lease or its cursor. Only private support, delivery-payload and ticket-PDF namespaces are accepted; malformed restored jobs cannot delete arbitrary files or backups.

A completed object job retains its immutable key for daily repeat sweeps for 30 days, then performs a final sweep before its tombstone is removed. This covers an upload or PDF write already in flight when the canonical record expired. Deletion of a missing R2 object succeeds without issuing new business work.

Each pass is bounded to 10 events, 20 standalone cases, 100 snapshots, 100 completed outbox rows, 100 standalone deliveries, 100 standalone audits, 100 local mail records, 100 inactive accounts and 50 R2 jobs. A large backlog requires repeated passes. `getRetentionBacklog` counts remaining eligible records, expired authentication ciphertext and unfinished object jobs even when a retry is delayed. Recovery must wait for `clear: true`, after running authentication-intent cleanup and the other recovery reconciliation steps. Financial and admission holds remain retained and are excluded from the deletion backlog.

## Local verification

`vp check --fix apps/api/src/retention` checks the engine, retention query and fixtures. `vp test apps/api/src/retention/retention.integration.test.ts --maxWorkers=1` exercises real migrated D1 databases and Miniflare R2 buckets. The fixtures complete payment and ticket issuance through the existing application transitions.

The 21-case suite passed in 58.85 seconds. Two subsequent focused cases also passed after adding standalone email-job deletion and expired-authentication backlog assertions. The final scoped check reported no warnings, lint errors or type errors in eight TypeScript files.

Coverage includes the exact 180-day boundary; later support/cancellation activity; an activity change before commit; current recovery authority; refund, payment and scan-incident holds; concurrent retirement; batch rollback; paid order and private attachment deletion; canonical check-in and simulated payout children; standalone cases; draft last-edit expiry; completed outbox and authentication payload expiry; inactive accounts and retained relationships; server snapshot proof lifetime; R2 failure and late writes; expired leases; malformed prefixes; and multi-page PDF deletion.

This is local database and object-storage evidence. Deployed daily scheduling, provider object deletion, retention after a disposable provider restore, infrastructure log retention and backup expiry still require their deployment and recovery evidence. Public event images are not represented by the current event schema; any later image implementation must register immutable keys with the retirement batch before release acceptance can cover those files.
