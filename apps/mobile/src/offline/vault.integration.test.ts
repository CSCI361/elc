import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { LocalDatabase } from "./database"
import { OfflineVault } from "./vault"
import { openTestCipher } from "./test-database"
import { createSnapshotVerifier } from "./verifier"
import { signingFixture, snapshotFixture } from "./test-fixture"

describe("account vault with actual encrypted files and protected-storage boundary", () => {
  let directory: string
  const values = new Map<string, string>()
  const opened: LocalDatabase[] = []
  let accountId: string
  let now: number
  let signing: Awaited<ReturnType<typeof signingFixture>>
  let proof: () => Promise<unknown>
  const user = (id: string) => ({
    user: {
      id,
      name: "Fixture",
      email: "fixture@example.com",
      emailVerified: true,
    },
    profile: { locale: "en", hasSavedLocale: false },
  })
  function vault(origin = "http://localhost:5173") {
    return new OfflineVault("local", origin, {
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
      account: () => proof(),
    })
  }
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "elc-vault-"))
    values.clear()
    accountId = "scanner"
    now = Date.now()
    signing = await signingFixture()
    proof = async () => user(accountId)
  })
  afterEach(async () => {
    for (const db of opened.splice(0)) await db.close()
    await rm(directory, { recursive: true, force: true })
  })
  async function prepare(instance: OfflineVault) {
    await instance.connect("scanner")
    const fixture = await snapshotFixture(signing, now)
    await instance.run("scanner", async (store) => {
      await store.deviceRegistration("event", "Phone")
      await store.saveDevice("event", {
        id: "device",
        accountId: "scanner",
        eventId: "event",
        label: "Phone",
        revision: 0,
        registeredAt: new Date(now).toISOString(),
        revokedAt: null,
        lastSyncAt: null,
        lossReported: false,
      })
      await store.installSnapshot(
        fixture.manifest,
        fixture.pages,
        fixture.event
      )
      await store.scan("event", fixture.tickets[0]!.tokenHash)
    })
  }
  it("restores the current offline account, then requires fresh same-account proof after sign-out", async () => {
    const first = vault()
    await prepare(first)
    const restarted = vault()
    expect(await restarted.restore()).toBe("scanner")
    expect(
      await restarted.run("scanner", (store) => store.events())
    ).toHaveLength(1)
    await restarted.signOut()
    const signedOut = vault()
    expect(await signedOut.restore()).toBeNull()
    await expect(
      signedOut.run("scanner", (store) => store.events())
    ).rejects.toThrow()
    accountId = "other"
    await expect(signedOut.connect("scanner")).rejects.toThrow()
    accountId = "scanner"
    await signedOut.connect("scanner")
    expect(
      (await signedOut.run("scanner", (store) => store.status("event")))
        .pendingCount
    ).toBe(1)
    expect(await signedOut.run("scanner", (store) => store.events())).toEqual(
      []
    )
  })
  it("locks the previous account on switching and never exposes its journal to the new account", async () => {
    const instance = vault()
    await prepare(instance)
    accountId = "other"
    await instance.connect("other")
    await expect(
      instance.run("scanner", (store) => store.pendingEventIds())
    ).rejects.toThrow()
    expect(
      await instance.run("other", (store) => store.pendingEventIds())
    ).toEqual([])
    accountId = "scanner"
    await instance.connect("scanner")
    expect(
      await instance.run("scanner", (store) => store.pendingEventIds())
    ).toEqual(["event"])
    expect(await instance.run("scanner", (store) => store.events())).toEqual([])
  })
  it("does not unlock after a delayed online proof races sign-out", async () => {
    const instance = vault()
    await prepare(instance)
    let release!: (value: unknown) => void
    let started!: () => void
    const reached = new Promise<void>((resolve) => {
      started = resolve
    })
    proof = () => {
      started()
      return new Promise((resolve) => {
        release = resolve
      })
    }
    const connecting = instance.connect("scanner")
    await reached
    const signingOut = instance.signOut()
    release(user("scanner"))
    await expect(connecting).rejects.toThrow()
    await signingOut
    expect(await vault().restore()).toBeNull()
  })
  it("fails closed if a protected key is missing and isolates API environments", async () => {
    const instance = vault()
    await prepare(instance)
    await instance.signOut()
    expect(await vault("http://localhost:9000").restore()).toBeNull()
    const keyName = [...values.keys()].find((key) => key.includes("-key-"))!
    values.delete(keyName)
    await expect(vault().connect("scanner")).rejects.toThrow()
    expect(values.has(keyName)).toBe(false)
  })
  it("cleans a signed-out journal after seven days without exposing or uploading it", async () => {
    const instance = vault()
    await prepare(instance)
    await instance.signOut()
    now += 7 * 24 * 3600_000
    const restarted = vault()
    await restarted.cleanup()
    await restarted.connect("scanner")
    expect(
      await restarted.run("scanner", (store) => store.pendingEventIds())
    ).toEqual([])
  })
})
