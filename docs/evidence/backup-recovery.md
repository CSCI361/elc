# Backup and recovery evidence

## Provisioning and local rehearsal — 2026-11-23

Remote acceptance remains incomplete. The following checks and provisioning were
performed against the configured preview account; no application database was
restored or switched.

- Confirmed the remote source `elc-preview`, database ID
  `850e6486-8bdb-4098-9369-441887943740`, in account
  `796baa3cbaf26549c2ed5a17dccba8c4`. Unrelated database contents were not read.
- Confirmed separate existing buckets `elc-preview-files` and
  `elc-preview-backups`. The backup bucket's managed `r2.dev` URL is disabled
  and it has no custom domains. Recovery-role IAM has not been verified.
- Added and read back the enabled `elc-sql-30-days` lifecycle rule: expire
  objects under `exports/` after 30 days. Preserved the existing seven-day
  incomplete-multipart-upload abort rule. Actual object expiration timing has
  not been observed.
- GitHub inspection found only the `preview` environment, no repository
  `ELC_BACKUPS_ENABLED` variable, and a skipped scheduled backup run:
  [run 45010972948](https://github.com/ieraasyl/elc/actions/runs/45010972948).
  The available GitHub credential has write access but no administrator access.
  Follow-up verification after the user reported completing setup still listed
  only `preview`; neither the backup environment nor its environment secrets
  and variables were accessible. Repository secret names were limited to
  `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; repository variables still
  contained only `ELC_PREVIEW_DEPLOY_ENABLED`.
  Scheduling has not been enabled by this verification.
- Installed the locked workspace dependencies with Vite+ 0.3.1 / pnpm 12.4.1.
  `node --test scripts/backup-core.test.mjs scripts/backup-sql.test.mjs` passed
  all 34 safety tests.
- `vp test --config scripts/backup-vitest.config.mjs` passed both full-schema
  local restore tests in 34.14 seconds. They restore into disposable Miniflare
  D1, round-trip exports through emulated R2, exercise production retention and
  reconciliation helpers, and keep recovery paused for unresolved admissions.
  Provider outcomes remain synthetic. The first attempt was blocked by the
  sandbox's localhost-listening restriction; the same command passed with the
  required local runtime access.

The user confirmed Workers Free, so the private local target records a seven-day
Time Travel window. The supplied dedicated token is active and can read metadata
for the selected D1 database. However, the backup preflight cannot read the
backup bucket's managed-domain settings: Cloudflare returns HTTP 403, error 10000. No SQL was exported, no completion manifest was published, and no remote
scratch database was created. Token values remain outside tracked source and
evidence.

Still required: correct the dedicated credential's R2 policy access, verify the
protected GitHub environment, enable the
repository variable, observe a successful scheduled export and its completion
manifest, and restore that export into a disposable remote database. The account
subscription metadata request returned HTTP 403; the Free-plan selection above
was supplied by the user. The
local rehearsal above does not satisfy remote restore or scheduled-export
acceptance. No credential or SQL export is included in this evidence.

## Previous local rehearsal — 2026-09-13

On 2026-09-13, the local backup/recovery checks passed against disposable Miniflare D1 and R2 resources. Each rehearsal applied all 32 migrations through `0031_reservation_expiry_indexes.sql`, exported the populated source database, and restored it into a second empty database. No remote resource, credential, billing setting or live `.wrangler/state` was read or modified.

| Check                                    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backup safety and recovery failure paths | `node --test scripts/backup-core.test.mjs scripts/backup-sql.test.mjs`: 34 passing tests. Public or ambiguous bucket policy stops before export; wrong source, corruption, future/expired exports and unsupported SQL stop restore; failures and unresolved reconciliation never resume.                                                                                                                                                       |
| Complete schema SQL/R2 restore           | `vp test --config scripts/backup-vitest.config.mjs`: two passing integration tests, about 32 seconds total. SQL was stored/read back through emulated R2, checksummed and imported into empty D1. Schema object names/types matched the source and a restored snapshot transition guard rejected an invalid mutation. The local adapter reports the required private 30-day policy; remote access and lifecycle enforcement remain unverified. |
| Retention after restore                  | Both tests called production `cleanupAuthEmailIntents`, repeated `runRetentionCleanup`, and required `getRetentionBacklog(...).clear` plus no unfinished object jobs. A 181-day-old draft, 31-day-old completed outbox payload and a queued expired private object were removed. The retained event and private object remained.                                                                                                               |
| Payments and reservation expiry          | Five orders crossed the export boundary. Production expiry released one expired hold. Reconciliation processed a later synthetic provider success for a still-valid reservation and compensated a later success for the expired reservation. The three original ticket IDs remained; exactly one new ticket was issued, and no ticket was issued for the expired order. Repeated payment/outbox processing left four tickets.                  |
| Uncertain refund                         | A real approval transition created a refund before export. The in-memory provider recorded acceptance and simulated a lost response. Restored reconciliation looked up that refund, confirmed the original order/ticket as refunded, and kept its dispatch count at one. Late-payment compensation also dispatched exactly once.                                                                                                               |
| Ticket PDF and email                     | A completed email/PDF and a pending email job crossed the export boundary. Production notification fanout, PDF sources and delivery consumers produced three ticket email jobs. Concurrent and repeated consumers retained one attempt and one local mailbox row per job. All three PDFs parsed as one-page documents; the original completed PDF bytes remained unchanged. Delivery never issued additional tickets.                          |
| Notification backlog                     | Recovery also drained every supported notification source through production fanout, including pending support and refund intents, then consumed all materialized jobs. Six local messages were delivered in total. A second pass replayed every source and delivery job and preserved job IDs, payload hashes, provider IDs, attempt counts and mailbox rows. No notification source or email-send outbox job remained unfinished.            |
| Offline metadata and admission review    | Two registered devices issued signed snapshots and reported the same ticket. The restore retained both operations and one canonical check-in, invalidated snapshots without rewriting signed manifests, and rejected a subsequent manifest read. Replaying the duplicate report retained its unresolved status. An explicit production review resolved it idempotently without adding another admission.                                       |
| Blocked resume                           | The second full-schema rehearsal left the duplicate report unresolved. Payment, refund and delivery reconciliation completed, but recovery rejected the admission attestation, kept maintenance paused and never reached `ready-for-resume` or `resumed`.                                                                                                                                                                                      |
| Loss report                              | The source was edited after export. The replacement recovered the older title, and the pre-restore protected export preserved the later state. The rehearsal recorded that synthetic loss before resume.                                                                                                                                                                                                                                       |
| Integrity                                | SQL digest/read-back checks passed, all schema object identities were restored, and `PRAGMA foreign_key_check` returned no violations.                                                                                                                                                                                                                                                                                                         |
| Formatting, lint and types               | Scoped `vp check --fix` passed for the rehearsal, its integration tests and `scripts/fixtures/backup-domains.ts` without warnings or errors.                                                                                                                                                                                                                                                                                                   |

The first raw import failed because the export interleaved child rows with tables not yet created. The implemented importer now creates all tables before loading data and installs transition guards afterward. The integration test exercises that corrected import with the repository's real schema. This is evidence for the local D1 emulator; a disposable remote import still needs verification.

The installed Wrangler 4.131.1 command help and implementation were inspected for D1 export, JSON Time Travel bookmarks, remote R2 object put/get, custom/managed domain responses and lifecycle `deleteObjectsTransition.condition.maxAge` in seconds. No remote API request was made by the verification scripts.

The nonempty fixture uses production checkout, payment/refund reconciliation, delivery, snapshot, offline sync and admission review helpers. `RecordedProvider` keeps synthetic provider state in memory across SQL restoration. Email uses the local mailbox with an adapter that throws if any external send or lookup is attempted. Maintenance probes remain synthetic. The separate `node scripts/backup-rehearsal.mjs` command remains a bounded, empty-domain smoke check; the Vite tests supply production cleanup and domain fixtures.

The pending payment successes in this fixture had never issued tickets or email after the selected backup. Existing ticket identities are preserved because they are present in that backup. This does not prove recovery of canonical ticket IDs, already delivered messages, or physical admissions lost after a real backup. Provider payment status alone cannot reconstruct those records. Such losses require an external reconciliation source and explicit operator review before resume. The test also does not prove a deployed recovery gate, physical scanner behavior, real delivery-provider deduplication, remote R2 retention, or provider Time Travel restoration.

The remaining deployment gates are:

- Provision the elc D1 database and separate private backup R2 bucket; verify recovery-role IAM, disabled public access and 30-day lifecycle behavior.
- Record the selected account plan's actual Time Travel window and capture a real bookmark.
- Configure the daily runner, failure notification and a successful export-age check.
- Supply the deployment-specific recovery adapter and verify external pause/drain/resume controls.
- Rehearse a remote SQL import and Time Travel recovery against disposable elc resources, including provider reconciliation, a restored-data retention pass, actual R2 object retention and a documented loss/admission review.

Remote R2 enrollment is unavailable in the current environment. No billing enrollment or unrelated-resource workaround was attempted. The [runbook](../backup-recovery.md) contains setup, export and recovery commands.

Integrated validation passes 1,408 tests across 84 files in 633.07 seconds. Full
checks pass 457 files; web/Worker/Astro builds pass. The backup rehearsal is
validated separately by its 34 safety cases and two nonempty restore cases.
