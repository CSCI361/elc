import { expect, it } from "vite-plus/test"
import { cleanupAuthEmailIntents } from "../apps/api/src/auth/delivery"
import { runRetentionCleanup } from "../apps/api/src/retention"
import { getRetentionBacklog } from "../apps/api/src/retention/backlog"
import { runBackupRehearsal } from "./backup-rehearsal.mjs"
import { createBackupDomains } from "./fixtures/backup-domains"

it("restores the full schema and reconciles nonempty payment, refund, delivery and admission records before resume", async () => {
  const result = await runBackupRehearsal({
    authCleanup: cleanupAuthEmailIntents,
    retentionCleanup: runRetentionCleanup,
    retentionBacklog: getRetentionBacklog,
    domains: createBackupDomains(),
  })
  expect(result).toMatchObject({
    passed: true,
    localOnly: true,
    checksumVerified: true,
    schemaObjectsRestored: true,
    transitionGuardsRestored: true,
    retention: "production-module",
    expiredFixtureRemoved: true,
    staleSnapshotInvalidated: true,
    immutableFilesRetained: true,
    foreignKeysValid: true,
    sourcePreserved: true,
    exportExpirationEnforced: true,
    providerTimeTravel: "pending",
    providerReconciliation: "production-helpers-synthetic-provider",
    domainReconciliation: {
      orders: 5,
      preservedTicketIds: 3,
      ticketsAfterReconciliation: 4,
      confirmedRefunds: 2,
      originalRefundDispatches: 1,
      lateCompensationDispatches: 1,
      localMail: 6,
      notificationJobs: 6,
      unfinishedNotifications: 0,
      validPdfs: 3,
      offlineOperations: 2,
      canonicalAdmissions: 1,
      unresolvedAdmissions: 0,
      snapshotsRejected: true,
      retriesPreservedIdentity: true,
    },
  })
})

it("keeps recovery paused when a restored offline admission report remains unresolved", async () => {
  const result = await runBackupRehearsal({
    authCleanup: cleanupAuthEmailIntents,
    retentionCleanup: runRetentionCleanup,
    retentionBacklog: getRetentionBacklog,
    domains: createBackupDomains({ resolveAdmissions: false }),
    expectBlocked: true,
  })
  expect(result).toMatchObject({
    passed: true,
    recoveryBlocked: true,
    maintenanceStillPaused: true,
    domainReconciliation: { unresolvedAdmissions: 1, canonicalAdmissions: 1 },
  })
  expect(result.stages).not.toContain("ready-for-resume")
  expect(result.stages).not.toContain("resumed")
})
