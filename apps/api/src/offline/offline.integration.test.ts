import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vite-plus/test"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import {
  syncOfflineScansSchema,
  verifyCompleteOfflineSnapshot,
  type OfflineSnapshotManifest,
  type OfflineSyncUnit,
} from "@elc/shared"
import { createAuthTestDatabase } from "../auth/test-database"
import { startCheckout } from "../orders/checkout"
import { loadOrderRows } from "../orders/read"
import { completeZeroTotalOrder } from "../tickets/issue"
import { readTicket } from "../tickets/read"
import { reverseCheckIn, scanOnline } from "../tickets/scan"
import {
  cancelFreeRegistration,
  voluntaryOrderGuards,
} from "../payments/voluntary"
import {
  getOfflineManifest,
  getOfflineSnapshotPage,
  issueOfflineSnapshot,
} from "./snapshots"
import {
  listOfflineDevices,
  registerOfflineDevice,
  revokeOfflineDevice,
} from "./devices"
import { syncOfflineScans } from "./sync"
import { listOfflineAdmissions, reviewOfflineAdmission } from "./review"
import { unresolvedOrderOfflineAdmissionSql } from "./guards"
import { createOfflineRoutes } from "./index"
import { setSuspension } from "../administration/service"
import { listOfflineEvents, readOfflineAccess } from "./access"

