import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import {
  organizerProfileMutationResponseSchema,
  organizerProfileResponseSchema,
} from "@elc/shared"
import { createAuthTestDatabase } from "../auth/test-database"
import { loadAuthEmailLocale } from "../auth/locale"
import { createExportFixture } from "../exports/test-fixture"
import {
  cleanupInactiveProfiles,
  cleanupCompletedPayloads,
} from "../retention/housekeeping"
import { ApiFailure, requestHash } from "../db/transitions"
import type { Bindings } from "../env"
import { createOrganizerProfileRoutes } from "./index"
import {
  readOrganizerProfile,
  updateOrganizerProfile,
  type ProfileDependencies,
} from "./service"

describe("organizer profile on migrated D1", () => {
  let fixture: Awaited<ReturnType<typeof createAuthTestDatabase>>,
    db: D1Database,
    now: number
  const clock = () => now
  const profile = () => ({
    displayName: "Campus organizer",
    legalName: "Academic Organizer",
    contact: "organizer@example.test",
    dummyPayoutReference: "DEMO-CAMPUS",
  })
  const input = (requestId = "profile-save", expectedRevision = 0) => ({
    requestId,
    expectedRevision,
    profile: profile(),
  })
  const save = (
    body: unknown = input(),
    dependencies: ProfileDependencies = {}
  ) =>
    updateOrganizerProfile(db, "actor", body, { now: clock, ...dependencies })
  const count = (table: string) =>
    db.prepare(`SELECT count(*) n FROM ${table}`).first<number>("n")
  beforeEach(async () => {
    fixture = await createAuthTestDatabase()
    db = fixture.DB
    now = Date.now()
    for (const id of ["actor", "other"])
      await db
        .prepare(
          "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)"
        )
        .bind(id, id, `${id}@example.test`, now, now)
        .run()
  })
  afterEach(async () => {
    await fixture?.runtime.dispose()
  })
  it("reads an absent profile without creating a locale, profile, receipt or audit", async () => {
    expect(await readOrganizerProfile(db, "actor")).toEqual({
      profile: null,
      revision: 0,
      updatedAt: null,
    })
    for (const table of [
      "profiles",
      "organizer_profiles",
      "request_receipts",
      "audit_entries",
    ])
      expect(await count(table)).toBe(0)
  })
  it("saves normalized fields and independent revisions without changing account identity or locale", async () => {
    const user = await db.prepare("SELECT * FROM user WHERE id='actor'").first()
    const body = input()
    body.profile.displayName = "  Campus organizer  "
    const first = await save(body)
    expect(first).toEqual({
      revision: 1,
      updatedAt: new Date(now).toISOString(),
    })
    expect(await readOrganizerProfile(db, "actor")).toEqual({
      profile: profile(),
      ...first,
    })
    expect(await count("profiles")).toBe(0)
    expect(await loadAuthEmailLocale(db, "actor", "ru")).toBe("ru")
    expect(
      await db.prepare("SELECT * FROM user WHERE id='actor'").first()
    ).toEqual(user)
    const next = input("profile-two", 1)
    next.profile.legalName = "Updated Academic Organizer"
    now += 1000
    expect(await save(next)).toEqual({
      revision: 2,
      updatedAt: new Date(now).toISOString(),
    })
    expect((await readOrganizerProfile(db, "actor")).profile?.legalName).toBe(
      next.profile.legalName
    )
    expect(await count("audit_entries")).toBe(2)
    expect(await count("request_receipts")).toBe(2)
  })
  it("preserves saved locale and moderation state during a concurrent preference write", async () => {
    await db
      .prepare(
        "INSERT INTO profiles(user_id,locale,moderation_revision,updated_at,legal_name,contact,dummy_payout_reference) VALUES('actor','ru',7,?,'legacy legal','legacy contact','DEMO-LEGACY')"
      )
      .bind(now - 50)
      .run()
    await save(input(), {
      beforeCommit: async () => {
        await db
          .prepare(
            "UPDATE profiles SET locale='en',updated_at=? WHERE user_id='actor'"
          )
          .bind(now)
          .run()
      },
    })
    expect(
      await db.prepare("SELECT * FROM profiles WHERE user_id='actor'").first()
    ).toMatchObject({
      locale: "en",
      moderation_revision: 7,
      suspended_at: null,
      updated_at: now,
      legal_name: "legacy legal",
      contact: "legacy contact",
      dummy_payout_reference: "DEMO-LEGACY",
    })
    expect(await loadAuthEmailLocale(db, "actor", "ru")).toBe("en")
  })
  it("keeps acknowledgements stable for identical retries even after subsequent edits", async () => {
    const first = await save()
    now += 1000
    const later = input("later", 1)
    later.profile.contact = "new-contact@example.test"
    await save(later)
    now += 1000
    expect(await save()).toEqual(first)
    expect(await count("audit_entries")).toBe(2)
    expect(await count("request_receipts")).toBe(2)
    expect((await readOrganizerProfile(db, "actor")).revision).toBe(2)
    expect((await readOrganizerProfile(db, "actor")).profile?.contact).toBe(
      later.profile.contact
    )
    const receipt = await db
      .prepare(
        "SELECT response_json FROM request_receipts WHERE request_id='profile-save'"
      )
      .first<string>("response_json")
    expect(JSON.parse(receipt!)).toEqual(first)
  })
  it("recovers a committed save when the D1 batch acknowledgement is lost", async () => {
    let attempts = 0
    const uncertain = {
      prepare: db.prepare.bind(db),
      batch: async (statements: D1PreparedStatement[]) => {
        attempts++
        await db.batch(statements)
        throw new Error("Synthetic lost D1 acknowledgement")
      },
    } as unknown as D1Database
    const response = await updateOrganizerProfile(uncertain, "actor", input(), {
      now: clock,
    })
    expect(attempts).toBe(1)
    expect(await save()).toEqual(response)
    expect(await count("organizer_profiles")).toBe(1)
    expect(await count("audit_entries")).toBe(1)
    expect(await count("request_receipts")).toBe(1)
  })
  it("allows exactly one concurrent different edit at the same revision", async () => {
    let entered = 0,
      release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const beforeCommit = async () => {
      if (++entered === 2) release()
      await barrier
    }
    const a = input("a"),
      b = input("b")
    b.profile.displayName = "Second contender"
    const results = await Promise.allSettled([
      save(a, { beforeCommit }),
      save(b, { beforeCommit }),
    ])
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ code: "CONFLICT", status: 409 }),
      }),
    ])
    expect(await count("audit_entries")).toBe(1)
    expect((await readOrganizerProfile(db, "actor")).revision).toBe(1)
  })
  it("replays concurrent identical creates without duplicate rows or audit", async () => {
    let entered = 0,
      release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const beforeCommit = async () => {
      if (++entered === 2) release()
      await barrier
    }
    const [a, b] = await Promise.all([
      save(input(), { beforeCommit }),
      save(input(), { beforeCommit }),
    ])
    expect(a).toEqual(b)
    expect(await count("organizer_profiles")).toBe(1)
    expect(await count("audit_entries")).toBe(1)
  })
  it("rejects stale revisions, changed-body replay and cross-operation request reuse", async () => {
    await save()
    await expect(save(input("stale"))).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    })
    const changed = input()
    changed.profile.contact = "different@example.test"
    await expect(save(changed)).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    })
    await db
      .prepare(
        "INSERT INTO request_receipts(actor_id,request_id,input_hash,resource_id,created_at) VALUES('actor','other-operation',?,'actor',?)"
      )
      .bind(await requestHash("other.operation", {}), now)
      .run()
    await expect(save(input("other-operation", 1))).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    })
    expect((await readOrganizerProfile(db, "actor")).revision).toBe(1)
  })
  it("isolates accounts even when they use the same request identifier", async () => {
    const own = await save()
    expect(await readOrganizerProfile(db, "other")).toEqual({
      profile: null,
      revision: 0,
      updatedAt: null,
    })
    const other = input()
    other.profile.displayName = "Other organizer"
    expect(
      await updateOrganizerProfile(db, "other", other, { now: clock })
    ).toEqual(own)
    expect((await readOrganizerProfile(db, "actor")).profile?.displayName).toBe(
      "Campus organizer"
    )
    expect((await readOrganizerProfile(db, "other")).profile?.displayName).toBe(
      "Other organizer"
    )
  })
  it.each(["suspended", "unverified", "deleted"])(
    "rejects %s account reads, writes and receipt replays",
    async (change) => {
      await save()
      if (change === "suspended")
        await db
          .prepare(
            "INSERT INTO profiles(user_id,suspended_at,updated_at) VALUES('actor',?,?)"
          )
          .bind(now, now)
          .run()
      if (change === "unverified")
        await db
          .prepare("UPDATE user SET email_verified=0 WHERE id='actor'")
          .run()
      if (change === "deleted") {
        await db
          .prepare("DELETE FROM request_receipts WHERE actor_id='actor'")
          .run()
        await db.prepare("DELETE FROM user WHERE id='actor'").run()
      }
      await expect(readOrganizerProfile(db, "actor")).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403,
      })
      await expect(save()).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403,
      })
      await expect(save(input("new", 1))).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403,
      })
    }
  )
  it("checks current authorization after asynchronous read and replay work", async () => {
    await save()
    const suspend = async () => {
      await db
        .prepare(
          "INSERT INTO profiles(user_id,suspended_at,updated_at) VALUES('actor',?,?) ON CONFLICT(user_id) DO UPDATE SET suspended_at=excluded.suspended_at"
        )
        .bind(now, now)
        .run()
    }
    await expect(save(input(), { beforeRead: suspend })).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
    await db
      .prepare("UPDATE profiles SET suspended_at=NULL WHERE user_id='actor'")
      .run()
    await expect(
      readOrganizerProfile(db, "actor", { beforeRead: suspend })
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
  })
  it("rolls back a save if moderation wins before its commit", async () => {
    await expect(
      save(input(), {
        beforeCommit: async () => {
          await db
            .prepare(
              "INSERT INTO profiles(user_id,suspended_at,moderation_revision,updated_at) VALUES('actor',?,1,?)"
            )
            .bind(now, now)
            .run()
        },
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    for (const table of [
      "organizer_profiles",
      "request_receipts",
      "audit_entries",
    ])
      expect(await count(table)).toBe(0)
    expect(
      await db
        .prepare(
          "SELECT suspended_at,moderation_revision FROM profiles WHERE user_id='actor'"
        )
        .first()
    ).toEqual({ suspended_at: now, moderation_revision: 1 })
  })
  it("withholds the acknowledgement if authority is revoked after commit", async () => {
    await expect(
      save(input(), {
        beforeReturn: async () => {
          await db
            .prepare("UPDATE user SET email_verified=0 WHERE id='actor'")
            .run()
        },
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(await count("organizer_profiles")).toBe(1)
    await expect(save()).rejects.toMatchObject({ code: "FORBIDDEN" })
    await db.prepare("UPDATE user SET email_verified=1 WHERE id='actor'").run()
    expect((await save()).revision).toBe(1)
    expect(await count("audit_entries")).toBe(1)
  })
  it("rolls back profile, receipt and revision when account audit insertion fails", async () => {
    await save()
    await db
      .prepare(
        "CREATE TRIGGER reject_profile_audit BEFORE INSERT ON audit_entries WHEN NEW.action='organizer_profile.updated' BEGIN SELECT RAISE(ABORT,'Synthetic account audit failure'); END"
      )
      .run()
    const changed = input("failed-update", 1)
    changed.profile.displayName = "Must roll back"
    await expect(save(changed)).rejects.toThrow(
      "Synthetic account audit failure"
    )
    expect((await readOrganizerProfile(db, "actor")).profile?.displayName).toBe(
      "Campus organizer"
    )
    expect((await readOrganizerProfile(db, "actor")).revision).toBe(1)
    expect(await count("request_receipts")).toBe(1)
  })
  it("stores no personal profile contents in acknowledgements or account audit", async () => {
    const acknowledgement = await save()
    expect(
      organizerProfileMutationResponseSchema.safeParse(acknowledgement).success
    ).toBe(true)
    const audit = await db
      .prepare(
        "SELECT * FROM audit_entries WHERE action='organizer_profile.updated'"
      )
      .first()
    expect(audit).toMatchObject({
      scope: "account",
      entity_id: "actor",
      actor_id: "actor",
      description: "Organizer profile updated.",
    })
    const receipts = await db.prepare("SELECT * FROM request_receipts").all()
    for (const value of Object.values(profile())) {
      expect(JSON.stringify(audit)).not.toContain(value)
      expect(JSON.stringify(receipts.results)).not.toContain(value)
    }
  })
  it.each([
    "empty_name",
    "short_contact",
    "real_payout",
    "invalid_dummy",
    "long_legal",
    "extra_actor",
    "extra_locale",
    "negative_revision",
    "missing_request",
    "null",
  ])("rejects malformed profile input: %s", async (change) => {
    let body: unknown = input()
    if (change === "empty_name")
      body = { ...input(), profile: { ...profile(), displayName: "   " } }
    if (change === "short_contact")
      body = { ...input(), profile: { ...profile(), contact: " a " } }
    if (change === "real_payout")
      body = {
        ...input(),
        profile: { ...profile(), dummyPayoutReference: "KZ123456789" },
      }
    if (change === "invalid_dummy")
      body = {
        ...input(),
        profile: { ...profile(), dummyPayoutReference: "DEMO-invalid/ref" },
      }
    if (change === "long_legal")
      body = {
        ...input(),
        profile: { ...profile(), legalName: "x".repeat(201) },
      }
    if (change === "extra_actor") body = { ...input(), userId: "other" }
    if (change === "extra_locale")
      body = { ...input(), profile: { ...profile(), locale: "en" } }
    if (change === "negative_revision")
      body = { ...input(), expectedRevision: -1 }
    if (change === "missing_request")
      body = { expectedRevision: 0, profile: profile() }
    if (change === "null") body = null
    await expect(save(body)).rejects.toMatchObject({
      code: "INVALID_INPUT",
      status: 400,
    })
    expect(await count("organizer_profiles")).toBe(0)
  })
  it("preserves confirmed activation state, checklist history and payment snapshots", async () => {
    const active = await createExportFixture()
    try {
      const tables = [
        "events",
        "event_activations",
        "activation_checklist_history",
        "activation_attempts",
        "payment_attempts",
      ]
      const before = await Promise.all(
        tables.map((table) => active.db.prepare(`SELECT * FROM ${table}`).all())
      )
      await updateOrganizerProfile(active.db, "owner", input(), {
        now: () => active.now + 1000,
      })
      const edit = input("changed-profile", 1)
      edit.profile.dummyPayoutReference = "DEMO-NEW-ACCOUNT"
      await updateOrganizerProfile(active.db, "owner", edit, {
        now: () => active.now + 2000,
      })
      const after = await Promise.all(
        tables.map((table) => active.db.prepare(`SELECT * FROM ${table}`).all())
      )
      expect(after.map((result) => result.results)).toEqual(
        before.map((result) => result.results)
      )
      expect(
        await active.db
          .prepare("SELECT paid_sales_state FROM events WHERE id='event'")
          .first("paid_sales_state")
      ).toBe("active")
      expect(
        (await readOrganizerProfile(active.db, "owner")).profile
          ?.dummyPayoutReference
      ).toBe("DEMO-NEW-ACCOUNT")
    } finally {
      await active.dispose()
    }
  })
  it("cleans up the organizer profile with an eligible inactive account after its audit expires", async () => {
    await save()
    now += 181 * 86400000
    expect(await cleanupInactiveProfiles(db, now)).toBe(1) // The unrelated account has no retained audit.
    expect(await count("organizer_profiles")).toBe(1)
    await cleanupCompletedPayloads(db, now)
    expect(await cleanupInactiveProfiles(db, now)).toBe(1)
    expect(await count("organizer_profiles")).toBe(0)
    expect(await count("request_receipts")).toBe(0)
  })
  it("bounds request bodies before identity and returns private GET/PATCH responses", async () => {
    let identified = 0
    const app = new Hono<{
      Bindings: Bindings
      Variables: { requestId: string }
    }>()
      .route(
        "/api",
        createOrganizerProfileRoutes({
          identify: async () => {
            identified++
            return "actor"
          },
          now: clock,
        })
      )
      .onError((error, c) =>
        c.json(
          { code: error instanceof ApiFailure ? error.code : "ERROR" },
          error instanceof HTTPException ? error.status : 500
        )
      )
    const env = { DB: db } as Bindings,
      url = "http://elc.test/api/me/organizer-profile"
    const oversized = await app.request(
      url,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input(), padding: "x".repeat(4096) }),
      },
      env
    )
    expect(oversized.status).toBe(413)
    expect(await oversized.json()).toEqual({ code: "INVALID_INPUT" })
    expect(identified).toBe(0)
    const empty = await app.request(url, {}, env)
    expect(
      organizerProfileResponseSchema.safeParse(await empty.json()).success
    ).toBe(true)
    expect(empty.headers.get("Cache-Control")).toBe("private, no-store")
    expect(empty.headers.get("Vary")).toBe("Cookie")
    const saved = await app.request(
      url,
      {
        method: "PATCH",
        body: JSON.stringify(input()),
        headers: { "Content-Type": "application/json" },
      },
      env
    )
    expect(saved.status).toBe(200)
    expect(saved.headers.get("Cache-Control")).toBe("private, no-store")
    expect(
      organizerProfileMutationResponseSchema.safeParse(await saved.json())
        .success
    ).toBe(true)
    expect(
      (await app.request(url, { method: "PATCH", body: "{" }, env)).status
    ).toBe(400)
    expect(
      (
        await app.request(
          url,
          { method: "POST", body: JSON.stringify(input()) },
          env
        )
      ).status
    ).toBe(404)
  })
})
