import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { Hono } from "hono"
import { createAuthTestDatabase } from "../auth/test-database"
import { assertSql } from "../db/transitions"
import type { Bindings } from "../env"
import { startCheckout } from "../orders/checkout"
import { completeZeroTotalOrder } from "../tickets/issue"
import { createSupportRoutes } from "./index"
import {
  requireVoluntaryRefundSupport,
  supportCaseAccessSql,
  unresolvedOrderSupportSql,
  voluntaryRefundSupportSql,
} from "./guards"
import {
  listSupportCases,
  listSupportChanges,
  listSupportMessages,
  readSupportCase,
} from "./read"
import {
  addSupportMessage,
  assignSupportCase,
  changeSupportStatus,
  createSupportCase,
} from "./service"

describe("support cases and durable history on D1", () => {
  let database: Awaited<ReturnType<typeof createAuthTestDatabase>>
  let db: D1Database
  let now: number
  const clock = () => now
  beforeEach(async () => {
    database = await createAuthTestDatabase()
    db = database.DB
    now = Date.now()
    await db.batch(
      [
        "owner",
        "owner2",
        "buyer",
        "other",
        "support",
        "scanner",
        "refunder",
        "platform",
        "moderator",
        "unverified",
      ].map((id) =>
        db
          .prepare(
            "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .bind(
            id,
            id,
            `${id}@example.test`,
            id === "unverified" ? 0 : 1,
            now,
            now
          )
      )
    )
    for (const [id, owner, visibility] of [
      ["event", "owner", "public"],
      ["other-event", "owner2", "public"],
      ["private", "owner", "private"],
    ]) {
      await db
        .prepare(`INSERT INTO events (id, organizer_id, title, description, category, venue_name, venue_address, starts_at, ends_at,
        registration_opens_at, registration_closes_at, capacity, max_tickets_per_order, visibility, publication_state, calendar_uid, reporting_id, created_at, updated_at)
        VALUES (?, ?, 'Support fixture', 'Description', 'Education', 'Hall', 'Address', ?, ?, ?, ?, 10, 6, ?, 'published', ?, ?, ?, ?)`)
        .bind(
          id,
          owner,
          now + 3600000,
          now + 7200000,
          now - 3600000,
          now + 3600000,
          visibility,
          `${id}@elc`,
          `rpt_${id}`,
          now,
          now
        )
        .run()
      await db
        .prepare(
          "INSERT INTO ticket_types (id, event_id, name, kind, price_minor, quantity, sales_start_at, sales_end_at, updated_at) VALUES (?, ?, 'Free', 'free', 0, 10, ?, ?, ?)"
        )
        .bind(`${id}-type`, id, now - 3600000, now + 3600000, now)
        .run()
      await db.batch(
        Array.from({ length: 10 }, (_, i) =>
          db
            .prepare(
              "INSERT INTO inventory (id, event_id, ticket_type_id) VALUES (?, ?, ?)"
            )
            .bind(`${id}-slot-${i}`, id, `${id}-type`)
        )
      )
    }
    await db.batch([
      ...[
        ["support", "support:manage"],
        ["scanner", "ticket:scan"],
        ["refunder", "refund:initiate"],
      ].map(([actor, permission]) =>
        db
          .prepare(
            "INSERT INTO event_permissions (event_id, user_id, permission, granted_at) VALUES ('event', ?, ?, ?)"
          )
          .bind(actor, permission, now)
      ),
      db
        .prepare(
          "INSERT INTO platform_grants (user_id, permission, granted_at) VALUES ('platform', 'platform:support', ?)"
        )
        .bind(now),
      db
        .prepare(
          "INSERT INTO platform_grants (user_id, permission, granted_at) VALUES ('moderator', 'platform:moderate', ?)"
        )
        .bind(now),
    ])
  })
  afterEach(async () => {
    await database?.runtime.dispose()
  })

  const input = (overrides: Record<string, unknown> = {}) => ({
    requestId: crypto.randomUUID(),
    audience: "attendee",
    category: "event_information",
    subject: "Venue access",
    eventId: "event",
    body: "Where is the accessible entrance?",
    ...overrides,
  })
  const open = (overrides: Record<string, unknown> = {}, actor = "buyer") =>
    createSupportCase(db, actor, input(overrides), { now: clock })
  async function count(table: string, where = "1 = 1") {
    return (await db
      .prepare(`SELECT count(*) AS count FROM ${table} WHERE ${where}`)
      .first<{ count: number }>())!.count
  }
  async function issued(actor = "buyer", eventId = "event") {
    const order = await startCheckout(
      db,
      actor,
      {
        requestId: crypto.randomUUID(),
        eventId,
        items: [
          {
            ticketTypeId: `${eventId}-type`,
            quantity: 1,
            attendeeNames: ["Named guest"],
          },
        ],
      },
      { now: clock }
    )
    const complete = await completeZeroTotalOrder(
      { DB: db, TICKET_ENCRYPTION_KEY: "A".repeat(43) },
      actor,
      order.order.id,
      { requestId: crypto.randomUUID(), expectedRevision: order.revision },
      { now: clock }
    )
    return { orderId: order.order.id, ticketId: complete.ticketIds[0]! }
  }
  function barrier() {
    let arrived = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    return async () => {
      if (++arrived === 2) release()
      await gate
    }
  }
  async function matches(guard: { predicate: string; bindings: unknown[] }) {
    return Boolean(
      await db
        .prepare(`SELECT 1 WHERE ${guard.predicate}`)
        .bind(...guard.bindings)
        .first()
    )
  }

  it("derives canonical order/event context from an issued ticket and commits one history, audit and two jobs", async () => {
    const { orderId, ticketId } = await issued()
    const opened = await open({
      eventId: undefined,
      ticketId,
      category: "ticket_delivery",
    })
    expect(opened.case).toMatchObject({
      requesterId: "buyer",
      eventId: "event",
      orderId,
      ticketId,
      revision: 1,
      lastSequence: 1,
      status: "open",
    })
    expect(opened.change).toMatchObject({
      kind: "created",
      sequence: 1,
      before: null,
      message: { authorId: "buyer", body: "Where is the accessible entrance?" },
    })
    expect(await count("support_messages")).toBe(1)
    expect(await count("support_case_changes")).toBe(1)
    expect(await count("audit_entries", "action LIKE 'support.%'")).toBe(1)
    const jobs = (
      await db
        .prepare(
          "SELECT * FROM outbox WHERE kind LIKE 'support.%' ORDER BY kind"
        )
        .all<{
          kind: string
          payload_json: string
          completed_at: number | null
        }>()
    ).results
    expect(jobs.map((job) => job.kind)).toEqual([
      "support.live",
      "support.notify",
    ])
    for (const job of jobs) {
      expect(JSON.parse(job.payload_json)).toEqual({
        caseId: opened.case.id,
        changeId: opened.change.id,
        sequence: 1,
      })
      expect(job.payload_json).not.toContain("accessible entrance")
      expect(job.completed_at).toBeNull()
    }
  })

  it("rejects foreign orders, mismatched ticket contexts and event-only private access at creation", async () => {
    const owned = await issued()
    const foreign = await issued("other")
    for (const overrides of [
      { orderId: foreign.orderId },
      { ticketId: foreign.ticketId },
      { ticketId: owned.ticketId, orderId: foreign.orderId },
      { orderId: owned.orderId, eventId: "other-event" },
      { eventId: "private" },
    ])
      await expect(open(overrides)).rejects.toMatchObject({ status: 404 })
    await expect(open({ eventId: undefined })).rejects.toMatchObject({
      status: 400,
    })
    await expect(open({ category: "refund" })).rejects.toMatchObject({
      status: 400,
    })
    await expect(open({}, "unverified")).rejects.toMatchObject({ status: 403 })
    expect(await count("support_cases")).toBe(0)
  })

  it("separates requester/support access from scanner, unrelated event and refund-only grants", async () => {
    const opened = await open()
    for (const actor of ["buyer", "owner", "support", "platform", "moderator"])
      expect((await readSupportCase(db, actor, opened.case.id)).case.id).toBe(
        opened.case.id
      )
    for (const actor of ["other", "owner2", "scanner", "refunder"]) {
      await expect(
        readSupportCase(db, actor, opened.case.id)
      ).rejects.toMatchObject({ status: 404 })
      await expect(
        listSupportMessages(db, actor, opened.case.id)
      ).rejects.toMatchObject({ status: 404 })
      await expect(
        listSupportChanges(db, actor, opened.case.id)
      ).rejects.toMatchObject({ status: 404 })
      expect(
        (await listSupportCases(db, actor, { view: "staff" })).items
      ).toEqual([])
    }
    expect(
      (await readSupportCase(db, "buyer", opened.case.id)).permissions.canManage
    ).toBe(false)
    await expect(
      changeSupportStatus(db, "buyer", opened.case.id, {
        requestId: "requester-status",
        expectedRevision: 1,
        status: "resolved",
      })
    ).rejects.toMatchObject({ status: 404 })
  })

  it("keeps organizer-platform conversations private even with event/order context", async () => {
    const order = await issued()
    const opened = await open(
      {
        audience: "organizer_platform",
        category: "payment",
        subject: "Private payout question",
        body: "Private bank simulation question",
        orderId: order.orderId,
      },
      "owner"
    )
    for (const actor of ["owner", "platform", "moderator"])
      expect((await readSupportCase(db, actor, opened.case.id)).case.id).toBe(
        opened.case.id
      )
    for (const actor of ["buyer", "support", "scanner", "refunder", "owner2"])
      await expect(
        readSupportCase(db, actor, opened.case.id)
      ).rejects.toMatchObject({ status: 404 })
    await expect(
      open({ audience: "organizer_platform" }, "support")
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      assignSupportCase(db, "owner", opened.case.id, {
        requestId: "owner-assign",
        expectedRevision: 1,
        assigneeId: "support",
      })
    ).rejects.toMatchObject({ status: 404 })
    const audit = await db
      .prepare(
        "SELECT event_id, scope, description FROM audit_entries WHERE entity_id = ?"
      )
      .bind(opened.case.id)
      .first()
    expect(audit).toEqual({
      event_id: null,
      scope: "platform",
      description: "Support case created recorded.",
    })
    const general = await open(
      {
        audience: "organizer_platform",
        eventId: undefined,
        category: "account",
      },
      "owner"
    )
    expect(general.case.eventId).toBeNull()
  })

  it("permits refund-only action on a validated request without granting conversation access", async () => {
    const order = await issued()
    const other = await issued("other")
    const opened = await open({ orderId: order.orderId, category: "refund" })
    expect(opened.case.payoutHeld).toBe(true)
    for (const actor of ["owner", "refunder"])
      await expect(
        requireVoluntaryRefundSupport(db, actor, opened.case.id, order.orderId)
      ).resolves.toHaveProperty("predicate")
    for (const actor of ["buyer", "support", "platform", "scanner", "owner2"])
      expect(
        await matches(
          voluntaryRefundSupportSql(actor, opened.case.id, order.orderId)
        )
      ).toBe(false)
    await expect(
      readSupportCase(db, "refunder", opened.case.id)
    ).rejects.toMatchObject({ status: 404 })
    expect(
      await matches(
        voluntaryRefundSupportSql("owner", opened.case.id, other.orderId)
      )
    ).toBe(false)
    const guard = voluntaryRefundSupportSql(
      "refunder",
      opened.case.id,
      order.orderId
    )
    await db
      .prepare(
        "UPDATE event_permissions SET revoked_at = ? WHERE user_id = 'refunder'"
      )
      .bind(now)
      .run()
    await expect(
      db.batch(assertSql(db, guard.predicate, guard.bindings))
    ).rejects.toThrow("transition_guard_valid")
    await changeSupportStatus(
      db,
      "owner",
      opened.case.id,
      { requestId: "resolve", expectedRevision: 1, status: "resolved" },
      { now: clock }
    )
    expect(
      await matches(
        voluntaryRefundSupportSql("owner", opened.case.id, order.orderId)
      )
    ).toBe(false)
    expect(await matches(unresolvedOrderSupportSql(order.orderId))).toBe(false)
    const question = await open({ orderId: order.orderId, category: "payment" })
    expect(question.case.payoutHeld).toBe(false)
    for (const category of ["dispute", "compensation"]) {
      const held = await open({ orderId: order.orderId, category })
      expect(held.case.payoutHeld).toBe(true)
      expect(await matches(unresolvedOrderSupportSql(order.orderId))).toBe(true)
      expect(
        await matches(
          voluntaryRefundSupportSql("owner", held.case.id, order.orderId)
        )
      ).toBe(false)
    }
  })

  it("commits concurrent identical creates once and rejects changed reuse of the request ID", async () => {
    const body = input({ requestId: "same-request" })
    const beforeCommit = barrier()
    const results = await Promise.all([
      createSupportCase(db, "buyer", body, { now: clock, beforeCommit }),
      createSupportCase(db, "buyer", body, { now: clock, beforeCommit }),
    ])
    expect(results[0]).toEqual(results[1])
    expect(await count("support_cases")).toBe(1)
    expect(await count("support_messages")).toBe(1)
    expect(await count("outbox", "kind LIKE 'support.%'")).toBe(2)
    await expect(
      createSupportCase(db, "buyer", { ...body, body: "Changed message" })
    ).rejects.toMatchObject({ status: 409 })
  })

  it("uses compare-and-swap for concurrent replies and replays the winning operation without duplication", async () => {
    const opened = await open()
    const beforeCommit = barrier()
    const inputs = ["first", "second"].map((body) => ({
      requestId: body,
      expectedRevision: 1,
      body,
    }))
    const results = await Promise.allSettled(
      inputs.map((body) =>
        addSupportMessage(db, "buyer", opened.case.id, body, {
          now: clock,
          beforeCommit,
        })
      )
    )
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1)
    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(1)
    const winner = results.findIndex((result) => result.status === "fulfilled")
    const retried = await addSupportMessage(
      db,
      "buyer",
      opened.case.id,
      inputs[winner]!,
      { now: clock }
    )
    expect(retried.case.revision).toBe(2)
    expect(await count("support_messages")).toBe(2)
    expect(await count("support_case_changes")).toBe(2)
    expect(await count("outbox", "kind LIKE 'support.%'")).toBe(4)
  })

  it("rejects staff or assignee revocation at commit and does not let an old assignment preserve access", async () => {
    const opened = await open()
    await expect(
      addSupportMessage(
        db,
        "support",
        opened.case.id,
        { requestId: "revoked-reply", expectedRevision: 1, body: "Reply" },
        {
          now: clock,
          beforeCommit: async () => {
            await db
              .prepare(
                "UPDATE event_permissions SET revoked_at = ? WHERE user_id = 'support'"
              )
              .bind(now)
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ status: 409 })
    expect(await count("support_messages")).toBe(1)
    await db
      .prepare(
        "UPDATE event_permissions SET revoked_at = NULL WHERE user_id = 'support'"
      )
      .run()
    await expect(
      assignSupportCase(
        db,
        "owner",
        opened.case.id,
        {
          requestId: "revoked-assignee",
          expectedRevision: 1,
          assigneeId: "support",
        },
        {
          now: clock,
          beforeCommit: async () => {
            await db
              .prepare(
                "UPDATE event_permissions SET revoked_at = ? WHERE user_id = 'support'"
              )
              .bind(now)
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ status: 409 })
    await db
      .prepare(
        "UPDATE event_permissions SET revoked_at = NULL WHERE user_id = 'support'"
      )
      .run()
    await assignSupportCase(
      db,
      "owner",
      opened.case.id,
      { requestId: "assign", expectedRevision: 1, assigneeId: "support" },
      { now: clock }
    )
    await db
      .prepare(
        "UPDATE event_permissions SET revoked_at = ? WHERE user_id = 'support'"
      )
      .bind(now)
      .run()
    expect(
      (await listSupportCases(db, "support", { view: "assigned" })).items
    ).toEqual([])
    expect(await matches(supportCaseAccessSql("support", opened.case.id))).toBe(
      false
    )
    await expect(
      addSupportMessage(db, "support", opened.case.id, {
        requestId: "revoked-reply",
        expectedRevision: 1,
        body: "Reply",
      })
    ).rejects.toMatchObject({ status: 404 })
  })

  it("rechecks accepted private invitations and requester suspension at creation/message commit", async () => {
    await db
      .prepare(
        "INSERT INTO invitations (id, event_id, email, token_hash, expires_at, accepted_by, accepted_at, created_at) VALUES ('invite', 'private', 'buyer@example.test', 'private-hash', ?, 'buyer', ?, ?)"
      )
      .bind(now + 3600000, now - 1, now - 100)
      .run()
    await expect(
      createSupportCase(db, "buyer", input({ eventId: "private" }), {
        now: clock,
        beforeCommit: async () => {
          await db
            .prepare(
              "UPDATE invitations SET revoked_at = ? WHERE id = 'invite'"
            )
            .bind(now)
            .run()
        },
      })
    ).rejects.toMatchObject({ status: 409 })
    const opened = await open()
    await expect(
      addSupportMessage(
        db,
        "buyer",
        opened.case.id,
        { requestId: "suspended", expectedRevision: 1, body: "Reply" },
        {
          now: clock,
          beforeCommit: async () => {
            await db
              .prepare(
                "INSERT INTO profiles (user_id, suspended_at, updated_at) VALUES ('buyer', ?, ?)"
              )
              .bind(now, now)
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ status: 409 })
    expect(await count("support_cases")).toBe(1)
    expect(await count("support_messages")).toBe(1)
  })

  it("paginates messages and every case change through a stable sequential catch-up boundary", async () => {
    const opened = await open()
    const id = opened.case.id
    await addSupportMessage(
      db,
      "support",
      id,
      { requestId: "reply", expectedRevision: 1, body: "First staff reply" },
      { now: clock }
    )
    await assignSupportCase(
      db,
      "owner",
      id,
      { requestId: "assign", expectedRevision: 2, assigneeId: "support" },
      { now: clock }
    )
    await changeSupportStatus(
      db,
      "support",
      id,
      {
        requestId: "waiting",
        expectedRevision: 3,
        status: "waiting_for_customer",
      },
      { now: clock }
    )
    await addSupportMessage(
      db,
      "buyer",
      id,
      { requestId: "answer", expectedRevision: 4, body: "Customer answer" },
      { now: clock }
    )
    await changeSupportStatus(
      db,
      "support",
      id,
      { requestId: "resolved", expectedRevision: 5, status: "resolved" },
      { now: clock }
    )
    const changes = []
    for (const after of [0, 2, 4]) {
      const page = await listSupportChanges(db, "buyer", id, {
        after,
        limit: 2,
      })
      expect(page.throughSequence).toBe(6)
      expect(page.caseRevision).toBe(6)
      changes.push(...page.items)
      expect(page.nextCursor).toBe(after === 4 ? null : after + 2)
    }
    expect(changes.map((change) => change.kind)).toEqual([
      "created",
      "message",
      "assignment",
      "status",
      "message",
      "status",
    ])
    expect(changes.map((change) => change.sequence)).toEqual([1, 2, 3, 4, 5, 6])
    const messages = await listSupportMessages(db, "buyer", id, { limit: 2 })
    expect(messages.items.map((message) => message.sequence)).toEqual([1, 2])
    expect(messages.nextCursor).toBe(2)
    expect(
      (await listSupportMessages(db, "buyer", id, { after: 2 })).items.map(
        (message) => message.sequence
      )
    ).toEqual([5])
    await expect(
      addSupportMessage(db, "buyer", id, {
        requestId: "closed-reply",
        expectedRevision: 6,
        body: "More",
      })
    ).rejects.toMatchObject({ status: 409 })
    await changeSupportStatus(
      db,
      "support",
      id,
      { requestId: "reopen", expectedRevision: 6, status: "in_progress" },
      { now: clock }
    )
    expect((await readSupportCase(db, "buyer", id)).case.resolvedAt).toBeNull()
    expect(
      (await listSupportChanges(db, "buyer", id, { after: 6 })).items[0]!
        .sequence
    ).toBe(7)
  })

  it("paginates filtered case lists without duplicates and rejects cursors from another account or filter", async () => {
    const opened = await Promise.all([open(), open(), open()])
    const first = await listSupportCases(db, "buyer", { limit: 2 })
    const second = await listSupportCases(db, "buyer", {
      limit: 2,
      cursor: first.nextCursor!,
    })
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id))
    ).toEqual(new Set(opened.map((item) => item.case.id)))
    expect(second.nextCursor).toBeNull()
    await expect(
      listSupportCases(db, "other", { cursor: first.nextCursor! })
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      listSupportCases(db, "buyer", {
        cursor: first.nextCursor!,
        status: "open",
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(
      (
        await listSupportCases(db, "support", {
          view: "staff",
          eventId: "event",
        })
      ).items
    ).toHaveLength(3)
  })

  it("rolls back case, message, history, audit and receipt when either outbox insertion fails", async () => {
    await db
      .prepare(
        "CREATE TRIGGER support_test_delivery_failure BEFORE INSERT ON outbox WHEN NEW.kind = 'support.live' BEGIN SELECT RAISE(ABORT, 'test support delivery failure'); END"
      )
      .run()
    await expect(open({ requestId: "atomic-failure" })).rejects.toThrow(
      "test support delivery failure"
    )
    for (const table of [
      "support_cases",
      "support_messages",
      "support_case_changes",
      "audit_entries",
      "request_receipts",
      "outbox",
    ])
      expect(await count(table)).toBe(0)
  })

  it("rejects history edits and cross-case message links, and exposes no edit/delete route", async () => {
    const opened = await open()
    const another = await open()
    await expect(
      db
        .prepare("UPDATE support_messages SET body = 'Edited' WHERE id = ?")
        .bind(opened.change.message!.id)
        .run()
    ).rejects.toThrow("support_message_immutable")
    await expect(
      db
        .prepare(
          "UPDATE support_case_changes SET actor_id = 'other' WHERE id = ?"
        )
        .bind(opened.change.id)
        .run()
    ).rejects.toThrow("support_change_immutable")
    await expect(
      db
        .prepare(
          "UPDATE support_cases SET event_id = 'other-event' WHERE id = ?"
        )
        .bind(opened.case.id)
        .run()
    ).rejects.toThrow("support_case_immutable")
    await expect(
      db
        .prepare(
          "UPDATE audit_entries SET description = 'Edited' WHERE entity_id = ?"
        )
        .bind(opened.case.id)
        .run()
    ).rejects.toThrow("support_audit_immutable")
    await expect(
      db.batch([
        db
          .prepare(
            "UPDATE support_cases SET revision = 2, last_sequence = 2 WHERE id = ?"
          )
          .bind(opened.case.id),
        db
          .prepare(
            "INSERT INTO support_case_changes (id, case_id, sequence, actor_id, kind, message_id, before_json, after_json, created_at) VALUES ('bad-link', ?, 2, 'buyer', 'message', ?, ?, ?, ?)"
          )
          .bind(
            opened.case.id,
            another.change.message!.id,
            JSON.stringify({ status: "open", assigneeId: null }),
            JSON.stringify({ status: "open", assigneeId: null }),
            now
          ),
      ])
    ).rejects.toThrow("support_change_scope")
    const routes = new Hono<{ Bindings: Bindings }>().route(
      "/api",
      createSupportRoutes({ identify: async () => "buyer" })
    )
    const env = { DB: db } as Bindings
    expect(
      (
        await routes.request(
          `/api/support/cases/${opened.case.id}/messages/${opened.change.message!.id}`,
          { method: "DELETE" },
          env
        )
      ).status
    ).toBe(404)
    expect(
      (
        await routes.request(
          `/api/support/cases/${opened.case.id}/changes`,
          {},
          env
        )
      ).status
    ).toBe(200)
    expect(
      (await readSupportCase(db, "buyer", opened.case.id)).case.revision
    ).toBe(1)
  })
})
