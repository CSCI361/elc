import assert from "node:assert/strict"
import test from "node:test"
import {
  createBackup,
  restoreBackup,
  verifyBackup,
  exportLifetimeMs,
} from "./lib/backup-core.mjs"
import {
  validateTarget,
  verifyBucketConfiguration,
} from "./lib/backup-cloudflare.mjs"

const now = 1800000000000
function fixture() {
  const calls = []
  const objects = new Map()
  const bytes = Buffer.from("CREATE TABLE example(id TEXT);")
  const adapter = {
    policy: async () => ({
      private: true,
      expiresAfterSeconds: exportLifetimeMs / 1000,
    }),
    bookmark: async () => "bookmark",
    exportSql: async () => {
      calls.push("export")
      return bytes
    },
    put: async (key, body) => {
      calls.push(key.endsWith(".sql") ? "sql" : "manifest")
      objects.set(key, body)
    },
    get: async (key) => objects.get(key),
  }
  return { adapter, calls, bytes, objects }
}
async function exported() {
  const value = fixture()
  return {
    ...value,
    ...(await createBackup({
      adapter: value.adapter,
      sourceId: "source",
      now: () => now,
    })),
  }
}
function recovery() {
  const calls = []
  let paused = false
  const adapter = {
    journal: async (entry) => calls.push(entry.stage),
    pause: async () => {
      paused = true
    },
    probePause: async () => ({
      mutations: paused,
      offlineSync: paused,
      consumers: paused,
      privateReads: paused,
      inFlightDrained: paused,
    }),
    protectCurrent: async () => ({
      complete: true,
      manifestKey: "exports/source/protected.json",
    }),
    restoreSql: async () => {},
    cleanup: async () => ({ complete: true, pendingObjects: 0 }),
    invalidateSnapshots: async () => ({ complete: true }),
    reconcile: async () =>
      Object.fromEntries([
        ...["payments", "refunds", "admissions", "deliveries", "files"].map(
          (key) => [key, { complete: true, unresolved: 0 }]
        ),
        ["dataLossReport", "No data loss in this synthetic fixture"],
      ]),
    resume: async () => {
      paused = false
    },
  }
  return { adapter, calls, paused: () => paused }
}

