import { createHash, randomUUID } from "node:crypto"

export const exportLifetimeMs = 30 * 24 * 60 * 60 * 1000
export const backupPrefix = "exports/"
export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex")
const modes = new Set([
  "daily",
  "pre-migration",
  "pre-demonstration",
  "pre-restore",
])
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/
const validId = (id) => typeof id === "string" && idPattern.test(id)

export function assertBackupPolicy(policy) {
  if (
    policy?.private !== true ||
    policy?.expiresAfterSeconds !== exportLifetimeMs / 1000
  )
    throw new Error(
      "Backup bucket must be private with a 30-day export lifecycle"
    )
}

export async function createBackup({
  adapter,
  sourceId,
  reason = "daily",
  now = () => Date.now(),
}) {
  if (!validId(sourceId) || !modes.has(reason))
    throw new Error("Invalid backup target or reason")
  // Check before reading any customer data or writing an export.
  assertBackupPolicy(await adapter.policy())
  const startedAt = now()
  if (!Number.isSafeInteger(startedAt) || startedAt < 0)
    throw new Error("Invalid export clock")
  const bookmark = await adapter.bookmark()
  if (adapter.remote && (typeof bookmark !== "string" || !bookmark.length))
    throw new Error("A remote export requires a current Time Travel bookmark")
  const bytes = Buffer.from(await adapter.exportSql())
  if (!bytes.length || bytes.length > 512 * 1024 * 1024)
    throw new Error("Export size outside supported limits")
  const createdAt = now()
  if (!Number.isSafeInteger(createdAt) || createdAt < startedAt)
    throw new Error("Invalid export clock")
  const key = `${backupPrefix}${sourceId}/${new Date(createdAt).toISOString().replaceAll(":", "-")}-${randomUUID()}`
  const manifest = {
    version: 1,
    sourceId,
    reason,
    startedAt,
    createdAt,
    expiresAt: createdAt + exportLifetimeMs,
    bookmark,
    sqlKey: `${key}.sql`,
    byteLength: bytes.length,
    sha256: digest(bytes),
  }
  // SQL first, completion manifest last. A failed manifest write is never a usable backup.
  await adapter.put(manifest.sqlKey, bytes, "application/sql")
  const stored = await adapter.get(manifest.sqlKey)
  if (!stored || digest(stored) !== manifest.sha256)
    throw new Error("Uploaded SQL failed read-back verification")
  // Detect policy changes during a potentially long export before publishing its manifest.
  assertBackupPolicy(await adapter.policy())
  await adapter.put(
    `${key}.json`,
    Buffer.from(JSON.stringify(manifest)),
    "application/json"
  )
  return { manifestKey: `${key}.json`, manifest }
}

export function verifyBackup(manifest, bytes, sourceId, now = Date.now()) {
  if (
    !manifest ||
    manifest.version !== 1 ||
    !validId(sourceId) ||
    manifest.sourceId !== sourceId ||
    !modes.has(manifest.reason) ||
    !Number.isSafeInteger(manifest.createdAt) ||
    !Number.isSafeInteger(manifest.startedAt) ||
    manifest.startedAt > manifest.createdAt ||
    manifest.createdAt > now ||
    manifest.expiresAt !== manifest.createdAt + exportLifetimeMs ||
    manifest.expiresAt <= now ||
    !Number.isSafeInteger(manifest.byteLength) ||
    manifest.byteLength < 1 ||
    manifest.byteLength > 512 * 1024 * 1024 ||
    bytes.length !== manifest.byteLength ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
    digest(bytes) !== manifest.sha256 ||
    typeof manifest.sqlKey !== "string" ||
    !manifest.sqlKey.startsWith(`${backupPrefix}${sourceId}/`) ||
    !/^[a-zA-Z0-9_/.:-]+\.sql$/.test(manifest.sqlKey) ||
    manifest.sqlKey.includes("..")
  )
    throw new Error("Backup is expired, corrupt, or belongs to another source")
  return manifest
}

const pauseChecks = [
  "mutations",
  "offlineSync",
  "consumers",
  "privateReads",
  "inFlightDrained",
]
const domains = ["payments", "refunds", "admissions", "deliveries", "files"]

export async function restoreBackup({
  adapter,
  manifest,
  bytes,
  sourceId,
  targetId,
  resume = false,
  now = () => Date.now(),
}) {
  verifyBackup(manifest, bytes, sourceId, now())
  if (!validId(targetId)) throw new Error("Invalid restore target")
  const context = {
    recoveryId: randomUUID(),
    sourceId,
    targetId,
    backupAt: manifest.startedAt,
    restoredAt: now(),
  }
  const journal = async (stage) =>
    adapter.journal({ ...context, stage, at: now() })
  await journal("requested")
  await adapter.pause(context)
  await journal("paused")
  const checkPause = async () => {
    const status = await adapter.probePause(context)
    if (!pauseChecks.every((key) => status?.[key] === true))
      throw new Error("Recovery pause is not verified")
  }
  await checkPause()
  // A protected export/bookmark preserves changes since the chosen restore point.
  const protectedCurrent = await adapter.protectCurrent(context)
  if (
    protectedCurrent?.complete !== true ||
    typeof protectedCurrent.manifestKey !== "string" ||
    !protectedCurrent.manifestKey.startsWith(`${backupPrefix}${sourceId}/`) ||
    !protectedCurrent.manifestKey.endsWith(".json")
  )
    throw new Error("Pre-restore protection is incomplete")
  await journal("current-state-protected")
  await checkPause()
  await adapter.restoreSql(bytes, context)
  await journal("database-restored")
  await checkPause()
  const cleanup = await adapter.cleanup(context)
  if (cleanup?.complete !== true || cleanup.pendingObjects !== 0)
    throw new Error("Restored retention cleanup is incomplete")
  await journal("retention-complete")
  const snapshots = await adapter.invalidateSnapshots(context)
  if (snapshots?.complete !== true)
    throw new Error("Offline snapshot invalidation is incomplete")
  await journal("snapshots-invalidated")
  const reconciliation = await adapter.reconcile(context)
  if (
    !domains.every(
      (domain) =>
        reconciliation?.[domain]?.complete === true &&
        reconciliation[domain].unresolved === 0
    ) ||
    typeof reconciliation?.dataLossReport !== "string" ||
    !reconciliation.dataLossReport.trim()
  )
    throw new Error("Recovery reconciliation or data-loss review is incomplete")
  await checkPause()
  await journal("ready-for-resume")
  if (resume) {
    await adapter.resume(context)
    await journal("resumed")
  }
  return {
    ...context,
    state: resume ? "resumed" : "paused-ready",
    reconciliation,
  }
  // No finally/resume: every failed step deliberately leaves maintenance enabled.
}
