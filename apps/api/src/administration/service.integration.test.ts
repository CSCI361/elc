import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { createAuthTestDatabase } from "../auth/test-database"
import { listAdministration, setSuspension } from "./service"
import { requireActiveAccount } from "../auth/permissions"
import { readActivation } from "../activation/store"

describe("platform administration transitions", () => {
  let f: Awaited<ReturnType<typeof createAuthTestDatabase>>
  const now = Date.parse("2026-09-13T10:00:00Z")
  beforeEach(async () => {
    f = await createAuthTestDatabase()
    for (const id of ["admin", "owner", "other"])
      await f.DB.prepare(
        "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)"
      )
        .bind(id, id, `${id}@example.test`, now, now)
        .run()
    await f.DB.prepare(
      "INSERT INTO platform_grants(user_id,permission,granted_at) VALUES('admin','platform:moderate',?)"
    )
      .bind(now)
      .run()
    await f.DB.prepare(`INSERT INTO events(id,organizer_id,title,description,category,venue_name,venue_address,starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,publication_state,calendar_uid,reporting_id,created_at,updated_at)
   VALUES('event','owner','Private event','Description','Music','Hall','Address',?,?,?,?,10,'published','calendar','rpt_event0001',?,?)`)
      .bind(
        now + 3600000,
        now + 7200000,
        now - 3600000,
        now + 3600000,
        now,
        now
      )
      .run()
  })
  afterEach(async () => {
    await f?.runtime.dispose()
  })
  const change = (
    kind: "account" | "event" = "account",
    input: Record<string, unknown> = {},
    beforeCommit?: () => Promise<void>
  ) =>
    setSuspension(
      f.DB,
      "admin",
      kind,
      kind === "account" ? "owner" : "event",
      {
        requestId: "request",
        expectedRevision: 0,
        suspended: true,
        reason: "Synthetic moderation",
        ...input,
      },
      { now: () => now, beforeCommit }
    )
  it("lists operational account/event DTOs without sessions or activation identity details", async () => {
    expect(
      (await listAdministration(f.DB, "admin", "accounts")).items
    ).toHaveLength(3)
    const event = (await listAdministration(f.DB, "admin", "events")).items[0]
    expect(event).toMatchObject({
      id: "event",
      organizerId: "owner",
      title: "Private event",
      revision: 0,
    })
    expect(Object.keys(event!)).toEqual([
      "id",
      "title",
      "organizerId",
      "visibility",
      "publicationState",
      "startsAt",
      "suspendedAt",
      "revision",
    ])
  })
  it("requires current moderation authority for every search", async () => {
    await expect(
      listAdministration(f.DB, "other", "events")
    ).rejects.toMatchObject({ status: 403 })
    await f.DB.prepare(
      "INSERT INTO platform_grants(user_id,permission,granted_at) VALUES('other','platform:recover',?)"
    )
      .bind(now)
      .run()
    await expect(
      listAdministration(f.DB, "other", "accounts")
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      listAdministration(
        f.DB,
        "admin",
        "accounts",
        {},
        {
          beforeRead: async () => {
            await f.DB.prepare(
              "DELETE FROM platform_grants WHERE user_id='admin'"
            ).run()
          },
        }
      )
    ).rejects.toMatchObject({ status: 403 })
  })
  it("paginates and treats search wildcards literally", async () => {
    const first = await listAdministration(f.DB, "admin", "accounts", {
      limit: 2,
    })
    expect(first.items.map((item) => item.id)).toEqual(["admin", "other"])
    const next = await listAdministration(f.DB, "admin", "accounts", {
      limit: 2,
      after: first.nextCursor,
    })
    expect(next.items.map((item) => item.id)).toEqual(["owner"])
    expect(
      (await listAdministration(f.DB, "admin", "accounts", { q: "%" })).items
    ).toEqual([])
    expect(
      (await listAdministration(f.DB, "admin", "events", { q: "owner" })).items
    ).toHaveLength(1)
  })
  it("requires moderation authority within activation inspection and rechecks it before returning private details", async () => {
    await expect(
      readActivation(f.DB, "event", "other", now, true)
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      readActivation(f.DB, "event", "admin", now, true, {
        beforeReturn: async () => {
          await f.DB.prepare(
            "DELETE FROM platform_grants WHERE user_id='admin'"
          ).run()
        },
      })
    ).rejects.toMatchObject({ status: 403 })
  })
  it("suspends an account atomically, removes sessions and preserves existing preferences", async () => {
    await f.DB.prepare(
      "INSERT INTO profiles(user_id,locale,updated_at) VALUES('owner','ru',?)"
    )
      .bind(now - 100)
      .run()
    await f.DB.prepare(
      "INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES('session','private-session-token','owner',?,?,?)"
    )
      .bind(now + 100000, now, now)
      .run()
    expect(await change()).toEqual({
      kind: "account",
      id: "owner",
      revision: 1,
      suspendedAt: new Date(now).toISOString(),
    })
    expect(
      await f.DB.prepare(
        "SELECT count(*) n FROM session WHERE user_id='owner'"
      ).first("n")
    ).toBe(0)
    expect(
      await f.DB.prepare(
        "SELECT locale FROM profiles WHERE user_id='owner'"
      ).first("locale")
    ).toBe("ru")
    await expect(requireActiveAccount(f.DB, "owner")).rejects.toMatchObject({
      status: 403,
    })
    expect(
      (
        await listAdministration(f.DB, "admin", "accounts", {
          suspended: "yes",
        })
      ).items.map((row) => row.id)
    ).toEqual(["owner"])
    expect(
      await f.DB.prepare(
        "SELECT action FROM audit_entries WHERE entity_id='owner'"
      ).first("action")
    ).toBe("account.suspended")
  })
  it("resumes an account without resurrecting sessions and replays the exact original result", async () => {
    const original = await change()
    expect(
      await change("account", {
        requestId: "resume",
        expectedRevision: 1,
        suspended: false,
      })
    ).toMatchObject({ revision: 2, suspendedAt: null })
    await expect(requireActiveAccount(f.DB, "owner")).resolves.toMatchObject({
      id: "owner",
    })
    expect(await change()).toEqual(original)
    expect(
      await f.DB.prepare(
        "SELECT suspended_at FROM profiles WHERE user_id='owner'"
      ).first("suspended_at")
    ).toBeNull()
    expect(
      await f.DB.prepare(
        "SELECT count(*) n FROM audit_entries WHERE entity_id='owner'"
      ).first("n")
    ).toBe(2)
  })
  it("rejects reused IDs with changed payloads and stale independent requests without another audit", async () => {
    await change()
    await expect(
      change("account", { reason: "Changed reason" })
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      change("account", { requestId: "stale" })
    ).rejects.toMatchObject({ status: 409 })
    expect(
      await f.DB.prepare("SELECT count(*) n FROM audit_entries").first("n")
    ).toBe(1)
    expect(
      await f.DB.prepare("SELECT count(*) n FROM request_receipts").first("n")
    ).toBe(1)
  })
  it("rolls back suspension, sessions and receipt when moderator access is revoked before commit", async () => {
    await expect(
      change("account", {}, async () => {
        await f.DB.prepare(
          "DELETE FROM platform_grants WHERE user_id='admin'"
        ).run()
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(
      await f.DB.prepare(
        "SELECT count(*) n FROM profiles WHERE user_id='owner'"
      ).first("n")
    ).toBe(0)
    expect(
      await f.DB.prepare("SELECT count(*) n FROM request_receipts").first("n")
    ).toBe(0)
    expect(
      await f.DB.prepare("SELECT count(*) n FROM audit_entries").first("n")
    ).toBe(0)
  })
  it("permits only one concurrent suspension of a given revision", async () => {
    const results = await Promise.allSettled([
      change(),
      change("account", { requestId: "other-request" }),
    ])
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1)
    expect(
      await f.DB.prepare("SELECT count(*) n FROM audit_entries").first("n")
    ).toBe(1)
  })
  it("prevents self-suspension and rejects unknown subjects", async () => {
    await expect(
      setSuspension(f.DB, "admin", "account", "admin", {
        requestId: "self",
        expectedRevision: 0,
        suspended: true,
        reason: "Self suspension",
      })
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      setSuspension(f.DB, "admin", "event", "missing", {
        requestId: "missing",
        expectedRevision: 0,
        suspended: true,
        reason: "Missing subject",
      })
    ).rejects.toMatchObject({ status: 404 })
  })
  it("suspends/resumes an event with its existing event revision and immutable audit", async () => {
    await change("event")
    expect(
      (await listAdministration(f.DB, "admin", "events", { suspended: "yes" }))
        .items
    ).toHaveLength(1)
    expect(
      await f.DB.prepare("SELECT revision FROM events WHERE id='event'").first(
        "revision"
      )
    ).toBe(1)
    await change("event", {
      requestId: "resume",
      expectedRevision: 1,
      suspended: false,
    })
    expect(
      await f.DB.prepare(
        "SELECT suspended_at FROM events WHERE id='event'"
      ).first("suspended_at")
    ).toBeNull()
    expect(
      await f.DB.prepare(
        "SELECT count(*) n FROM audit_entries WHERE event_id='event'"
      ).first("n")
    ).toBe(2)
  })
  it.each(["account", "event"] as const)(
    "expires %s snapshots while retaining devices and the signed manifest for reconciliation",
    async (kind) => {
      await f.DB.prepare(
        "INSERT INTO event_permissions(user_id,event_id,permission,granted_at) VALUES('owner','event','ticket:scan',?)"
      )
        .bind(now - 2000)
        .run()
      await f.DB.prepare(
        "INSERT INTO offline_devices(id,account_id,event_id,label,registered_at) VALUES('device','owner','event','Synthetic',?)"
      )
        .bind(now - 2000)
        .run()
      await f.DB.prepare(
        "INSERT INTO offline_snapshots(id,account_id,device_id,event_id,issued_at,expires_at,event_ends_at,ticket_count,key_id) VALUES('snapshot','owner','device','event',?,?,?,0,'key')"
      )
        .bind(now - 1000, now + 10000, now + 7200000)
        .run()
      const manifest = JSON.stringify({
        snapshotId: "snapshot",
        keyId: "key",
        ticketCount: 0,
      })
      await f.DB.prepare(
        "UPDATE offline_snapshots SET manifest_json=? WHERE id='snapshot'"
      )
        .bind(manifest)
        .run()
      await change(kind)
      expect(
        await f.DB.prepare(
          "SELECT invalidated_at FROM offline_snapshots WHERE id='snapshot'"
        ).first("invalidated_at")
      ).toBe(now)
      expect(
        await f.DB.prepare(
          "SELECT expires_at FROM offline_snapshots WHERE id='snapshot'"
        ).first("expires_at")
      ).toBe(now + 10000)
      expect(
        await f.DB.prepare(
          "SELECT manifest_json FROM offline_snapshots WHERE id='snapshot'"
        ).first("manifest_json")
      ).toBe(manifest)
      await expect(
        f.DB.prepare(
          "UPDATE offline_snapshots SET invalidated_at=NULL WHERE id='snapshot'"
        ).run()
      ).rejects.toThrow("offline_snapshot_invalidation")
      expect(
        await f.DB.prepare("SELECT count(*) n FROM offline_devices").first("n")
      ).toBe(1)
    }
  )
})