await test("publishes SQL only after a private 30-day preflight and manifest only after readback", async () => {
  const result = await exported()
  assert.deepEqual(result.calls, ["export", "sql", "manifest"])
  assert.equal(result.manifest.expiresAt, now + exportLifetimeMs)
  assert.equal(
    verifyBackup(result.manifest, result.bytes, "source", now),
    result.manifest
  )
})
for (const policy of [
  { private: false, expiresAfterSeconds: 2592000 },
  { private: true, expiresAfterSeconds: 604800 },
  null,
]) {
  await test(`rejects invalid policy ${JSON.stringify(policy)} before export`, async () => {
    const value = fixture()
    value.adapter.policy = async () => policy
    await assert.rejects(
      createBackup({ adapter: value.adapter, sourceId: "source" })
    )
    assert.equal(value.calls.length, 0)
  })
}
await test("readback corruption never publishes completion manifest", async () => {
  const value = fixture()
  value.adapter.get = async () => Buffer.from("changed")
  await assert.rejects(
    createBackup({ adapter: value.adapter, sourceId: "source" })
  )
  assert.deepEqual(value.calls, ["export", "sql"])
})
await test("privacy changes after export prevent completion manifest", async () => {
  const value = fixture()
  let requests = 0
  value.adapter.policy = async () => ({
    private: ++requests === 1,
    expiresAfterSeconds: 2592000,
  })
  await assert.rejects(
    createBackup({ adapter: value.adapter, sourceId: "source" })
  )
  assert.deepEqual(value.calls, ["export", "sql"])
})
await test("missing remote bookmark stops export", async () => {
  const value = fixture()
  value.adapter.remote = true
  value.adapter.bookmark = async () => null
  await assert.rejects(
    createBackup({ adapter: value.adapter, sourceId: "source" })
  )
  assert.deepEqual(value.calls, [])
})
await test("expired, future, corrupt and wrong-source exports are rejected", async () => {
  const value = await exported()
  for (const args of [
    [value.manifest, value.bytes, "source", now + exportLifetimeMs],
    [value.manifest, value.bytes, "source", now - 1],
    [value.manifest, Buffer.from("corrupt"), "source", now],
    [value.manifest, value.bytes, "other", now],
    [
      { ...value.manifest, expiresAt: now + exportLifetimeMs + 1 },
      value.bytes,
      "source",
      now,
    ],
    [
      { ...value.manifest, sqlKey: "exports/source/../other.sql" },
      value.bytes,
      "source",
      now,
    ],
  ])
    assert.throws(() => verifyBackup(...args))
})
await test("restore orders retention, snapshots and reconciliation before optional resume", async () => {
  const value = await exported()
  const control = recovery()
  const result = await restoreBackup({
    ...value,
    sourceId: "source",
    targetId: "target",
    adapter: control.adapter,
    now: () => now,
    resume: true,
  })
  assert.equal(result.state, "resumed")
  assert.equal(control.paused(), false)
  assert.deepEqual(control.calls, [
    "requested",
    "paused",
    "current-state-protected",
    "database-restored",
    "retention-complete",
    "snapshots-invalidated",
    "ready-for-resume",
    "resumed",
  ])
})
await test("default restore remains paused for operator review", async () => {
  const value = await exported()
  const control = recovery()
  const result = await restoreBackup({
    ...value,
    sourceId: "source",
    targetId: "target",
    adapter: control.adapter,
    now: () => now,
  })
  assert.equal(result.state, "paused-ready")
  assert.equal(control.paused(), true)
})
for (const step of [
  "probePause",
  "protectCurrent",
  "restoreSql",
  "cleanup",
  "invalidateSnapshots",
  "reconcile",
  "journal",
]) {
  await test(`a ${step} failure never resumes the service`, async () => {
    const value = await exported()
    const control = recovery()
    let called = false
    control.adapter[step] = async () => {
      throw new Error("simulated")
    }
    control.adapter.resume = async () => {
      called = true
    }
    await assert.rejects(
      restoreBackup({
        ...value,
        sourceId: "source",
        targetId: "target",
        adapter: control.adapter,
        now: () => now,
        resume: true,
      })
    )
    assert.equal(called, false)
  })
}
for (const domain of [
  "payments",
  "refunds",
  "admissions",
  "deliveries",
  "files",
]) {
  await test(`unresolved ${domain} prevents resume`, async () => {
    const value = await exported()
    const control = recovery()
    const base = control.adapter.reconcile
    control.adapter.reconcile = async () => ({
      ...(await base()),
      [domain]: { complete: true, unresolved: 1 },
    })
    await assert.rejects(
      restoreBackup({
        ...value,
        sourceId: "source",
        targetId: "target",
        adapter: control.adapter,
        now: () => now,
        resume: true,
      })
    )
    assert.equal(control.paused(), true)
  })
}
await test("restore checks integrity before pausing or touching target", async () => {
  const value = await exported()
  const control = recovery()
  await assert.rejects(
    restoreBackup({
      ...value,
      bytes: Buffer.from("broken"),
      sourceId: "source",
      targetId: "target",
      adapter: control.adapter,
      now: () => now,
    })
  )
  assert.deepEqual(control.calls, [])
})
await test("bucket public domains, absent expiry and overlapping short expiry fail closed", () => {
  const rule = {
    enabled: true,
    conditions: { prefix: "exports/" },
    deleteObjectsTransition: { condition: { type: "Age", maxAge: 2592000 } },
  }
  assert.deepEqual(
    verifyBucketConfiguration(
      { enabled: false },
      { domains: [] },
      { rules: [rule] }
    ),
    { private: true, expiresAfterSeconds: 2592000 }
  )
  assert.throws(() =>
    verifyBucketConfiguration(
      { enabled: true },
      { domains: [] },
      { rules: [rule] }
    )
  )
  assert.throws(() =>
    verifyBucketConfiguration(
      { enabled: false },
      { domains: [{ enabled: false }] },
      { rules: [rule] }
    )
  )
  assert.throws(() =>
    verifyBucketConfiguration(
      { enabled: false },
      { domains: [] },
      { rules: [] }
    )
  )
  assert.throws(() =>
    verifyBucketConfiguration(
      { enabled: false },
      { domains: [] },
      {
        rules: [
          rule,
          {
            ...rule,
            conditions: { prefix: "exports/source/" },
            deleteObjectsTransition: { condition: { type: "Age", maxAge: 1 } },
          },
        ],
      }
    )
  )
})
await test("remote targets require explicit IDs, a separate bucket and plan window", () => {
  const target = {
    accountId: "a".repeat(32),
    databaseId: "12345678-1234-1234-1234-123456789012",
    databaseName: "elc-preview",
    backupBucket: "elc-backups",
    filesBucket: "elc-files",
    timeTravelDays: 7,
  }
  assert.equal(validateTarget(target), target)
  assert.throws(() =>
    validateTarget({ ...target, backupBucket: target.filesBucket })
  )
  assert.throws(() => validateTarget({ ...target, timeTravelDays: undefined }))
  assert.throws(() => validateTarget({ ...target, databaseId: "default" }))
})

await test("a short whole-bucket lifecycle conflicts even without an explicit prefix", () => {
  assert.throws(() =>
    verifyBucketConfiguration(
      { enabled: false },
      { domains: [] },
      {
        rules: [
          {
            enabled: true,
            conditions: { prefix: "exports/" },
            deleteObjectsTransition: {
              condition: { type: "Age", maxAge: 2592000 },
            },
          },
          {
            enabled: true,
            conditions: {},
            deleteObjectsTransition: {
              condition: { type: "Age", maxAge: 604800 },
            },
          },
        ],
      }
    )
  )
})

await test("pre-restore export requires a completion receipt", async () => {
  const value = await exported(),
    control = recovery()
  control.adapter.protectCurrent = async () => undefined
  await assert.rejects(
    restoreBackup({
      ...value,
      sourceId: "source",
      targetId: "target",
      adapter: control.adapter,
      now: () => now,
      resume: true,
    })
  )
  assert.equal(control.paused(), true)
  assert.deepEqual(control.calls, ["requested", "paused"])
})
await test("missing source IDs and missing target names fail before any export", async () => {
  const value = fixture()
  await assert.rejects(createBackup({ adapter: value.adapter }))
  assert.deepEqual(value.calls, [])
  assert.throws(() =>
    validateTarget({
      accountId: "a".repeat(32),
      databaseId: "12345678-1234-1234-1234-123456789012",
      backupBucket: "elc-backup",
      filesBucket: "elc-files",
      timeTravelDays: 7,
    })
  )
})
