import { expect, it } from "vite-plus/test"
import { cleanupAuthEmailIntents } from "../apps/api/src/auth/delivery"
import { runRetentionCleanup } from "../apps/api/src/retention"
import { getRetentionBacklog } from "../apps/api/src/retention/backlog"
import { runBackupRehearsal } from "./backup-rehearsal.mjs"

it("restores the migrated D1 export through private R2 and production retention before resume", async () => {
  const result = await runBackupRehearsal({
    authCleanup: cleanupAuthEmailIntents,
    retentionCleanup: runRetentionCleanup,
    retentionBacklog: getRetentionBacklog,
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
    providerReconciliation: "synthetic",
  })
})