describe("offline snapshots, synchronization and review on D1", () => {
  let fixture: Awaited<ReturnType<typeof createAuthTestDatabase>>
  let db: D1Database
  let now: number
  let privateJwk: JsonWebKey
  let publicJwk: JsonWebKey
  const clock = () => now
  const env = () => ({
    DB: db,
    TICKET_ENCRYPTION_KEY: "A".repeat(43),
    OFFLINE_SIGNING_PRIVATE_JWK: JSON.stringify(privateJwk),
    OFFLINE_SIGNING_KEY_ID: "test-key",
  })
  const id = () => crypto.randomUUID()
  const scalar = (sql: string, ...bindings: unknown[]) =>
    db
      .prepare(sql)
      .bind(...bindings)
      .first<number>("n")
  beforeAll(async () => {
    const key = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    )
    privateJwk = await crypto.subtle.exportKey("jwk", key.privateKey)
    publicJwk = await crypto.subtle.exportKey("jwk", key.publicKey)
  })
  beforeEach(async () => {
    fixture = await createAuthTestDatabase()
    db = fixture.DB
    now = Date.now()
    await db.batch(
      [
        "owner",
        "buyer",
        "scanner",
        "scanner2",
        "lead",
        "reverse",
        "other",
        "admin",
      ].map((account) =>
        db
          .prepare(
            "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
          )
          .bind(account, account, `${account}@example.test`, now, now)
      )
    )
    await db
      .prepare(`INSERT INTO events (id, organizer_id, title, description, category, venue_name, venue_address, starts_at, ends_at, registration_opens_at, registration_closes_at, capacity, max_tickets_per_order, publication_state, calendar_uid, reporting_id, created_at, updated_at)
      VALUES ('event', 'owner', 'Offline demo', 'Description', 'Music', 'Hall', 'Address', ?, ?, ?, ?, 120, 120, 'published', 'offline-event', 'offline-report', ?, ?)`)
      .bind(
        now + 3600_000,
        now + 7200_000,
        now - 3600_000,
        now + 3600_000,
        now,
        now
      )
      .run()
    await db
      .prepare(
        "INSERT INTO ticket_types (id, event_id, name, kind, price_minor, quantity, sales_start_at, sales_end_at, updated_at) VALUES ('type', 'event', 'Free admission', 'free', 0, 120, ?, ?, ?)"
      )
      .bind(now - 3600_000, now + 3600_000, now)
      .run()
    await db
      .prepare(
        "INSERT INTO inventory (id, event_id, ticket_type_id) SELECT 'slot-' || value, 'event', 'type' FROM json_each(?)"
      )
      .bind(JSON.stringify(Array.from({ length: 120 }, (_, index) => index)))
      .run()
    await db.batch(
      [
        ["scanner", "ticket:scan"],
        ["scanner2", "ticket:scan"],
        ["lead", "checkin:review"],
        ["reverse", "checkin:reverse"],
      ].map(([account, permission]) =>
        db
          .prepare(
            "INSERT INTO event_permissions (user_id, event_id, permission, granted_at) VALUES (?, 'event', ?, ?)"
          )
          .bind(account, permission, now)
      )
    )
    await db
      .prepare(
        "INSERT INTO platform_grants (user_id, permission, granted_at) VALUES ('admin', 'platform:moderate', ?)"
      )
      .bind(now)
      .run()
  })
  afterEach(async () => {
    await fixture?.runtime.dispose()
  })
  async function issue(quantity = 1) {
    const checkout = await startCheckout(
      db,
      "buyer",
      {
        requestId: id(),
        eventId: "event",
        items: [
          {
            ticketTypeId: "type",
            quantity,
            attendeeNames: Array.from(
              { length: quantity },
              (_, index) => `Guest ${index}`
            ),
          },
        ],
      },
      { now: clock }
    )
    const complete = await completeZeroTotalOrder(
      env(),
      "buyer",
      checkout.order.id,
      { requestId: id(), expectedRevision: checkout.revision },
      { now: clock }
    )
    return { ticketId: complete.ticketIds[0]!, orderId: checkout.order.id }
  }
  async function snapshot(accountId = "scanner") {
    const device = await registerOfflineDevice(
      db,
      accountId,
      "event",
      { requestId: id(), label: "Test phone" },
      { now: clock }
    )
    const manifest = await issueOfflineSnapshot(
      env(),
      accountId,
      "event",
      { requestId: id(), deviceId: device.id },
      { now: clock }
    )
    return { device, manifest }
  }
  async function scanUnit(
    manifest: OfflineSnapshotManifest,
    ticketId: string,
    sequence = 1
  ): Promise<OfflineSyncUnit> {
    const tokenHash = await db
      .prepare("SELECT token_hash FROM tickets WHERE id = ?")
      .bind(ticketId)
      .first<string>("token_hash")
    return {
      scan: {
        kind: "scan",
        operationId: id(),
        snapshotId: manifest.snapshotId,
        snapshotVersion: 1,
        deviceTimestamp: new Date(now).toISOString(),
        deviceSequence: sequence,
        ticketId,
        tokenHash: tokenHash!,
      },
    }
  }
  const batch = (
    accountId: string,
    deviceId: string,
    units: OfflineSyncUnit[]
  ) => ({ requestId: id(), accountId, deviceId, units })
  const revokedStaff = () =>
    db
      .prepare(
        "UPDATE event_permissions SET revoked_at = ? WHERE user_id = 'scanner' AND event_id = 'event' AND permission = 'ticket:scan'"
      )
      .bind(now)
      .run()
  async function unresolved(orderId: string) {
    const guard = unresolvedOrderOfflineAdmissionSql(orderId)
    return db
      .prepare(`SELECT (${guard.predicate}) AS n`)
      .bind(...guard.bindings)
      .first<number>("n")
  }

  it.each([
    ["owner", true, true, true, true],
    ["lead", false, true, false, true],
    ["scanner", false, false, false, true],
    ["admin", true, false, false, false],
  ] as const)(
    "separates offline capabilities and discovery for %s",
    async (
      actor,
      manageDevices,
      reviewAdmissions,
      openIncident,
      discoverable
    ) => {
      expect(await readOfflineAccess(db, actor, "event")).toEqual({
        event: { id: "event", title: "Offline demo" },
        capabilities: { manageDevices, reviewAdmissions, openIncident },
      })
      expect((await listOfflineEvents(db, actor)).items).toHaveLength(
        discoverable ? 1 : 0
      )
    }
  )

  it.each(["buyer", "other", "reverse"])(
    "does not infer offline access from unrelated authority for %s",
    async (actor) => {
      await expect(readOfflineAccess(db, actor, "event")).rejects.toMatchObject(
        { status: 403 }
      )
      expect((await listOfflineEvents(db, actor)).items).toEqual([])
    }
  )

  it("paginates reviewer discovery without exposing other events or reusing another actor's cursor", async () => {
    await db
      .prepare(`INSERT INTO events (id,organizer_id,title,description,category,venue_name,venue_address,starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,calendar_uid,reporting_id,created_at,updated_at)
      SELECT 'event-2',organizer_id,'Second',description,category,venue_name,venue_address,starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,'calendar-2','report-2',created_at,updated_at FROM events WHERE id='event'`)
      .run()
    await db
      .prepare(
        "INSERT INTO event_permissions(event_id,user_id,permission,granted_at) VALUES('event-2','lead','checkin:review',?)"
      )
      .bind(now)
      .run()
    const first = await listOfflineEvents(db, "lead", { limit: 1 })
    expect(first.items.map((item) => item.event.id)).toEqual(["event"])
    expect(first.nextCursor).toBeTruthy()
    expect(
      (
        await listOfflineEvents(db, "lead", {
          limit: 1,
          cursor: first.nextCursor,
        })
      ).items.map((item) => item.event.id)
    ).toEqual(["event-2"])
    await expect(
      listOfflineEvents(db, "scanner", { cursor: first.nextCursor })
    ).rejects.toMatchObject({ status: 400 })
    expect(
      (await listOfflineEvents(db, "scanner")).items.map(
        (item) => item.event.id
      )
    ).toEqual(["event"])
  })

  it.each(["unverify", "suspend", "delete"])(
    "guards empty device/discovery lists after account %s",
    async (change) => {
      const beforeReturn = async () => {
        if (change === "unverify")
          await db
            .prepare("UPDATE user SET email_verified=0 WHERE id='other'")
            .run()
        else if (change === "delete")
          await db.prepare("DELETE FROM user WHERE id='other'").run()
        else
          await db
            .prepare(
              "INSERT INTO profiles(user_id,suspended_at,updated_at) VALUES('other',?,0)"
            )
            .bind(now)
            .run()
      }
      await expect(
        listOfflineDevices(db, "other", "event", {}, { beforeReturn })
      ).rejects.toMatchObject({ status: 403 })
      await expect(listOfflineEvents(db, "other")).rejects.toThrow()
    }
  )

  it.each(["owner", "admin"])(
    "guards device details after %s loses management access",
    async (actor) => {
      await snapshot()
      await expect(
        listOfflineDevices(
          db,
          actor,
          "event",
          {},
          {
            beforeReturn: async () => {
              if (actor === "owner")
                await db
                  .prepare(
                    "UPDATE events SET organizer_id='other' WHERE id='event'"
                  )
                  .run()
              else
                await db
                  .prepare("DELETE FROM platform_grants WHERE user_id='admin'")
                  .run()
            },
          }
        )
      ).rejects.toMatchObject({ status: 403 })
      expect((await listOfflineDevices(db, actor, "event")).items).toEqual([])
    }
  )

  it("returns current capability reductions after a permission changes", async () => {
    await expect(
      readOfflineAccess(db, "lead", "event", {
        beforeReturn: async () => {
          await db
            .prepare(
              "UPDATE event_permissions SET revoked_at=? WHERE user_id='lead'"
            )
            .bind(now)
            .run()
        },
      })
    ).rejects.toMatchObject({ status: 403 })
    expect((await listOfflineEvents(db, "lead")).items).toEqual([])
  })

  it("guards discovery after a current account is suspended at its final snapshot", async () => {
    await expect(
      listOfflineEvents(
        db,
        "lead",
        {},
        {
          beforeReturn: async () => {
            await db
              .prepare(
                "INSERT INTO profiles(user_id,suspended_at,updated_at) VALUES('lead',?,0)"
              )
              .bind(now)
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ status: 403 })
  })

  it.each([false, true])(
    "guards admission authority even for an empty page (%s)",
    async (empty) => {
      if (!empty) {
        const { ticketId } = await issue()
        const { device, manifest } = await snapshot()
        const unit = await scanUnit(manifest, ticketId)
        await syncOfflineScans(
          db,
          "scanner",
          "event",
          batch("scanner", device.id, [unit]),
          { now: clock }
        )
      }
      await expect(
        listOfflineAdmissions(
          db,
          "lead",
          "event",
          {},
          {
            beforeReturn: async () => {
              await db
                .prepare(
                  "UPDATE event_permissions SET revoked_at=? WHERE user_id='lead'"
                )
                .bind(now)
                .run()
            },
          }
        )
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        listOfflineAdmissions(db, "admin", "event")
      ).rejects.toMatchObject({ status: 403 })
    }
  )

  it.each(["account", "event"] as const)(
    "keeps pre-suspension scans reconcilable but rejects later captures after %s resumes",
    async (kind) => {
      const early = await issue()
      const late = await issue()
      const { device, manifest } = await snapshot()
      now += 1000
      const earlyUnit = await scanUnit(manifest, early.ticketId)
      now += 1000
      await setSuspension(
        db,
        "admin",
        kind,
        kind === "account" ? "scanner" : "event",
        {
          requestId: id(),
          expectedRevision: 0,
          suspended: true,
          reason: "Review offline access",
        },
        { now: clock }
      )
      const lateUnit = await scanUnit(manifest, late.ticketId, 2)
      now += 1000
      await setSuspension(
        db,
        "admin",
        kind,
        kind === "account" ? "scanner" : "event",
        {
          requestId: id(),
          expectedRevision: 1,
          suspended: false,
          reason: "Review complete",
        },
        { now: clock }
      )
      await expect(
        getOfflineManifest(
          env(),
          "scanner",
          "event",
          manifest.snapshotId,
          clock
        )
      ).rejects.toMatchObject({ code: "SNAPSHOT_EXPIRED" })
      await expect(
        getOfflineSnapshotPage(
          env(),
          "scanner",
          "event",
          manifest.snapshotId,
          0,
          clock
        )
      ).rejects.toMatchObject({ code: "SNAPSHOT_EXPIRED" })
      const response = await syncOfflineScans(
        db,
        "scanner",
        "event",
        batch("scanner", device.id, [earlyUnit, lateUnit]),
        { now: clock }
      )
      expect(response.results.map((row) => row.result)).toEqual([
        "checked_in",
        "snapshot_expired",
      ])
      expect(response.results[1]!.reviewState).toBe("unresolved")
      const fresh = await issueOfflineSnapshot(
        env(),
        "scanner",
        "event",
        { requestId: id(), deviceId: device.id },
        { now: clock }
      )
      expect(fresh.snapshotId).not.toBe(manifest.snapshotId)
    }
  )

  it("requires explicit scanning permission for registration and guards revocation at commit", async () => {
    await expect(
      registerOfflineDevice(
        db,
        "owner",
        "event",
        { requestId: id(), label: "Owner" },
        { now: clock }
      )
    ).rejects.toThrow()
    await expect(
      registerOfflineDevice(
        db,
        "scanner",
        "event",
        { requestId: id(), label: "Phone" },
        {
          now: clock,
          beforeCommit: async () => {
            await revokedStaff()
          },
        }
      )
    ).rejects.toThrow()
    expect(await scalar("SELECT count(*) AS n FROM offline_devices")).toBe(0)
  })

  it("deduplicates registration, scopes device lists and records lost-device revocation", async () => {
    const input = { requestId: id(), label: "Phone" }
    const [first, second] = await Promise.all(
      [1, 2].map(() =>
        registerOfflineDevice(db, "scanner", "event", input, { now: clock })
      )
    )
    expect(first.id).toBe(second.id)
    expect((await listOfflineDevices(db, "other", "event")).items).toHaveLength(
      0
    )
    expect((await listOfflineDevices(db, "owner", "event")).items).toHaveLength(
      1
    )
    await expect(
      revokeOfflineDevice(
        db,
        "scanner",
        "event",
        first.id,
        {
          requestId: id(),
          expectedRevision: 0,
          reason: "Lost phone",
          lost: true,
        },
        { now: clock }
      )
    ).rejects.toThrow()
    const revoked = await revokeOfflineDevice(
      db,
      "admin",
      "event",
      first.id,
      {
        requestId: id(),
        expectedRevision: 0,
        reason: "Lost phone",
        lost: true,
      },
      { now: clock }
    )
    expect(revoked.lossReported).toBe(true)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM outbox WHERE kind = 'offline.device_loss_incident'"
      )
    ).toBe(1)
    await expect(
      db
        .prepare("UPDATE offline_devices SET revoked_at = NULL WHERE id = ?")
        .bind(first.id)
        .run()
    ).rejects.toThrow()
  })

  it("signs complete frozen pages with public verification and no contact or raw credentials", async () => {
    const ticket = await issue(101)
    const { device, manifest } = await snapshot()
    expect(manifest.ticketCount).toBe(101)
    const pages = await Promise.all(
      [0, 1].map((page) =>
        getOfflineSnapshotPage(
          env(),
          "scanner",
          "event",
          manifest.snapshotId,
          page,
          clock
        )
      )
    )
    const expected = {
      accountId: "scanner",
      deviceId: device.id,
      eventId: "event",
      keyId: "test-key",
    }
    expect(
      await verifyCompleteOfflineSnapshot(
        manifest,
        pages.toReversed(),
        publicJwk,
        expected,
        now
      )
    ).toHaveLength(101)
    expect(
      await verifyCompleteOfflineSnapshot(
        manifest,
        pages.slice(0, 1),
        publicJwk,
        expected,
        now
      )
    ).toBeNull()
    expect(
      await verifyCompleteOfflineSnapshot(
        manifest,
        [pages[0], pages[0]],
        publicJwk,
        expected,
        now
      )
    ).toBeNull()
    expect(
      await verifyCompleteOfflineSnapshot(
        { ...manifest, accountId: "other" },
        pages,
        publicJwk,
        expected,
        now
      )
    ).toBeNull()
    const tampered = structuredClone(pages)
    tampered[0]!.tickets[0]!.attendeeName = "Changed"
    expect(
      await verifyCompleteOfflineSnapshot(
        manifest,
        tampered,
        publicJwk,
        expected,
        now
      )
    ).toBeNull()
    expect(
      await verifyCompleteOfflineSnapshot(
        manifest,
        pages,
        privateJwk,
        expected,
        now
      )
    ).toBeNull()
    const delivered = await readTicket(env(), "buyer", ticket.ticketId, true)
    expect(JSON.stringify({ manifest, pages })).not.toContain(
      delivered.credential!.token
    )
    expect(JSON.stringify(pages)).not.toMatch(
      /@example\.test|credentialCiphertext|credential_ciphertext/
    )
    await db
      .prepare("UPDATE tickets SET state = 'cancelled' WHERE id = ?")
      .bind(ticket.ticketId)
      .run()
    expect(
      await getOfflineSnapshotPage(
        env(),
        "scanner",
        "event",
        manifest.snapshotId,
        0,
        clock
      )
    ).toEqual(pages[0])
    await expect(
      db
        .prepare(
          "UPDATE offline_snapshot_tickets SET payload_json = '{}' WHERE snapshot_id = ?"
        )
        .bind(manifest.snapshotId)
        .run()
    ).rejects.toThrow()
  }, 20_000)

  it("caps snapshot expiry and denies cross-account, revoked and expired downloads", async () => {
    await db
      .prepare(
        "UPDATE events SET ends_at = ?, starts_at = ? WHERE id = 'event'"
      )
      .bind(now + 1800_000, now + 900_000)
      .run()
    const { manifest, device } = await snapshot()
    expect(Date.parse(manifest.expiresAt)).toBe(now + 1800_000 + 7200_000)
    await expect(
      getOfflineManifest(env(), "scanner2", "event", manifest.snapshotId, clock)
    ).rejects.toThrow()
    await revokeOfflineDevice(
      db,
      "owner",
      "event",
      device.id,
      { requestId: id(), expectedRevision: 0, reason: "Replace device" },
      { now: clock }
    )
    await expect(
      getOfflineManifest(env(), "scanner", "event", manifest.snapshotId, clock)
    ).rejects.toThrow()
    const fresh = await snapshot()
    now = Date.parse(fresh.manifest.expiresAt)
    await expect(
      getOfflineManifest(
        env(),
        "scanner",
        "event",
        fresh.manifest.snapshotId,
        clock
      )
    ).rejects.toThrow()
    expect(
      await verifyCompleteOfflineSnapshot(
        fresh.manifest,
        [],
        publicJwk,
        {
          accountId: "scanner",
          deviceId: fresh.device.id,
          eventId: "event",
          keyId: "test-key",
        },
        now
      )
    ).toBeNull()
  })

  it("fails snapshot issuance before storing data without a private signing key", async () => {
    const device = await registerOfflineDevice(
      db,
      "scanner",
      "event",
      { requestId: id(), label: "Phone" },
      { now: clock }
    )
    await expect(
      issueOfflineSnapshot(
        { DB: db },
        "scanner",
        "event",
        { requestId: id(), deviceId: device.id },
        { now: clock }
      )
    ).rejects.toThrow()
    expect(await scalar("SELECT count(*) AS n FROM offline_snapshots")).toBe(0)
  })

  it.each(["cancelled_at", "suspended_at"])(
    "denies a snapshot when event %s changes while signing",
    async (column) => {
      await issue()
      const device = await registerOfflineDevice(
        db,
        "scanner",
        "event",
        { requestId: id(), label: "Phone" },
        { now: clock }
      )
      let hooks = 0
      await expect(
        issueOfflineSnapshot(
          env(),
          "scanner",
          "event",
          { requestId: id(), deviceId: device.id },
          {
            now: clock,
            beforeCommit: async () => {
              if (++hooks === 2)
                await db
                  .prepare(`UPDATE events SET ${column} = ? WHERE id = 'event'`)
                  .bind(now)
                  .run()
            },
          }
        )
      ).rejects.toThrow()
      expect(
        await scalar(
          "SELECT count(*) AS n FROM offline_snapshots WHERE manifest_json IS NOT NULL"
        )
      ).toBe(0)
    }
  )

  it.each(["staff", "device", "expiry", "cancelled_at", "suspended_at"])(
    "denies page contents when %s invalidation wins after preliminary authorization",
    async (change) => {
      await issue()
      const { device, manifest } = await snapshot()
      expect(
        (
          await getOfflineSnapshotPage(
            env(),
            "scanner",
            "event",
            manifest.snapshotId,
            0,
            clock
          )
        ).tickets
      ).toHaveLength(1)
      await expect(
        getOfflineSnapshotPage(
          env(),
          "scanner",
          "event",
          manifest.snapshotId,
          0,
          clock,
          {
            beforeRead: async () => {
              if (change === "staff") await revokedStaff()
              else if (change === "device")
                await revokeOfflineDevice(
                  db,
                  "owner",
                  "event",
                  device.id,
                  {
                    requestId: id(),
                    expectedRevision: 0,
                    reason: "Device revoked",
                  },
                  { now: clock }
                )
              else if (change === "expiry") now = Date.parse(manifest.expiresAt)
              else
                await db
                  .prepare(`UPDATE events SET ${change} = ? WHERE id = 'event'`)
                  .bind(now)
                  .run()
            },
          }
        )
      ).rejects.toThrow()
      await expect(
        getOfflineManifest(
          env(),
          "scanner",
          "event",
          manifest.snapshotId,
          clock
        )
      ).rejects.toThrow()
    }
  )

  it("keeps the first server commit across disconnected devices and deduplicates replay", async () => {
    const { ticketId, orderId } = await issue()
    const one = await snapshot()
    const two = await snapshot("scanner2")
    now += 1000
    const inputs = [
      batch("scanner", one.device.id, [await scanUnit(one.manifest, ticketId)]),
      batch("scanner2", two.device.id, [
        await scanUnit(two.manifest, ticketId),
      ]),
    ]
    const results = await Promise.all(
      inputs.map((input) =>
        syncOfflineScans(db, input.accountId, "event", input, { now: clock })
      )
    )
    expect(
      results.map((response) => response.results[0]!.result).sort()
    ).toEqual(["already_used", "checked_in"])
    expect(
      await scalar(
        "SELECT count(*) AS n FROM checkins WHERE reversed_at IS NULL"
      )
    ).toBe(1)
    expect(await unresolved(orderId)).toBe(1)
    for (const [index, input] of inputs.entries())
      expect(
        await syncOfflineScans(db, input.accountId, "event", input, {
          now: clock,
        })
      ).toEqual(results[index])
    expect(await scalar("SELECT count(*) AS n FROM offline_operations")).toBe(2)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM outbox WHERE kind = 'checkin.created'"
      )
    ).toBe(1)
  })

  it("makes a sealed local undo pair incapable of admission under interruption and replay", async () => {
    const { ticketId } = await issue()
    const { device, manifest } = await snapshot()
    now += 1000
    const unit = await scanUnit(manifest, ticketId)
    unit.undo = {
      kind: "undo",
      operationId: id(),
      originalOperationId: unit.scan.operationId,
      snapshotId: manifest.snapshotId,
      snapshotVersion: 1,
      deviceSequence: 2,
      deviceTimestamp: new Date(now).toISOString(),
    }
    const input = batch("scanner", device.id, [unit])
    const result = await syncOfflineScans(db, "scanner", "event", input, {
      now: clock,
    })
    expect(result.results.map((row) => row.result)).toEqual([
      "locally_reversed",
      "locally_reversed",
    ])
    expect(
      await syncOfflineScans(
        db,
        "scanner",
        "event",
        { ...input, requestId: id() },
        { now: clock }
      )
    ).toMatchObject({ results: result.results })
    await expect(
      syncOfflineScans(
        db,
        "scanner",
        "event",
        batch("scanner", device.id, [{ scan: unit.scan }]),
        { now: clock }
      )
    ).rejects.toThrow()
    expect(await scalar("SELECT count(*) AS n FROM checkins")).toBe(0)
    expect(await scalar("SELECT count(*) AS n FROM offline_operations")).toBe(2)
    expect(
      await scalar("SELECT count(*) AS n FROM offline_admission_reports")
    ).toBe(0)
  })

  it("resumes a batch interrupted between units without replaying a completed unit", async () => {
    const { ticketId } = await issue()
    const { device, manifest } = await snapshot()
    now += 1000
    const first = await scanUnit(manifest, ticketId)
    const second = await scanUnit(manifest, ticketId, 2)
    const input = batch("scanner", device.id, [first, second])
    let hooks = 0
    await expect(
      syncOfflineScans(db, "scanner", "event", input, {
        now: clock,
        beforeCommit: async () => {
          if (++hooks === 2) throw new Error("Synthetic interruption")
        },
      })
    ).rejects.toThrow("Synthetic interruption")
    expect(await scalar("SELECT count(*) AS n FROM checkins")).toBe(1)
    expect(
      (
        await syncOfflineScans(db, "scanner", "event", input, { now: clock })
      ).results.map((row) => row.result)
    ).toEqual(["checked_in", "already_used"])
    expect(await scalar("SELECT count(*) AS n FROM checkins")).toBe(1)
  })

  it("does not treat a late undo as authority to reverse an already confirmed scan", async () => {
    const { ticketId } = await issue()
    const { device, manifest } = await snapshot()
    now += 1000
    const unit = await scanUnit(manifest, ticketId)
    await syncOfflineScans(
      db,
      "scanner",
      "event",
      batch("scanner", device.id, [unit]),
      { now: clock }
    )
    unit.undo = {
      kind: "undo",
      operationId: id(),
      originalOperationId: unit.scan.operationId,
      snapshotId: manifest.snapshotId,
      snapshotVersion: 1,
      deviceSequence: 2,
      deviceTimestamp: new Date(now).toISOString(),
    }
    await expect(
      syncOfflineScans(
        db,
        "scanner",
        "event",
        batch("scanner", device.id, [unit]),
        { now: clock }
      )
    ).rejects.toThrow("sealed operation")
    expect(
      await scalar(
        "SELECT count(*) AS n FROM checkins WHERE reversed_at IS NULL"
      )
    ).toBe(1)
    expect(await scalar("SELECT count(*) AS n FROM offline_operations")).toBe(1)
  })

  it.each(["staff", "device", "account", "event", "refund"])(
    "records %s invalidation that wins immediately before the admission commit",
    async (change) => {
      const { ticketId, orderId } = await issue()
      const { device, manifest } = await snapshot()
      now += 1000
      const input = batch("scanner", device.id, [
        await scanUnit(manifest, ticketId),
      ])
      const response = await syncOfflineScans(db, "scanner", "event", input, {
        now: clock,
        beforeCommit: async () => {
          if (change === "staff") await revokedStaff()
          if (change === "device")
            await revokeOfflineDevice(
              db,
              "owner",
              "event",
              device.id,
              {
                requestId: id(),
                expectedRevision: 0,
                reason: "Lost device",
                lost: true,
              },
              { now: clock }
            )
          if (change === "account")
            await db
              .prepare(
                "INSERT INTO profiles (user_id, suspended_at, updated_at) VALUES ('scanner', ?, ?)"
              )
              .bind(now, now)
              .run()
          if (change === "event")
            await db
              .prepare("UPDATE events SET cancelled_at = ? WHERE id = 'event'")
              .bind(now)
              .run()
          if (change === "refund")
            await db
              .prepare(
                "UPDATE orders SET admission_blocked_at = ? WHERE id = ?"
              )
              .bind(now, orderId)
              .run()
        },
      })
      expect(response.results[0]!.result).toBe(
        ["staff", "device", "account"].includes(change)
          ? "forbidden"
          : change === "event"
            ? "cancelled"
            : "admission_blocked"
      )
      expect(await scalar("SELECT count(*) AS n FROM checkins")).toBe(0)
      expect(await unresolved(orderId)).toBe(1)
      expect(await scalar("SELECT count(*) AS n FROM offline_operations")).toBe(
        1
      )
    }
  )

  it.each(["future", "before_issue", "expired_capture", "old_journal"])(
    "records %s timestamps without using client time to grant admission",
    async (change) => {
      const { ticketId } = await issue()
      const { device, manifest } = await snapshot()
      const unit = await scanUnit(manifest, ticketId)
      if (change === "future")
        unit.scan.deviceTimestamp = new Date(now + 1000).toISOString()
      if (change === "before_issue")
        unit.scan.deviceTimestamp = new Date(now - 1).toISOString()
      if (change === "expired_capture") {
        now = Date.parse(manifest.expiresAt) + 1
        unit.scan.deviceTimestamp = new Date(now).toISOString()
      }
      if (change === "old_journal") now += 7 * 86_400_000 + 1
      const response = await syncOfflineScans(
        db,
        "scanner",
        "event",
        batch("scanner", device.id, [unit]),
        { now: clock }
      )
      expect(response.results[0]!.result).toBe("snapshot_expired")
      expect(await scalar("SELECT count(*) AS n FROM checkins")).toBe(0)
    }
  )

  it("rejects clock rollback and cross-account journal synchronization", async () => {
    const { ticketId } = await issue()
    const { device, manifest } = await snapshot()
    now += 2000
    const first = await scanUnit(manifest, ticketId)
    await syncOfflineScans(
      db,
      "scanner",
      "event",
      batch("scanner", device.id, [first]),
      { now: clock }
    )
    const second = await scanUnit(manifest, ticketId, 2)
    second.scan.deviceTimestamp = new Date(now - 1000).toISOString()
    expect(
      (
        await syncOfflineScans(
          db,
          "scanner",
          "event",
          batch("scanner", device.id, [second]),
          { now: clock }
        )
      ).results[0]!.result
    ).toBe("snapshot_expired")
    await expect(
      syncOfflineScans(
        db,
        "scanner2",
        "event",
        batch("scanner2", device.id, [second]),
        { now: clock }
      )
    ).rejects.toThrow()
    await expect(
      syncOfflineScans(
        db,
        "scanner2",
        "event",
        batch("scanner", device.id, [second]),
        { now: clock }
      )
    ).rejects.toThrow()
  })

  it("blocks voluntary cancellation when a reported admission commits first", async () => {
    const { ticketId, orderId } = await issue()
    const { device, manifest } = await snapshot()
    now += 1000
    const input = batch("scanner", device.id, [
      await scanUnit(manifest, ticketId),
    ])
    const { order } = await loadOrderRows(db, "buyer", orderId)
    await expect(
      cancelFreeRegistration(
        db,
        "owner",
        orderId,
        {
          requestId: id(),
          expectedRevision: order.revision,
          reason: "Guest requested cancellation",
        },
        {
          now: clock,
          beforeCommit: async () => {
            await revokedStaff()
            await syncOfflineScans(db, "scanner", "event", input, {
              now: clock,
            })
          },
        }
      )
    ).rejects.toThrow()
    expect(await unresolved(orderId)).toBe(1)
    expect((await loadOrderRows(db, "buyer", orderId)).order.state).toBe(
      "completed"
    )
    expect(await scalar("SELECT count(*) AS n FROM checkins")).toBe(0)
  })

  it("records but cannot admit an upload when the voluntary refund guard and admission block commit first", async () => {
    const { ticketId, orderId } = await issue()
    const { device, manifest } = await snapshot()
    now += 1000
    const { order } = await loadOrderRows(db, "buyer", orderId)
    const response = await syncOfflineScans(
      db,
      "scanner",
      "event",
      batch("scanner", device.id, [await scanUnit(manifest, ticketId)]),
      {
        now: clock,
        beforeCommit: async () => {
          await db.batch([
            ...voluntaryOrderGuards(db, order, order.revision, now, true),
            db
              .prepare(
                "UPDATE orders SET admission_blocked_at = ?, revision = revision + 1 WHERE id = ?"
              )
              .bind(now, orderId),
          ])
        },
      }
    )
    expect(response.results[0]!.result).toBe("admission_blocked")
    expect(await unresolved(orderId)).toBe(1)
    expect(await scalar("SELECT count(*) AS n FROM checkins")).toBe(0)
  })

  it("allows owner or explicit reviewers to resolve a report, with a reason and no scanner escalation", async () => {
    const { ticketId, orderId } = await issue()
    const { device, manifest } = await snapshot()
    now += 1000
    const unit = await scanUnit(manifest, ticketId)
    await revokedStaff()
    await syncOfflineScans(
      db,
      "scanner",
      "event",
      batch("scanner", device.id, [unit]),
      { now: clock }
    )
    const input = {
      requestId: id(),
      expectedRevision: 0,
      resolution: "no_admission",
      reason: "Guest left without entering",
    }
    await expect(
      reviewOfflineAdmission(
        db,
        "scanner2",
        "event",
        unit.scan.operationId,
        input,
        { now: clock }
      )
    ).rejects.toThrow()
    await expect(
      reviewOfflineAdmission(
        db,
        "reverse",
        "event",
        unit.scan.operationId,
        input,
        { now: clock }
      )
    ).rejects.toThrow()
    await expect(
      listOfflineAdmissions(db, "scanner2", "event")
    ).rejects.toThrow()
    const reviewed = await reviewOfflineAdmission(
      db,
      "lead",
      "event",
      unit.scan.operationId,
      input,
      { now: clock }
    )
    expect(reviewed.reviewState).toBe("resolved")
    expect(
      await reviewOfflineAdmission(
        db,
        "lead",
        "event",
        unit.scan.operationId,
        input,
        { now: clock }
      )
    ).toEqual(reviewed)
    expect(await unresolved(orderId)).toBe(0)
    expect(
      await scalar("SELECT count(*) AS n FROM offline_admission_reviews")
    ).toBe(1)
    await expect(
      db
        .prepare(
          "UPDATE offline_operations SET result = 'checked_in' WHERE operation_id = ?"
        )
        .bind(unit.scan.operationId)
        .run()
    ).rejects.toThrow()
  })

  it("retains the first canonical check-in on review and requires separate reversal permission", async () => {
    const { ticketId } = await issue()
    const { device, manifest } = await snapshot()
    const ticket = await readTicket(env(), "buyer", ticketId, true)
    const online = await scanOnline(
      db,
      "scanner2",
      { eventId: "event", operationId: id(), credential: ticket.credential! },
      { now: clock }
    )
    now += 1000
    const unit = await scanUnit(manifest, ticketId)
    await syncOfflineScans(
      db,
      "scanner",
      "event",
      batch("scanner", device.id, [unit]),
      { now: clock }
    )
    await reviewOfflineAdmission(
      db,
      "lead",
      "event",
      unit.scan.operationId,
      {
        requestId: id(),
        expectedRevision: 0,
        resolution: "admission_confirmed",
        reason: "Same guest, first canonical record retained",
      },
      { now: clock }
    )
    expect(
      await scalar(
        "SELECT count(*) AS n FROM checkins WHERE reversed_at IS NULL"
      )
    ).toBe(1)
    expect(
      await db
        .prepare("SELECT id FROM checkins WHERE reversed_at IS NULL")
        .first("id")
    ).toBe(online.checkInId)
    await expect(
      reverseCheckIn(
        db,
        "lead",
        "event",
        online.checkInId!,
        { requestId: id(), reason: "Correction" },
        clock
      )
    ).rejects.toThrow()
    await expect(
      reverseCheckIn(
        db,
        "owner",
        "event",
        online.checkInId!,
        { requestId: id(), reason: "Correction" },
        clock
      )
    ).rejects.toThrow()
  })

  it("commits one authorized confirmation of a reported admission under concurrent review", async () => {
    const { ticketId, orderId } = await issue()
    const { device, manifest } = await snapshot()
    now += 1000
    const unit = await scanUnit(manifest, ticketId)
    await revokedStaff()
    await syncOfflineScans(
      db,
      "scanner",
      "event",
      batch("scanner", device.id, [unit]),
      { now: clock }
    )
    const results = await Promise.allSettled(
      ["owner", "lead"].map((actor) =>
        reviewOfflineAdmission(
          db,
          actor,
          "event",
          unit.scan.operationId,
          {
            requestId: id(),
            expectedRevision: 0,
            resolution: "admission_confirmed",
            reason: "Confirmed physical entry with the guest",
          },
          { now: clock }
        )
      )
    )
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM checkins WHERE reversed_at IS NULL"
      )
    ).toBe(1)
    expect(
      await scalar("SELECT count(*) AS n FROM offline_admission_reviews")
    ).toBe(1)
    expect(await unresolved(orderId)).toBe(0)
  })

  it("guards review against concurrent permission revocation and refund invalidation", async () => {
    const { ticketId, orderId } = await issue()
    const { device, manifest } = await snapshot()
    const unit = await scanUnit(manifest, ticketId)
    await revokedStaff()
    await syncOfflineScans(
      db,
      "scanner",
      "event",
      batch("scanner", device.id, [unit]),
      { now: clock }
    )
    await expect(
      reviewOfflineAdmission(
        db,
        "lead",
        "event",
        unit.scan.operationId,
        {
          requestId: id(),
          expectedRevision: 0,
          resolution: "no_admission",
          reason: "Guest left",
        },
        {
          now: clock,
          beforeCommit: async () => {
            await db
              .prepare(
                "UPDATE event_permissions SET revoked_at = ? WHERE user_id = 'lead'"
              )
              .bind(now)
              .run()
          },
        }
      )
    ).rejects.toThrow()
    await expect(
      reviewOfflineAdmission(
        db,
        "owner",
        "event",
        unit.scan.operationId,
        {
          requestId: id(),
          expectedRevision: 0,
          resolution: "admission_confirmed",
          reason: "Guest entered",
        },
        {
          now: clock,
          beforeCommit: async () => {
            await db
              .prepare(
                "UPDATE orders SET admission_blocked_at = ? WHERE id = ?"
              )
              .bind(now, orderId)
              .run()
          },
        }
      )
    ).rejects.toThrow()
    expect(await unresolved(orderId)).toBe(1)
    expect(await scalar("SELECT count(*) AS n FROM checkins")).toBe(0)
  })

  it("validates bounded sealed units and exposes authenticated Hono routes", async () => {
    const app = new Hono()
      .onError((error, c) =>
        c.json(
          { error: error.message },
          error instanceof HTTPException ? error.status : 500
        )
      )
      .route(
        "/api",
        createOfflineRoutes({ now: clock, identify: async () => "scanner" })
      )
    const response = await app.request(
      "/api/events/event/offline/devices",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: id(), label: "Phone" }),
      },
      env()
    )
    expect(response.status).toBe(201)
    const { ticketId } = await issue()
    const { device, manifest } = await snapshot()
    const unit = await scanUnit(manifest, ticketId)
    expect(
      syncOfflineScansSchema.safeParse(
        batch("scanner", device.id, Array(26).fill(unit))
      ).success
    ).toBe(false)
    expect(
      syncOfflineScansSchema.safeParse(
        batch("scanner", device.id, [unit, unit])
      ).success
    ).toBe(false)
    expect(
      syncOfflineScansSchema.safeParse(
        batch("scanner", device.id, [
          {
            ...unit,
            undo: {
              kind: "undo",
              operationId: id(),
              originalOperationId: "different",
              snapshotId: manifest.snapshotId,
              snapshotVersion: 1,
              deviceSequence: 2,
              deviceTimestamp: new Date(now).toISOString(),
            },
          },
        ])
      ).success
    ).toBe(false)
  })
})
