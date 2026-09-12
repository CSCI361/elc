import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import {
  acceptedEventInvitationSchema,
  eventInvitationListSchema,
  eventStaffListSchema,
  permissionSchema,
  policy,
} from "@elc/shared"
import {
  requireEventPermission,
  requireEventReadAccess,
} from "../auth/permissions"
import { createAuthTestDatabase } from "../auth/test-database"
import { ApiFailure } from "../db/transitions"
import type { Bindings } from "../env"
import { startCheckout } from "../orders/checkout"
import { completeZeroTotalOrder } from "../tickets/issue"
import { createAccessRoutes } from "./index"
import {
  acceptEventInvitation,
  createEventInvitation,
  listEventInvitations,
  reissueEventInvitation,
  revokeEventInvitation,
} from "./invitations"
import { listEventStaff, replaceEventStaff } from "./staff"
import {
  invitationAcceptanceUrl,
  invitationTokenHash,
  recoverInvitationToken,
} from "./tokens"

describe("event staff and private invitations on D1", () => {
  let fixture: Awaited<ReturnType<typeof createAuthTestDatabase>>
  let db: D1Database
  let now: number
  const clock = () => now
  const env = () => ({
    DB: db,
    APP_ORIGIN: "https://app.example.test",
    TICKET_ENCRYPTION_KEY: "A".repeat(43),
  })
  const revision = async (eventId = "event") =>
    Number(
      await db
        .prepare("SELECT revision FROM events WHERE id = ?")
        .bind(eventId)
        .first("revision")
    )
  const change = (expectedRevision: number) => ({
    requestId: crypto.randomUUID(),
    expectedRevision,
  })
  const invitation = async (
    email = "invited@example.test",
    eventId = "event"
  ) =>
    createEventInvitation(
      env(),
      "owner",
      eventId,
      { ...change(await revision(eventId)), email },
      { now: clock }
    )
  const assign = async (
    email: string,
    permissions: string[],
    eventId = "event"
  ) =>
    replaceEventStaff(
      db,
      "owner",
      eventId,
      { ...change(await revision(eventId)), email, permissions },
      { now: clock }
    )
  const scalar = (sql: string, ...bindings: unknown[]) =>
    db
      .prepare(sql)
      .bind(...bindings)
      .first<number>("n")
  const basket = () => ({
    requestId: crypto.randomUUID(),
    eventId: "event",
    items: [
      { ticketTypeId: "type", quantity: 1, attendeeNames: ["Invited guest"] },
    ],
  })
  async function deliveryToken(id: string) {
    const payload = await db
      .prepare(
        "SELECT payload_json FROM outbox WHERE kind = 'invitation.deliver' AND entity_id = ?"
      )
      .bind(id)
      .first<string>("payload_json")
    const delivery = JSON.parse(payload!) as { encryptedToken: string }
    return recoverInvitationToken(
      id,
      delivery.encryptedToken,
      env().TICKET_ENCRYPTION_KEY
    )
  }
  async function accepted() {
    const created = await invitation()
    const token = await deliveryToken(created.invitation.id)
    await acceptEventInvitation(
      db,
      "invited",
      { requestId: crypto.randomUUID(), token },
      { now: clock }
    )
    return { id: created.invitation.id, token }
  }

  beforeEach(async () => {
    fixture = await createAuthTestDatabase()
    db = fixture.DB
    now = Date.now()
    await db.batch(
      ["owner", "other", "staff", "scanner", "invited", "admin"].map((id) =>
        db
          .prepare(
            "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
          )
          .bind(
            id,
            id,
            id === "invited" ? "Invited@Example.test" : `${id}@example.test`,
            now,
            now
          )
      )
    )
    for (const [id, owner, days] of [
      ["event", "owner", 2],
      ["long-event", "owner", 20],
      ["other-event", "other", 2],
    ] as const)
      await db
        .prepare(`INSERT INTO events (id, organizer_id, title, description, category, venue_name, venue_address, starts_at, ends_at,
        registration_opens_at, registration_closes_at, capacity, max_tickets_per_order, visibility, publication_state, calendar_uid, reporting_id, created_at, updated_at)
        VALUES (?, ?, 'Private demo', 'Description', 'Music', 'Hall', 'Address', ?, ?, ?, ?, 4, 4, 'private', 'published', ?, ?, ?, ?)`)
        .bind(
          id,
          owner,
          now + days * 86_400_000 - 3_600_000,
          now + days * 86_400_000,
          now - 60_000,
          now + days * 86_400_000 - 3_600_000,
          `${id}-calendar`,
          `${id}-report`,
          now,
          now
        )
        .run()
    await db
      .prepare(
        "INSERT INTO ticket_types (id, event_id, name, kind, price_minor, quantity, sales_start_at, sales_end_at, updated_at) VALUES ('type', 'event', 'Free admission', 'free', 0, 4, ?, ?, ?)"
      )
      .bind(now - 60_000, now + 86_400_000, now)
      .run()
    await db.batch(
      [1, 2, 3, 4].map((index) =>
        db
          .prepare(
            "INSERT INTO inventory (id, event_id, ticket_type_id) VALUES (?, 'event', 'type')"
          )
          .bind(`slot-${index}`)
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

  it("requires explicit scan and reversal grants even for the owner", async () => {
    await expect(
      requireEventPermission(db, "owner", "event", "ticket:scan")
    ).rejects.toBeInstanceOf(HTTPException)
    await expect(
      requireEventPermission(db, "owner", "event", "checkin:reverse")
    ).rejects.toBeInstanceOf(HTTPException)
    const result = await assign("owner@example.test", ["ticket:scan"])
    expect(result.staff.permissions).toEqual(["ticket:scan"])
    expect(
      await requireEventPermission(db, "owner", "event", "ticket:scan")
    ).toMatchObject({ id: "event" })
    await assign("owner@example.test", [])
    await expect(
      requireEventPermission(db, "owner", "event", "ticket:scan")
    ).rejects.toBeInstanceOf(HTTPException)
    expect(
      await requireEventPermission(db, "owner", "event", "event:manage")
    ).toMatchObject({ id: "event" })
  })

  it("replaces only the target event's explicit permission set and preserves revocation history", async () => {
    const granted = await assign(" ScAnNeR@Example.test ", [
      "ticket:scan",
      "checkin:reverse",
    ])
    expect(granted.staff.permissions).toEqual([
      "checkin:reverse",
      "ticket:scan",
    ])
    await expect(
      requireEventPermission(db, "scanner", "event", "support:manage")
    ).rejects.toBeInstanceOf(HTTPException)
    await expect(
      requireEventPermission(db, "scanner", "long-event", "ticket:scan")
    ).rejects.toBeInstanceOf(HTTPException)
    now += 1000
    const replaced = await assign("scanner@example.test", ["support:manage"])
    expect(replaced.staff.permissions).toEqual(["support:manage"])
    expect(
      replaced.staff.grants.find((grant) => grant.permission === "ticket:scan")
        ?.revokedAt
    ).toBe(new Date(now).toISOString())
    expect(
      await scalar(
        "SELECT count(*) AS n FROM audit_entries WHERE action = 'staff.permissions_replaced'"
      )
    ).toBe(2)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM outbox WHERE kind = 'staff.permissions_changed'"
      )
    ).toBe(2)
  })

  it("does not let a delegated event manager, platform moderator, or another event owner assign staff", async () => {
    await assign("staff@example.test", ["event:manage"])
    for (const actorId of ["staff", "admin", "other"]) {
      await expect(
        replaceEventStaff(
          db,
          actorId,
          "event",
          {
            ...change(await revision()),
            email: "scanner@example.test",
            permissions: ["ticket:scan"],
          },
          { now: clock }
        )
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
      await expect(
        listEventInvitations(db, actorId, "event")
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
    }
    await expect(
      assign("scanner@example.test", ["platform:moderate"])
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
    expect(
      await scalar(
        "SELECT count(*) AS n FROM event_permissions WHERE user_id = 'scanner'"
      )
    ).toBe(0)
  })

  it("deduplicates concurrent assignments and rolls a stale competing update back", async () => {
    const input = {
      ...change(0),
      email: "scanner@example.test",
      permissions: ["ticket:scan"],
    }
    const results = await Promise.all(
      [1, 2].map(() =>
        replaceEventStaff(db, "owner", "event", input, { now: clock })
      )
    )
    expect(results[0]).toEqual(results[1])
    expect(await revision()).toBe(1)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM audit_entries WHERE action = 'staff.permissions_replaced'"
      )
    ).toBe(1)
    await expect(
      replaceEventStaff(
        db,
        "owner",
        "event",
        {
          ...change(0),
          email: "scanner@example.test",
          permissions: ["refund:initiate"],
        },
        { now: clock }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(
      (await listEventStaff(db, "owner", "event")).items[0]?.permissions
    ).toEqual(["ticket:scan"])
    await expect(
      replaceEventStaff(
        db,
        "owner",
        "event",
        { ...input, permissions: ["refund:initiate"] },
        { now: clock }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })

  it.each(["owner", "target"])(
    "rechecks the %s account inside the staff assignment batch",
    async (who) => {
      await expect(
        replaceEventStaff(
          db,
          "owner",
          "event",
          {
            ...change(0),
            email: "scanner@example.test",
            permissions: ["ticket:scan"],
          },
          {
            now: clock,
            beforeCommit: async () => {
              await db
                .prepare("UPDATE user SET email_verified = 0 WHERE id = ?")
                .bind(who === "owner" ? "owner" : "scanner")
                .run()
            },
          }
        )
      ).rejects.toMatchObject({ code: "CONFLICT" })
      expect(await scalar("SELECT count(*) AS n FROM event_permissions")).toBe(
        0
      )
      expect(await scalar("SELECT count(*) AS n FROM request_receipts")).toBe(0)
      expect(await scalar("SELECT count(*) AS n FROM audit_entries")).toBe(0)
    }
  )

  it("allows revoking a suspended target and lists staff with scoped pagination", async () => {
    await assign("scanner@example.test", ["ticket:scan"])
    await assign("staff@example.test", ["support:manage"])
    await db
      .prepare(
        "INSERT INTO profiles (user_id, suspended_at, updated_at) VALUES ('scanner', ?, ?)"
      )
      .bind(now, now)
      .run()
    await assign("scanner@example.test", [])
    const page = await listEventStaff(db, "owner", "event", { limit: 1 })
    expect(page.items).toHaveLength(1)
    const next = await listEventStaff(db, "owner", "event", {
      limit: 1,
      cursor: page.nextCursor,
    })
    expect(next.items).toHaveLength(1)
    expect(next.items[0]?.userId).not.toBe(page.items[0]?.userId)
    await expect(
      listEventStaff(db, "owner", "long-event", { cursor: page.nextCursor })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
    await assign("staff@example.test", ["refund:initiate"])
    await expect(
      listEventStaff(db, "owner", "event", { cursor: page.nextCursor })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(eventStaffListSchema.safeParse(next).success).toBe(true)
  })

  it("keeps private staff read access separate from purchaser invitation access", async () => {
    await assign("scanner@example.test", ["ticket:scan"])
    expect(await requireEventReadAccess(db, "event", "scanner")).toMatchObject({
      id: "event",
    })
    await expect(
      startCheckout(db, "scanner", basket(), { now: clock })
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })

  it("caps invitation validity and stores only a hash plus encrypted delivery material", async () => {
    const short = await invitation(" Invited@EXAMPLE.test ")
    expect(short.invitation.email).toBe("invited@example.test")
    expect(Date.parse(short.invitation.expiresAt)).toBe(now + 2 * 86_400_000)
    const long = await invitation("invited@example.test", "long-event")
    expect(Date.parse(long.invitation.expiresAt)).toBe(
      now + policy.privateInvitationLifetimeMs
    )
    const token = await deliveryToken(short.invitation.id)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const stored = await db
      .prepare("SELECT token_hash FROM invitations WHERE id = ?")
      .bind(short.invitation.id)
      .first<string>("token_hash")
    expect(stored).toBe(await invitationTokenHash(token))
    const responseAndList = JSON.stringify([
      short,
      await listEventInvitations(db, "owner", "event"),
    ])
    expect(responseAndList).not.toContain(token)
    expect(responseAndList).not.toContain(stored!)
    expect(responseAndList).not.toContain("encryptedToken")
    const outbox = await db
      .prepare(
        "SELECT payload_json FROM outbox WHERE kind = 'invitation.deliver' AND entity_id = ?"
      )
      .bind(short.invitation.id)
      .first<string>("payload_json")
    expect(outbox).not.toContain(token)
    expect(
      JSON.stringify(await db.prepare("SELECT * FROM request_receipts").all())
    ).not.toContain(token)
    const encrypted = JSON.parse(outbox!).encryptedToken as string
    await expect(
      recoverInvitationToken(
        long.invitation.id,
        encrypted,
        env().TICKET_ENCRYPTION_KEY
      )
    ).rejects.toThrow()
    expect(invitationAcceptanceUrl(env().APP_ORIGIN, token)).toBe(
      `https://app.example.test/invitations/accept#token=${token}`
    )
  })

  it("creates one invitation and delivery job under duplicate requests, rejecting an independent duplicate email", async () => {
    const input = { ...change(0), email: "invited@example.test" }
    const results = await Promise.all(
      [1, 2].map(() =>
        createEventInvitation(env(), "owner", "event", input, { now: clock })
      )
    )
    expect(results[0]).toEqual(results[1])
    expect(await scalar("SELECT count(*) AS n FROM invitations")).toBe(1)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM outbox WHERE kind = 'invitation.deliver'"
      )
    ).toBe(1)
    await expect(invitation()).rejects.toMatchObject({ code: "CONFLICT" })
    expect(
      await scalar(
        "SELECT count(*) AS n FROM audit_entries WHERE action = 'invitation.created'"
      )
    ).toBe(1)
  })

  it.each(["public", "cancelled", "suspended", "ended", "owner_unverified"])(
    "does not issue an invitation when %s becomes true before commit",
    async (condition) => {
      await expect(
        createEventInvitation(
          env(),
          "owner",
          "event",
          { ...change(0), email: "invited@example.test" },
          {
            now: clock,
            beforeCommit: async () => {
              if (condition === "public")
                await db
                  .prepare(
                    "UPDATE events SET visibility = 'public' WHERE id = 'event'"
                  )
                  .run()
              if (condition === "cancelled")
                await db
                  .prepare(
                    "UPDATE events SET cancelled_at = ? WHERE id = 'event'"
                  )
                  .bind(now)
                  .run()
              if (condition === "suspended")
                await db
                  .prepare(
                    "UPDATE events SET suspended_at = ? WHERE id = 'event'"
                  )
                  .bind(now)
                  .run()
              if (condition === "ended") now += 3 * 86_400_000
              if (condition === "owner_unverified")
                await db
                  .prepare(
                    "UPDATE user SET email_verified = 0 WHERE id = 'owner'"
                  )
                  .run()
            },
          }
        )
      ).rejects.toBeInstanceOf(HTTPException)
      expect(await scalar("SELECT count(*) AS n FROM invitations")).toBe(0)
      expect(await scalar("SELECT count(*) AS n FROM outbox")).toBe(0)
    }
  )

  it("requires configured delivery encryption before committing an invitation", async () => {
    await expect(
      createEventInvitation(
        { ...env(), TICKET_ENCRYPTION_KEY: undefined },
        "owner",
        "event",
        { ...change(0), email: "invited@example.test" },
        { now: clock }
      )
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" })
    expect(await scalar("SELECT count(*) AS n FROM invitations")).toBe(0)
  })

  it("accepts only the matching verified email and commits duplicate acceptance once", async () => {
    const created = await invitation()
    const token = await deliveryToken(created.invitation.id)
    await expect(
      acceptEventInvitation(
        db,
        "other",
        { requestId: crypto.randomUUID(), token },
        { now: clock }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    await db
      .prepare("UPDATE user SET email_verified = 0 WHERE id = 'invited'")
      .run()
    await expect(
      acceptEventInvitation(
        db,
        "invited",
        { requestId: crypto.randomUUID(), token },
        { now: clock }
      )
    ).rejects.toBeInstanceOf(HTTPException)
    await db
      .prepare("UPDATE user SET email_verified = 1 WHERE id = 'invited'")
      .run()
    const input = { requestId: crypto.randomUUID(), token }
    const results = await Promise.all(
      [1, 2].map(() =>
        acceptEventInvitation(db, "invited", input, { now: clock })
      )
    )
    expect(results[0]).toEqual(results[1])
    expect(acceptedEventInvitationSchema.safeParse(results[0]).success).toBe(
      true
    )
    expect(
      await scalar(
        "SELECT count(*) AS n FROM audit_entries WHERE action = 'invitation.accepted'"
      )
    ).toBe(1)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM outbox WHERE kind = 'invitation.accepted'"
      )
    ).toBe(1)
    expect(await requireEventReadAccess(db, "event", "invited")).toMatchObject({
      id: "event",
    })
  })

  it("treats independent concurrent matching acceptances as one access grant", async () => {
    const created = await invitation()
    const token = await deliveryToken(created.invitation.id)
    const results = await Promise.all(
      [1, 2].map(() =>
        acceptEventInvitation(
          db,
          "invited",
          { requestId: crypto.randomUUID(), token },
          { now: clock }
        )
      )
    )
    expect(results[0]).toEqual(results[1])
    expect(
      await scalar(
        "SELECT count(*) AS n FROM audit_entries WHERE action = 'invitation.accepted'"
      )
    ).toBe(1)
    expect(await revision()).toBe(2)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM request_receipts WHERE actor_id = 'invited'"
      )
    ).toBe(2)
  })

  it("rejects an expired pending token but retains accepted access after token expiry", async () => {
    const created = await invitation("invited@example.test", "long-event")
    const token = await deliveryToken(created.invitation.id)
    await acceptEventInvitation(
      db,
      "invited",
      { requestId: crypto.randomUUID(), token },
      { now: clock }
    )
    const pending = await invitation("other@example.test", "long-event")
    const pendingToken = await deliveryToken(pending.invitation.id)
    now += policy.privateInvitationLifetimeMs + 1
    await expect(
      acceptEventInvitation(
        db,
        "other",
        { requestId: crypto.randomUUID(), token: pendingToken },
        { now: clock }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(
      await acceptEventInvitation(
        db,
        "invited",
        { requestId: crypto.randomUUID(), token },
        { now: clock }
      )
    ).toMatchObject({ invitationId: created.invitation.id })
    expect(
      await requireEventReadAccess(db, "long-event", "invited")
    ).toMatchObject({ id: "long-event" })
  })

  it.each([
    "revoke",
    "email_changed",
    "unverified",
    "suspended",
    "event_cancelled",
  ])("rechecks %s before committing acceptance", async (condition) => {
    const created = await invitation()
    const token = await deliveryToken(created.invitation.id)
    await expect(
      acceptEventInvitation(
        db,
        "invited",
        { requestId: crypto.randomUUID(), token },
        {
          now: clock,
          beforeCommit: async () => {
            if (condition === "revoke")
              await revokeEventInvitation(
                db,
                "owner",
                "event",
                created.invitation.id,
                change(await revision()),
                { now: clock }
              )
            if (condition === "email_changed")
              await db
                .prepare(
                  "UPDATE user SET email = 'changed@example.test' WHERE id = 'invited'"
                )
                .run()
            if (condition === "unverified")
              await db
                .prepare(
                  "UPDATE user SET email_verified = 0 WHERE id = 'invited'"
                )
                .run()
            if (condition === "suspended")
              await db
                .prepare(
                  "INSERT INTO profiles (user_id, suspended_at, updated_at) VALUES ('invited', ?, ?)"
                )
                .bind(now, now)
                .run()
            if (condition === "event_cancelled")
              await db
                .prepare(
                  "UPDATE events SET cancelled_at = ? WHERE id = 'event'"
                )
                .bind(now)
                .run()
          },
        }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(
      await scalar(
        "SELECT count(*) AS n FROM invitations WHERE accepted_at IS NOT NULL"
      )
    ).toBe(0)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM audit_entries WHERE action = 'invitation.accepted'"
      )
    ).toBe(0)
  })

  it("reissues with a fresh token, revokes previous accepted access, and does not leak either token", async () => {
    const first = await accepted()
    const input = change(await revision())
    const results = await Promise.all(
      [1, 2].map(() =>
        reissueEventInvitation(env(), "owner", "event", first.id, input, {
          now: clock,
        })
      )
    )
    expect(results[0]).toEqual(results[1])
    const replacement = results[0]!
    const token = await deliveryToken(replacement.invitation.id)
    expect(token).not.toBe(first.token)
    await expect(
      acceptEventInvitation(
        db,
        "invited",
        { requestId: crypto.randomUUID(), token: first.token },
        { now: clock }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(
      requireEventReadAccess(db, "event", "invited")
    ).rejects.toBeInstanceOf(HTTPException)
    await acceptEventInvitation(
      db,
      "invited",
      { requestId: crypto.randomUUID(), token },
      { now: clock }
    )
    expect(await requireEventReadAccess(db, "event", "invited")).toMatchObject({
      id: "event",
    })
    const list = await listEventInvitations(db, "owner", "event")
    expect(list.items).toHaveLength(2)
    expect(list.items.find((item) => item.id === first.id)?.state).toBe(
      "revoked"
    )
    expect(JSON.stringify(list)).not.toContain(token)
    expect(JSON.stringify(list)).not.toContain(first.token)
  })

  it("revocation invalidates current purchase access and acceptance replay", async () => {
    const acceptedInvite = await accepted()
    await expect(
      startCheckout(db, "invited", basket(), {
        now: clock,
        beforeCommit: async () => {
          await revokeEventInvitation(
            db,
            "owner",
            "event",
            acceptedInvite.id,
            change(await revision()),
            { now: clock }
          )
        },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(await scalar("SELECT count(*) AS n FROM orders")).toBe(0)
    await expect(
      acceptEventInvitation(
        db,
        "invited",
        { requestId: crypto.randomUUID(), token: acceptedInvite.token },
        { now: clock }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("revocation during canonical free issuance prevents tickets and leaves the hold unconsumed", async () => {
    const acceptedInvite = await accepted()
    const reserved = await startCheckout(db, "invited", basket(), {
      now: clock,
    })
    await expect(
      completeZeroTotalOrder(
        env(),
        "invited",
        reserved.order.id,
        { requestId: crypto.randomUUID(), expectedRevision: 0 },
        {
          now: clock,
          beforeCommit: async () => {
            await revokeEventInvitation(
              db,
              "owner",
              "event",
              acceptedInvite.id,
              change(await revision()),
              { now: clock }
            )
          },
        }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(await scalar("SELECT count(*) AS n FROM tickets")).toBe(0)
    expect(
      await db
        .prepare("SELECT state FROM reservations WHERE id = ?")
        .bind(reserved.reservation.id)
        .first("state")
    ).toBe("active")
  })

  it("keeps invitation mutations event-scoped and paginates without token material", async () => {
    const first = await invitation()
    await invitation("other@example.test")
    await expect(
      revokeEventInvitation(
        db,
        "owner",
        "long-event",
        first.invitation.id,
        change(await revision("long-event")),
        { now: clock }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    const page = await listEventInvitations(
      db,
      "owner",
      "event",
      { limit: 1 },
      now
    )
    const next = await listEventInvitations(
      db,
      "owner",
      "event",
      { limit: 1, cursor: page.nextCursor },
      now
    )
    expect(next.items[0]?.id).not.toBe(page.items[0]?.id)
    expect(next.nextCursor).toBeNull()
    expect(eventInvitationListSchema.safeParse(next).success).toBe(true)
    await expect(
      listEventStaff(db, "owner", "event", { cursor: page.nextCursor })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
  })

  it("serves owner staff/invitation and verified acceptance routes with validated payloads", async () => {
    const app = new Hono<{ Bindings: Bindings }>()
    app.onError((error, c) =>
      c.json(
        { code: error instanceof ApiFailure ? error.code : "ERROR" },
        error instanceof HTTPException ? error.status : 500
      )
    )
    app.route(
      "/api",
      createAccessRoutes({
        now: clock,
        identify: async (c) => c.req.header("x-test-actor") ?? "owner",
      })
    )
    const environment = env() as Bindings
    const assigned = await app.request(
      "https://api.example.test/api/events/event/staff",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...change(0),
          email: "scanner@example.test",
          permissions: ["ticket:scan"],
        }),
      },
      environment
    )
    expect(assigned.status).toBe(200)
    const listed = await app.request(
      "https://api.example.test/api/events/event/staff",
      {},
      environment
    )
    expect(eventStaffListSchema.safeParse(await listed.json()).success).toBe(
      true
    )
    const bad = await app.request(
      "https://api.example.test/api/events/event/invitations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
      environment
    )
    expect(bad.status).toBe(400)
    expect(permissionSchema.options).toContain("ticket:scan")
    const created = await invitation()
    const token = await deliveryToken(created.invitation.id)
    const result = await app.request(
      "https://api.example.test/api/invitations/accept",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-actor": "invited",
        },
        body: JSON.stringify({ requestId: crypto.randomUUID(), token }),
      },
      environment
    )
    expect(result.status).toBe(200)
    expect(
      acceptedEventInvitationSchema.safeParse(await result.json()).success
    ).toBe(true)
  })
})
