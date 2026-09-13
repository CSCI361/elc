# Backup and recovery evidence

On 2026-09-13, the local backup/recovery checks passed against disposable Miniflare D1 and R2 resources. The rehearsal applied all 29 migrations through `0028_retention_object_jobs.sql`. No remote database, bucket, billing setting, credential or live `.wrangler/state` was read or modified.

| Check                                    | Evidence                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backup safety and recovery failure paths | `node --test scripts/backup-core.test.mjs scripts/backup-sql.test.mjs`: 34 passing tests. Public or ambiguous bucket policy stops before export; wrong source, corruption, future/expired exports and unsupported SQL stop restore; failures and unresolved reconciliation never resume.                                                             |
| Complete schema SQL/R2 restore           | `vp test --config scripts/backup-vitest.config.mjs`: one passing integration test, 3.18 seconds. SQL was exported from migrated source D1, stored/read back through private emulated R2, checksummed and imported into empty D1. Schema object names/types matched the source and a restored snapshot transition guard rejected an invalid mutation. |
| Retention after restore                  | The integration test ran production `runRetentionCleanup` until idle and required `getRetentionBacklog(...).clear`. A 181-day-old draft, 31-day-old completed outbox payload and a queued expired private object were removed. The retained event and private object remained.                                                                       |
| Offline metadata                         | The restored snapshot was invalidated without rewriting its manifest or deleting its device.                                                                                                                                                                                                                                                         |
| Loss report                              | The source was edited after export. The replacement recovered the older title, and the pre-restore protected export preserved the later state. The rehearsal recorded that synthetic loss before resume.                                                                                                                                             |
| Integrity                                | SQL digest/read-back checks passed, all schema object identities were restored, and `PRAGMA foreign_key_check` returned no violations.                                                                                                                                                                                                               |
| Formatting, lint and types               | Scoped `vp check --fix` passed for the ten backup/restore code and test files without warnings or errors.                                                                                                                                                                                                                                            |

The first raw import failed because the export interleaved child rows with tables not yet created. The implemented importer now creates all tables before loading data and installs transition guards afterward. The integration test exercises that corrected import with the repository's real schema. This is evidence for the local D1 emulator; a disposable remote import still needs verification.

The installed Wrangler 4.131.1 command help and implementation were inspected for D1 export, JSON Time Travel bookmarks, remote R2 object put/get, custom/managed domain responses and lifecycle `deleteObjectsTransition.condition.maxAge` in seconds. No remote API request was made by the verification scripts.

The local test uses synthetic maintenance probes and empty payment/refund/admission/delivery domains. It proves checked ordering and failure behavior, not real external reconciliation. It does not prove the deployed recovery gate, physical scanner behavior, delivery deduplication after a provider restore, or an actual provider bookmark restore.

The remaining deployment gates are:

- Provision the elc D1 database and separate private backup R2 bucket; verify recovery-role IAM, disabled public access and 30-day lifecycle behavior.
- Record the selected account plan's actual Time Travel window and capture a real bookmark.
- Configure the daily runner, failure notification and a successful export-age check.
- Supply the deployment-specific recovery adapter and verify external pause/drain/resume controls.
- Rehearse a remote SQL import and Time Travel recovery against disposable elc resources, including provider reconciliation, a restored-data retention pass, actual R2 object retention and a documented loss/admission review.

Remote R2 enrollment is unavailable in the current environment. No billing enrollment or unrelated-resource workaround was attempted. The [runbook](../backup-recovery.md) contains setup, export and recovery commands.
