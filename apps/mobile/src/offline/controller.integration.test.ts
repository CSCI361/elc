import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ClockWatch, OfflineController } from "./controller"
import { OfflineVault } from "./vault"
import type { OfflineApi } from "./api"
import type { LocalDatabase } from "./database"
import type { PendingBatch } from "./model"
import { ServiceError } from "../transport"
import { openTestCipher } from "./test-database"
import { createSnapshotVerifier } from "./verifier"
import { signingFixture, snapshotFixture } from "./test-fixture"

describe("native snapshot and upload controller with SQLCipher", () => {
  let directory: string
  let now: number
  let elapsed: number
  let fixture: Awaited<ReturnType<typeof snapshotFixture>>
  let signing: Awaited<ReturnType<typeof signingFixture>>
  let api: OfflineApi
  let vault: OfflineVault
  let controller: OfflineController
  const opened: LocalDatabase[] = []
  const values = new Map<string, string>()
  const registrations: string[] = []
  const sent: PendingBatch[] = []
  const account = () =>
    Promise.resolve({
      user: {
        id: "scanner",
        name: "Fixture",
        email: "fixture@example.com",
        emailVerified: true,
      },
      profile: { locale: "en", hasSavedLocale: false },
    })
  const ack = (batch: PendingBatch, result = "checked_in") => ({
    requestId: batch.requestId,
    eventId: "event",
    deviceId: "device",
    acknowledgedAt: new Date(now + elapsed).toISOString(),
    results: batch.units.flatMap((unit) =>
      (unit.undo ? [unit.scan, unit.undo] : [unit.scan]).map((operation) => ({
        operationId: operation.operationId,
        result: unit.undo ? "locally_reversed" : result,
        serverTimestamp: new Date(now + elapsed).toISOString(),
        checkInId:
          !unit.undo && result === "checked_in"
            ? `checkin-${operation.operationId}`
            : null,
        conflict: result !== "checked_in",
        reviewState: result === "checked_in" ? "none" : "unresolved",
      }))
    ),
  })
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "elc-controller-"))
    now = Date.now()
    elapsed = 0
    registrations.length = 0
    sent.length = 0
    values.clear()
    signing = await signingFixture()
    fixture = await snapshotFixture(signing, now)
    api = {
      account,
      event: async () => fixture.event,
      register: async (_, requestId) => {
        registrations.push(requestId)
        return {
          id: "device",
          accountId: "scanner",
          eventId: "event",
          label: "Phone",
          revision: 0,
          registeredAt: new Date(now).toISOString(),
          revokedAt: null,
          lastSyncAt: null,
          lossReported: false,
        }
      },
      snapshot: async () => fixture.manifest,
      page: async (_, __, page) => fixture.pages[page],
      sync: async (_, batch) => {
        sent.push(structuredClone(batch))
        return ack(batch)
      },
    }
    vault = new OfflineVault("local", "http://localhost:5173", {
      storage: {
        get: async (key) => values.get(key) ?? null,
        set: async (key, value) => {
          values.set(key, value)
        },
        remove: async (key) => {
          values.delete(key)
        },
      },
      open: async (filename, key) => {
        const { db } = await openTestCipher(join(directory, filename), key)
        opened.push(db)
        return db
      },
      randomKey: async () => "ab".repeat(32),
      now: () => now,
      id: () => crypto.randomUUID(),
      verify: createSnapshotVerifier(signing.pin),
      account,
    })
    controller = new OfflineController(
      vault,
      api,
      () => crypto.randomUUID(),
      () => elapsed
    )
    await vault.connect("scanner")
  })
  afterEach(async () => {
    for (const db of opened.splice(0)) await db.close()
    await rm(directory, { recursive: true, force: true })
  })
  const qr = (index = 0) =>
    JSON.stringify({
      kind: "elc_admission",
      version: 1,
      token: fixture.tokens[index],
    })

  it("installs only complete snapshots, reuses device registration, and preserves pending scans on refresh", async () => {
    await controller.refresh("scanner", "event", "Phone")
    expect((await controller.scan("scanner", "event", qr())).result).toBe(
      "provisional"
    )
    now += 60_000
    fixture = await snapshotFixture(signing, now)
    await controller.refresh("scanner", "event", "Phone")
    expect(new Set(registrations).size).toBe(1)
    expect((await controller.status("scanner", "event")).pendingCount).toBe(1)
    expect((await controller.scan("scanner", "event", qr())).result).toBe(
      "already_used"
    )
    fixture = await snapshotFixture(signing, now, 101)
    api.page = async (_, __, page) => (page === 1 ? null : fixture.pages[page])
    await expect(
      controller.refresh("scanner", "event", "Phone")
    ).rejects.toThrow()
    expect(
      (await controller.status("scanner", "event")).snapshot?.ticketCount
    ).toBe(2)
  })
  it("includes request latency in the signed time anchor without extending expiry", async () => {
    api.snapshot = async () => {
      elapsed += 9000
      return fixture.manifest
    }
    api.page = async (_, __, page) => {
      elapsed += 1000
      return fixture.pages[page]
    }
    await controller.refresh("scanner", "event", "Phone")
    await controller.scan("scanner", "event", qr())
    await controller.sync("scanner")
    expect(Date.parse(sent[0]!.units[0]!.scan.deviceTimestamp)).toBe(
      now + 10_000
    )
  })
  it("replays exact sealed bodies after a lost response and never adds a late undo", async () => {
    await controller.refresh("scanner", "event", "Phone")
    const local = await controller.scan("scanner", "event", qr())
    let calls = 0
    api.sync = async (_, batch) => {
      sent.push(structuredClone(batch))
      if (++calls === 1) throw new ServiceError(null)
      return ack(batch)
    }
    await expect(controller.sync("scanner")).rejects.toThrow()
    await expect(
      controller.undo("scanner", "event", local.operationId)
    ).rejects.toThrow()
    expect((await controller.status("scanner", "event")).pendingCount).toBe(1)
    await controller.sync("scanner")
    expect(sent[1]).toEqual(sent[0])
    expect((await controller.status("scanner", "event")).pendingCount).toBe(0)
  })
  it("records server denial after assignment revocation and uploads despite having no current event assignment", async () => {
    await controller.refresh("scanner", "event", "Phone")
    await controller.scan("scanner", "event", qr())
    api.event = async () => {
      throw new ServiceError(403)
    }
    api.sync = async (_, batch) => {
      sent.push(batch)
      return ack(batch, "forbidden")
    }
    await controller.sync("scanner")
    const status = await controller.status("scanner", "event")
    expect(status.pendingCount).toBe(0)
    expect(status.conflictCount).toBe(1)
    expect(status.snapshot).toBeNull()
  })
  it("invalidates cached snapshots after known cancellation or page authorization loss, but preserves the journal", async () => {
    await controller.refresh("scanner", "event", "Phone")
    await controller.scan("scanner", "event", qr())
    api.event = async () => ({
      ...fixture.event,
      cancelledAt: new Date(now).toISOString(),
    })
    await expect(
      controller.refresh("scanner", "event", "Phone")
    ).rejects.toThrow()
    expect((await controller.status("scanner", "event")).snapshot).toBeNull()
    expect((await controller.status("scanner", "event")).pendingCount).toBe(1)
    api.event = async () => fixture.event
    await controller.refresh("scanner", "event", "Phone")
    api.page = async () => {
      throw new ServiceError(403)
    }
    await expect(
      controller.refresh("scanner", "event", "Phone")
    ).rejects.toThrow()
    expect((await controller.status("scanner", "event")).snapshot).toBeNull()
  })
  it("locks data after a verified online account mismatch and does not send the previous account's scans", async () => {
    await controller.refresh("scanner", "event", "Phone")
    await controller.scan("scanner", "event", qr())
    api.account = async () => {
      const result = await account()
      result.user.id = "other"
      return result
    }
    await expect(controller.sync("scanner")).rejects.toThrow()
    expect(sent).toHaveLength(0)
    await expect(controller.status("scanner", "event")).rejects.toThrow()
    expect(await vault.restore()).toBeNull()
  })
  it("detects rollback relative to elapsed monotonic time even if wall time exceeds the last sample", () => {
    const watch = new ClockWatch()
    expect(watch.sample(1000, 1000)).toBe(false)
    expect(watch.sample(2000, 2000)).toBe(false)
    expect(watch.sample(3000, 60_000)).toBe(true)
    watch.reset()
    expect(watch.sample(3000, 60_000)).toBe(false)
  })
})
