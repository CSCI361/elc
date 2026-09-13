import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vite-plus/test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { LocalDatabase } from "./database"
import { OfflineStore } from "./store"
import { createSnapshotVerifier } from "./verifier"
import { openTestCipher } from "./test-database"
import { signingFixture, snapshotFixture } from "./test-fixture"
import type { PendingBatch } from "./model"

describe("encrypted native journal core on actual SQLCipher", () => {
  let signing: Awaited<ReturnType<typeof signingFixture>>
  let directory: string
  let filename: string
  let now: number
  let db: LocalDatabase
  let store: OfflineStore
  let snapshot: Awaited<ReturnType<typeof snapshotFixture>>
  const opened: LocalDatabase[] = []
  beforeAll(async () => {
    signing = await signingFixture()
  })
  async function open() {
    const connection = await openTestCipher(filename)
    expect(connection.version).toMatch(/^4\./)
    db = connection.db
    opened.push(db)
    store = new OfflineStore(db, "scanner", "local", {
      now: () => now,
      id: () => crypto.randomUUID(),
      verify: createSnapshotVerifier(signing.pin),
    })
    await store.initialize()
  }
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "elc-offline-cipher-"))
    filename = join(directory, "cache.db")
    now = Date.now()
    await open()
    await store.unlockAfterOnlineProof("scanner")
    await store.deviceRegistration("event", "Fixture phone")
    await store.saveDevice("event", {
      id: "device",
      accountId: "scanner",
      eventId: "event",
      label: "Fixture phone",
      revision: 0,
      registeredAt: new Date(now).toISOString(),
      revokedAt: null,
      lastSyncAt: null,
      lossReported: false,
    })
    snapshot = await snapshotFixture(signing, now)
    await store.installSnapshot(
      snapshot.manifest,
      snapshot.pages,
      snapshot.event
    )
  })
  afterEach(async () => {
    for (const connection of opened.splice(0)) await connection.close()
    await rm(directory, { recursive: true, force: true })
  })
  const count = (table: string) =>
    db.read(
      async (sql) =>
        (await sql.first<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))!
          .n
    )
  const response = (batch: PendingBatch, at = now) => ({
    requestId: batch.requestId,
    eventId: "event",
    deviceId: batch.deviceId,
    acknowledgedAt: new Date(at).toISOString(),
    results: batch.units.flatMap((unit) =>
      (unit.undo ? [unit.scan, unit.undo] : [unit.scan]).map((operation) => ({
        operationId: operation.operationId,
        result: unit.undo ? "locally_reversed" : "checked_in",
        serverTimestamp: new Date(at).toISOString(),
        checkInId: unit.undo ? null : `checkin-${operation.operationId}`,
        conflict: false,
        reviewState: "none",
      }))
    ),
  })

  it("stores encrypted bytes, rejects the wrong key, and reopens the original data with its key", async () => {
    await store.scan("event", snapshot.tickets[0]!.tokenHash)
    await store.close()
    const bytes = await readFile(filename)
    expect(bytes.subarray(0, 16).toString()).not.toBe("SQLite format 3\u0000")
    expect(bytes.toString()).not.toContain("Fixture guest")
    expect(bytes.toString()).not.toContain(snapshot.tokens[0])
    await expect(openTestCipher(filename, "cd".repeat(32))).rejects.toThrow()
    await open()
    expect((await store.status("event")).pendingCount).toBe(1)
    expect(
      (await store.scan("event", snapshot.tickets[0]!.tokenHash)).result
    ).toBe("already_used")
  })

  it("admits only once across two concurrent connections and records both attempts", async () => {
    const connection = await openTestCipher(filename)
    opened.push(connection.db)
    const second = new OfflineStore(connection.db, "scanner", "local", {
      now: () => now,
      id: () => crypto.randomUUID(),
      verify: createSnapshotVerifier(signing.pin),
    })
    await second.initialize()
    const outcomes = await Promise.all([
      store.scan("event", snapshot.tickets[0]!.tokenHash),
      second.scan("event", snapshot.tickets[0]!.tokenHash),
    ])
    expect(outcomes.map((result) => result.result).sort()).toEqual([
      "already_used",
      "provisional",
    ])
    expect(await count("units")).toBe(1)
    expect(await count("attempts")).toBe(2)
    const persisted = await db.read((sql) =>
      sql.all("SELECT scan_json FROM units")
    )
    expect(JSON.stringify(persisted)).not.toContain(snapshot.tokens[0])
  })

  it("rejects campaign/unknown/known-invalid scans without creating admission units", async () => {
    expect((await store.scan("event", null)).result).toBe("invalid_qr")
    expect((await store.scan("event", "f".repeat(64))).result).toBe(
      "unknown_ticket"
    )
    for (const ticketState of [
      "cancelled",
      "refunded",
      "checked_in",
    ] as const) {
      const changed = await snapshotFixture(signing, now, 1, { ticketState })
      await store.installSnapshot(
        changed.manifest,
        changed.pages,
        changed.event
      )
      expect(
        (await store.scan("event", changed.tickets[0]!.tokenHash)).result
      ).toBe(ticketState === "checked_in" ? "already_used" : ticketState)
    }
    expect(await count("units")).toBe(0)
  })

  it("preserves pending admissions on refresh and clears only an acknowledged admission after a fresh server correction", async () => {
    const scan = await store.scan("event", snapshot.tickets[0]!.tokenHash)
    now += 1000
    const fresh = await snapshotFixture(signing, now)
    await store.installSnapshot(fresh.manifest, fresh.pages, fresh.event)
    expect(
      (await store.scan("event", snapshot.tickets[0]!.tokenHash)).result
    ).toBe("already_used")
    const batch = (await store.sealBatch("event"))!
    expect(batch.units[0]!.scan.operationId).toBe(scan.operationId)
    await store.acknowledge("event", response(batch))
    now += 1000
    const corrected = await snapshotFixture(signing, now)
    await store.installSnapshot(
      corrected.manifest,
      corrected.pages,
      corrected.event
    )
    expect(
      (await store.scan("event", snapshot.tickets[0]!.tokenHash)).result
    ).toBe("provisional")
  })

  it("seals scan and local undo together and denies late undo after upload could have begun", async () => {
    const scan = await store.scan("event", snapshot.tickets[0]!.tokenHash)
    now += 1000
    const undo = await store.undo("event", scan.operationId)
    const batch = (await store.sealBatch("event"))!
    expect(batch.units[0]!.undo).toEqual(undo)
    await expect(store.undo("event", scan.operationId)).rejects.toMatchObject({
      code: "already_sealed",
    })
    expect(
      (await store.scan("event", snapshot.tickets[0]!.tokenHash)).result
    ).toBe("provisional")
    const bad = response(batch)
    bad.results[0]!.result = "checked_in"
    bad.results[0]!.checkInId = "unwanted-admission"
    await expect(store.acknowledge("event", bad)).rejects.toMatchObject({
      code: "invalid_response",
    })
    await store.acknowledge("event", response(batch))
    expect((await store.status("event")).pendingCount).toBe(1)
  })

  it("reopens an interrupted sealed batch with the exact request and operation IDs", async () => {
    await store.scan("event", snapshot.tickets[0]!.tokenHash)
    const batch = await store.sealBatch("event")
    await store.close()
    await open()
    expect(await store.sealBatch("event")).toEqual(batch)
    const partial = response(batch!)
    partial.results = []
    await expect(store.acknowledge("event", partial)).rejects.toThrow()
    expect(await store.sealBatch("event")).toEqual(batch)
    await store.acknowledge("event", response(batch!))
    await store.acknowledge("event", response(batch!))
    expect((await store.status("event")).pendingCount).toBe(0)
  })

  it("caps each batch at25 units while preserving monotonic device sequences", async () => {
    const many = await snapshotFixture(signing, now, 26)
    await store.installSnapshot(many.manifest, many.pages, many.event)
    for (const ticket of many.tickets)
      await store.scan("event", ticket.tokenHash)
    const first = (await store.sealBatch("event"))!
    expect(first.units).toHaveLength(25)
    expect(first.units.map((unit) => unit.scan.deviceSequence)).toEqual(
      Array.from({ length: 25 }, (_, index) => index + 1)
    )
    await store.acknowledge("event", response(first))
    const next = (await store.sealBatch("event"))!
    expect(next.units).toHaveLength(1)
    expect(next.units[0]!.scan.deviceSequence).toBe(26)
  })

  it("removes snapshots on sign-out and locks pending data until the same account has online proof", async () => {
    await store.scan("event", snapshot.tickets[0]!.tokenHash)
    await store.lock()
    expect(await count("snapshots")).toBe(0)
    expect(await count("units")).toBe(1)
    await expect(store.status("event")).rejects.toMatchObject({
      code: "locked",
    })
    await expect(store.unlockAfterOnlineProof("other")).rejects.toMatchObject({
      code: "wrong_account",
    })
    await store.close()
    await open()
    await expect(store.sealBatch("event")).rejects.toMatchObject({
      code: "locked",
    })
    await store.unlockAfterOnlineProof("scanner")
    expect((await store.status("event")).pendingCount).toBe(1)
    expect((await store.status("event")).snapshot).toBeNull()
  })

  it("persists rollback detection across restarts and clears it only with a fresh authenticated snapshot", async () => {
    now += 5000
    await store.scan("event", snapshot.tickets[0]!.tokenHash)
    now -= 10_000
    expect(
      (await store.scan("event", snapshot.tickets[1]!.tokenHash)).result
    ).toBe("clock_unsafe")
    await store.close()
    now += 20_000
    await open()
    await store.unlockAfterOnlineProof("scanner")
    expect((await store.status("event")).clockUnsafe).toBe(true)
    const fresh = await snapshotFixture(signing, now)
    await store.installSnapshot(fresh.manifest, fresh.pages, fresh.event)
    expect((await store.status("event")).clockUnsafe).toBe(false)
    expect(
      (await store.scan("event", snapshot.tickets[1]!.tokenHash)).result
    ).toBe("provisional")
  })

  it("accepts a server acknowledgement after client time advanced beyond it", async () => {
    const serverAt = now + 1000
    await store.scan("event", snapshot.tickets[0]!.tokenHash)
    now += 60 * 60_000
    const batch = (await store.sealBatch("event"))!
    const rejected = response(batch, serverAt)
    rejected.results[0]!.result = "snapshot_expired"
    rejected.results[0]!.checkInId = null
    rejected.results[0]!.conflict = true
    await store.acknowledge("event", rejected)
    expect((await store.status("event")).pendingCount).toBe(0)
  })

  it("purges expired snapshots on restart and acknowledged operation metadata after24h", async () => {
    const scan = await store.scan("event", snapshot.tickets[0]!.tokenHash)
    const batch = (await store.sealBatch("event"))!
    await store.acknowledge("event", response(batch))
    await store.close()
    now += 24 * 60 * 60_000 + 1
    await open()
    await store.cleanup()
    expect(await count("snapshots")).toBe(0)
    expect(await count("snapshot_tickets")).toBe(0)
    expect(await count("units")).toBe(0)
    expect(await count("batches")).toBe(0)
    expect(
      await db.read((sql) =>
        sql.first("SELECT 1 FROM attempts WHERE operation_id = ?", [
          scan.operationId,
        ])
      )
    ).toBeNull()
  })

  it("warns at24h and deletes unsynchronized records at their seven-day deadline", async () => {
    await store.scan("event", snapshot.tickets[0]!.tokenHash)
    const capturedAt = now
    now += 24 * 60 * 60_000
    const status = await store.status("event")
    expect(status.warning).toBe(true)
    expect(status.deletionDeadline).toBe(capturedAt + 7 * 24 * 60 * 60_000)
    now = status.deletionDeadline!
    await store.cleanup()
    expect(await count("units")).toBe(0)
    expect(await count("attempts")).toBe(0)
  })

  it("removes expired sealed payloads without changing or undoing surviving sealed units", async () => {
    await store.scan("event", snapshot.tickets[0]!.tokenHash)
    const firstAt = now
    now += 60_000
    const second = await store.scan("event", snapshot.tickets[1]!.tokenHash)
    const original = (await store.sealBatch("event"))!
    now = firstAt + 7 * 24 * 60 * 60_000
    await store.cleanup()
    const surviving = (await store.sealBatch("event"))!
    expect(surviving.requestId).not.toBe(original.requestId)
    expect(surviving.units).toHaveLength(1)
    expect(surviving.units[0]).toEqual(original.units[1])
    await expect(store.undo("event", second.operationId)).rejects.toMatchObject(
      { code: "already_sealed" }
    )
    const payloads = await db.read((sql) =>
      sql.all<{ payload_json: string }>("SELECT payload_json FROM batches")
    )
    expect(JSON.stringify(payloads)).not.toContain(
      original.units[0]!.scan.operationId
    )
  })
  it("persists online uncertainty and confirmation as a same-device offline admission barrier", async () => {
    const hash = snapshot.tickets[0]!.tokenHash
    const operationId = crypto.randomUUID()
    expect(await store.beginOnline("event", hash, operationId)).toEqual({
      operationId,
      locallyBlocked: false,
    })
    expect((await store.scan("event", hash)).result).toBe("already_used")
    await store.close()
    await open()
    expect(await store.beginOnline("event", hash, crypto.randomUUID())).toEqual(
      { operationId, locallyBlocked: false }
    )
    expect((await store.status("event")).uncertainOnlineCount).toBe(1)
    await store.finishOnline("event", operationId, "checked_in")
    expect((await store.scan("event", hash)).result).toBe("already_used")
    expect((await store.status("event")).uncertainOnlineCount).toBe(0)
    now += 60_000
    const corrected = await snapshotFixture(signing, now)
    await store.installSnapshot(
      corrected.manifest,
      corrected.pages,
      corrected.event
    )
    expect((await store.scan("event", hash)).result).toBe("provisional")
  })

  it("blocks an online scan while a local admission awaits sync, then permits it after a paired undo", async () => {
    const hash = snapshot.tickets[0]!.tokenHash
    const scan = await store.scan("event", hash)
    const operationId = crypto.randomUUID()
    expect(await store.beginOnline("event", hash, operationId)).toEqual({
      operationId,
      locallyBlocked: true,
    })
    await store.undo("event", scan.operationId)
    expect(await store.beginOnline("event", hash, operationId)).toEqual({
      operationId,
      locallyBlocked: false,
    })
    const batch = await store.sealBatch("event")
    expect(batch!.units[0]!.undo?.originalOperationId).toBe(scan.operationId)
  })

  it("uses known online refund and authorization outcomes to deny stale offline admission", async () => {
    const hash = snapshot.tickets[0]!.tokenHash
    const operationId = crypto.randomUUID()
    await store.beginOnline("event", hash, operationId)
    await store.finishOnline("event", operationId, "refunded")
    expect((await store.scan("event", hash)).result).toBe("admission_blocked")
    await store.finishOnline("event", operationId, "forbidden")
    expect((await store.status("event")).snapshot).toBeNull()
  })

  it("uses the signed time anchor for eligibility when the wall clock is ahead", async () => {
    now += 24 * 3600_000
    await store.installSnapshot(
      snapshot.manifest,
      snapshot.pages,
      snapshot.event
    )
    expect(now).toBeGreaterThan(Date.parse(snapshot.event.endsAt))
    expect((await store.status("event")).admissionAvailable).toBe(true)
    expect(
      (await store.scan("event", snapshot.tickets[0]!.tokenHash)).result
    ).toBe("provisional")
  })

  it("expires online acknowledgement metadata after 24 hours and uncertain barriers after seven days", async () => {
    const first = crypto.randomUUID()
    const second = crypto.randomUUID()
    await store.beginOnline("event", snapshot.tickets[0]!.tokenHash, first)
    await store.finishOnline("event", first, "checked_in")
    await store.beginOnline("event", snapshot.tickets[1]!.tokenHash, second)
    now += 24 * 3600_000
    await store.cleanup()
    expect(await count("online_barriers")).toBe(1)
    now += 6 * 24 * 3600_000
    await store.cleanup()
    expect(await count("online_barriers")).toBe(0)
  })
})
