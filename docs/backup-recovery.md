# Backup and recovery

The academic policy keeps SQL exports for 30 days in a separate private R2 bucket. D1 Time Travel is an additional recovery source. This runbook and the scripts implement protected exports and an ordered recovery procedure. Remote deployment, IAM, daily scheduling and a provider restore rehearsal remain pending. See [local evidence](evidence/backup-recovery.md).

## Targets and access

Use a dedicated deployment credential that can export only the elc database and write/read the elc backup bucket. The credential needs permission to inspect that bucket's public-domain and lifecycle settings. Platform Admins with the recovery role may obtain separately scoped recovery access. Attendees, organizers, marketing assets, public image delivery and the normal application query API must have no backup download route. Verify account IAM separately; checking that a bucket has no public domain does not prove its IAM membership.

Keep `FILES` and `BACKUPS` in different buckets. Disable the backup bucket's `r2.dev` domain and remove all custom domains, including disabled custom-domain bindings. Apply an age-based 30-day expiration rule to `exports/`. For an already authorized, explicitly selected deployment, the setup command is:

```sh
vp exec wrangler r2 bucket lifecycle add <backup-bucket> elc-sql-30-days exports/ --expire-days 30 --config <deployment-wrangler-config>
```

This changes bucket policy and belongs in deployment provisioning. The backup script never changes public access, IAM or lifecycle policy. It refuses to export if the policy is missing, public, shorter than 30 days, ambiguous or conflicting. Both SQL and completion manifests use the same prefix. A lifecycle expiration deletes an object; an HTTP `Expires` header only controls caching and is not a retention policy. R2 lifecycle execution is asynchronous, so restore validation also rejects a manifest at its exact 30-day deadline. See [R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

Create a private target JSON file outside tracked source, for example `.wrangler/backup-target.json`, with mode `0600`:

```json
{
  "accountId": "<32-character Cloudflare account ID>",
  "databaseId": "<elc D1 database UUID>",
  "databaseName": "<elc D1 database name>",
  "backupBucket": "<private elc backup bucket>",
  "filesBucket": "<elc files bucket>",
  "timeTravelDays": 7
}
```

Replace every placeholder with the reviewed deployment target. Record the account plan and its actual Time Travel window in the deployment record. The documented windows are seven days on Workers Free and 30 days on Workers Paid. `timeTravelDays` records that operator verification; the script does not infer or purchase a plan. Time Travel operates on the production D1 storage backend and restores in place. See [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

Set `CLOUDFLARE_API_TOKEN` in the deployment runner's secret environment. The scripts never read the app's `.dev.vars`, a Polar fixture or the developer's default Wrangler configuration. They generate an explicit temporary configuration and an empty environment file. SQL files and provider logs stay in a private temporary directory and are removed on normal completion or failure. Use an ephemeral runner and remove any abandoned `elc-backup-*` temporary directory after a forced process termination. Do not publish raw Wrangler output: D1 export output contains a signed download URL.

## Daily and protected exports

After installing the repository dependencies, run:

```sh
node scripts/backup-database.mjs --remote --target .wrangler/backup-target.json --confirm-database <elc-database-UUID> --reason daily
```

The script checks bucket policy before reading data, records a current Time Travel bookmark, exports the full D1 schema and rows, and writes SQL to a unique `exports/<database-UUID>/...sql` object. It downloads the uploaded SQL and compares its SHA-256 digest before publishing the corresponding JSON completion manifest. The manifest records source ID, reason, bookmark, export start/completion time, byte count, digest and expiry. A SQL object without a matching completion manifest is an incomplete backup. Backup output includes only target ID, object key, timestamps and digest.

The repository's `.github/workflows/backups.yml` schedules this command at 02:30 UTC and prevents overlapping runs. It remains disabled until repository variable `ELC_BACKUPS_ENABLED` is exactly `true`. Configure its `academic-backups` environment with secrets `ELC_BACKUP_API_TOKEN` and `ELC_BACKUP_TARGET_JSON`, and variable `ELC_BACKUP_DATABASE_ID`. Restrict that environment to the reviewed deployment branch and recovery operators. The JSON has the same target fields shown above. The workflow writes it to a private temporary file and removes it after the run; it never uploads SQL as a CI artifact. Manual workflow dispatch supports the protected export reasons.

Keep failure notifications enabled and check the most recent successful manifest's age. More than 26 hours without a completed daily export is an operational failure. Remote resources, runner credentials, notification settings and an actual successful scheduled export are still unconfigured and unverified. The checked-in workflow does not establish deployed scheduling acceptance.

Use the same command with `--reason pre-migration` immediately before a schema migration and `--reason pre-demonstration` before the final demonstration. Pause changes first when the bookmark and SQL export must represent the same application state. Confirm that a completion manifest exists before applying migrations. All reasons have the same 30-day expiration. The protected bookmark is captured before export begins; a daily export under normal traffic can therefore contain writes after that bookmark.

Exports larger than 512 MiB stop without publishing a completion manifest. That bound prevents the academic runner from exhausting memory. A larger deployment needs a streaming export/read-back adapter and a rehearsed large-database import before relying on this tooling.

## Recovery sequence

1. Record the incident, selected source database, backup/Time Travel point, intended target and expected loss interval. Restrict recovery access to the deployment service and the Platform Admin recovery role.
2. Set the deployment's external `RECOVERY_MODE=paused` gate. The application returns HTTP 503 with `Retry-After: 60` for every API route before accessing D1, including health, authentication, public event reads and webhooks. Cron skips background work and queue batches retry. Support Durable Objects reject new connections/publications and close existing subscriptions on their next authorization check. Drain in-flight work and verify the deployed gate before changing data. Keep the setting outside D1, so restoring D1 cannot restore an old unpaused value. Messages that exhaust queue retries may reach the dead-letter queue; retained D1 outbox work and reviewed dead-letter replay must be reconciled before resumption.
3. Capture an additional `pre-restore` export and current bookmark. Preserve the interval after the selected recovery point for comparison. Export current admission/operation journals and delivery/provider references to restricted recovery storage; never publish their personal or credential fields.
4. Restore into an empty replacement database for a SQL rehearsal. The Cloudflare adapter refuses a populated target. It creates all tables before importing rows, adds indexes/views and transition triggers after loading final-state rows, and checks foreign keys. Raw D1 exports can interleave table creation with rows that reference tables not yet created; transition triggers also must not interpret restored final rows as new business commands. Unknown SQL forms stop for review. Keep the source database intact until the replacement passes verification and an authorized deployment switch.
5. For an in-place Time Travel recovery, use the explicitly configured database and captured bookmark while the same external pause is active:

   ```sh
   vp exec wrangler d1 time-travel restore <elc-database-name> --bookmark <reviewed-bookmark> --config <deployment-wrangler-config>
   ```

   This overwrites that database. Record the undo bookmark returned by the provider in restricted recovery storage. Confirm that the deployed code matches the restored schema; apply needed migrations only after another protected export.

6. Run `cleanupAuthEmailIntents({ DB }, now)` from `apps/api/src/auth/delivery.ts` to remove expired encrypted authentication links, then `runRetentionCleanup({ DB, FILES }, now)` from `apps/api/src/retention/index.ts` repeatedly, then inspect `getRetentionBacklog(DB, now)` from `apps/api/src/retention/backlog.ts`. Require `clear === true`. A pass that removes zero rows does not prove completion: failed R2 jobs can be waiting for retry. Leave the service paused until overdue deletions finish. Financial compensation and unresolved scan holds legitimately postpone affected aggregate deletion; record those cases in the recovery review.
7. Invalidate every restored offline snapshot whose `invalidated_at` is null. Set `invalidated_at` to `max(recoveryTime, issued_at)` and preserve immutable manifest/ticket metadata and device journals. Verify no restored snapshot remains usable. Devices must obtain fresh snapshots; previously captured operations still need explicit reconciliation and conflict review.
8. Reconcile the domains below against the protected current-state export, provider records and device journals. Do not replay raw jobs to infer success.
9. Record the observed loss interval, lost changes, unresolved admissions, reconciliation evidence and reviewer. Repeat the pause probe and confirm retention is still clear. Resume only when required recovery checks have passed, then verify API access, one harmless mutation, queue delivery and a fresh offline snapshot. Keep the private recovery journal for incident review under the applicable retention policy.

| Domain                  | Required reconciliation before release                                                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Payments and activation | Query the provider by existing payment/checkout references and idempotency keys. Restore succeeded canonical state through existing transitions; never charge again because a restored row says pending. Reconcile expired/abandoned checkout success through compensation.                |
| Refunds                 | Compare requested and confirmed amounts with provider refund IDs. Preserve already confirmed refunds and ticket invalidation. Retry only through existing idempotent refund transitions.                                                                                                   |
| Admissions              | Compare server check-ins, immutable operation IDs, reversals and device journals with the protected pre-restore state. Record physical admissions absent from the restored point; do not allow their tickets to be admitted again automatically. Review conflicts and lost-device reports. |
| Deliveries              | Compare stable delivery IDs, provider acceptance references, pending outbox entries and private payload objects. Keep confirmed sends confirmed. Apply the delivery system's ambiguous-outcome policy before any retry.                                                                    |
| Files                   | Verify retained immutable image/attachment keys still exist, drain overdue object jobs, and regenerate missing ticket PDFs from retained canonical records. SQL recovery does not recover deleted R2 uploads.                                                                              |

## Checked restore command

`scripts/restore-database.mjs` performs the ordered sequence and writes a private JSONL stage journal outside the database. It verifies backup age, source ID, byte length and digest before pausing or touching the target. It defaults to leaving the deployment paused after successful checks. `--resume` explicitly requests the final resume operation.

```sh
node scripts/restore-database.mjs --manifest <downloaded-manifest.json> --sql <downloaded-export.sql> --source <source-UUID> --target <replacement-UUID> --confirm-target <replacement-UUID> --adapter <trusted-operator-module.mjs> --journal .wrangler/recovery-journal.jsonl
```

The operator module is trusted deployment code, not uploaded data. It exports `createRecoveryAdapter({ sourceId, targetId })` with these asynchronous methods:

| Method                         | Contract                                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pause(context)`               | Enable the external deployment gate.                                                                                                                                                             |
| `probePause(context)`          | Return `true` for `mutations`, `offlineSync`, `consumers`, `privateReads` and `inFlightDrained` only after live verification.                                                                    |
| `protectCurrent(context)`      | Finish the pre-restore SQL export/bookmark and preserve current-state reconciliation evidence. Return `{ complete: true, manifestKey }` for the source database's protected completion manifest. |
| `restoreSql(bytes, context)`   | Import into the explicit empty replacement target or finish an explicitly selected provider restore. The shared Cloudflare adapter supplies an empty-target SQL import.                          |
| `cleanup(context)`             | Drain production retention and return `{ complete: true, pendingObjects: 0 }` only after the authoritative backlog is clear.                                                                     |
| `invalidateSnapshots(context)` | Persist snapshot invalidation and return `{ complete: true }` only after checking all restored snapshots.                                                                                        |
| `reconcile(context)`           | Return `{ complete: true, unresolved: 0 }` for each of `payments`, `refunds`, `admissions`, `deliveries`, `files`, plus a nonempty `dataLossReport` describing actual evidence.                  |
| `resume(context)`              | Release the external gate after every prior check passes and verify the deployment accepts work.                                                                                                 |

`context` contains a recovery ID, source/target IDs and backup/recovery timestamps. The CLI supplies `journal` itself. There is no failure handler that resumes the application. A process failure, cleanup error, uncertain provider response, unresolved admission or failed journal write leaves recovery paused. The shared Cloudflare adapter is available through `withCloudflareBackup(target, callback)`; its `restoreSql` method performs the guarded empty-target import. A deployment-specific operator module must supply real maintenance control, provider reconciliation and post-resume probes. The local rehearsal supplies synthetic controls; those do not prove external recovery acceptance.

## Local rehearsal

These commands create disposable Miniflare resources and never touch `.wrangler/state`:

```sh
node --test scripts/backup-core.test.mjs scripts/backup-sql.test.mjs
vp test --config scripts/backup-vitest.config.mjs
```

The Vite test injects the production retention module into the full migrated-schema rehearsal. It validates SQL/R2 roundtrip, schema object preservation, restored transition guards, expired draft/outbox/file cleanup, stale snapshot invalidation, retained immutable files, foreign keys and the recorded loss of a synthetic post-export edit. The source remains unchanged by restoration. Provider/payment/admission/delivery outcomes are synthetic and explicitly labelled.

`node scripts/backup-rehearsal.mjs` is a smaller Node-only smoke command using bounded fixture cleanup. Use the Vite test for production-retention acceptance. Neither command proves R2's remote lifecycle timing, cloud IAM, actual Time Travel, remote import behavior or real provider reconciliation.
