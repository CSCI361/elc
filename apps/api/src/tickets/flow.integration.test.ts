import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"
import { createAuthTestDatabase } from "../auth/test-database"
import { startCheckout, replaceCheckout } from "../orders/checkout"
import { completeZeroTotalOrder } from "./issue"
import { readTicket } from "./read"
import { reverseCheckIn, scanOnline } from "./scan"

describe("D1 reservation, issuance and admission flow", () => {
  let database: Awaited<ReturnType<typeof createAuthTestDatabase>>
  let db: D1Database
  let now: number
  const clock = () => now
  const env = () => ({ DB: db, TICKET_ENCRYPTION_KEY: "A".repeat(43) })

  beforeEach(async () => {
    database = await createAuthTestDatabase()
    db = database.DB
    now = Date.now()
    for (const id of ["owner", "buyer", "other", "scanner"]) {
      await db
        .prepare(
          "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
        )
        .bind(id, id, `${id}@example.test`, now, now)
        .run()
    }
    await db
      .prepare(`INSERT INTO events (id, organizer_id, title, description, category, venue_name, venue_address,
      starts_at, ends_at, registration_opens_at, registration_closes_at, capacity, max_tickets_per_order,
      publication_state, calendar_uid, reporting_id, created_at, updated_at)
      VALUES ('event', 'owner', 'Test event', 'Description', 'Music', 'Hall', 'Address', ?, ?, ?, ?, 4, 4, 'published', 'event@elc', 'rpt_event000', ?, ?)`)
      .bind(
        now + 3600000,
        now + 7200000,
        now - 3600000,
        now + 3600000,
        now,
        now
      )
      .run()
    await db
      .prepare(`INSERT INTO ticket_types (id, event_id, name, kind, price_minor, quantity, sales_start_at, sales_end_at, updated_at)
      VALUES ('type', 'event', 'Free admission', 'free', 0, 4, ?, ?, ?)`)
      .bind(now - 3600000, now + 3600000, now)
      .run()
    for (let index = 0; index < 4; index++)
      await db
        .prepare(
          "INSERT INTO inventory (id, event_id, ticket_type_id) VALUES (?, 'event', 'type')"
        )
        .bind(`slot-${index}`)
        .run()
    for (const permission of ["ticket:scan", "checkin:reverse"])
      await db
        .prepare(
          "INSERT INTO event_permissions (user_id, event_id, permission, granted_at) VALUES ('scanner', 'event', ?, ?)"
        )
        .bind(permission, now)
        .run()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await database?.runtime.dispose()
  })

  const basket = (requestId = "reserve", quantity = 1) => ({
    requestId,
    eventId: "event",
    items: [
      {
        ticketTypeId: "type",
        quantity,
        attendeeNames: Array.from(
          { length: quantity },
          (_, index) => `Guest ${index + 1}`
        ),
      },
    ],
  })

  async function issue() {
    const checkout = await startCheckout(db, "buyer", basket(), { now: clock })
    const completed = await completeZeroTotalOrder(
      env(),
      "buyer",
      checkout.order.id,
      { requestId: "complete", expectedRevision: checkout.revision },
      { now: clock }
    )
    const delivered = await readTicket(
      env(),
      "buyer",
      completed.ticketIds[0]!,
      true
    )
    if (!delivered.credential) throw new Error("Missing delivered credential")
    return { checkout, completed, credential: delivered.credential }
  }

  it("reserves, issues one canonical credential, scans once, replays safely and allows an authorized reversal", async () => {
    const { checkout, completed, credential } = await issue()
    const input = { eventId: "event", operationId: "scan-1", credential }
    const first = await scanOnline(db, "scanner", input, { now: clock })
    expect(first.result).toBe("checked_in")
    expect(await scanOnline(db, "scanner", input, { now: clock })).toEqual(
      first
    )
    expect(
      (
        await scanOnline(
          db,
          "scanner",
          { ...input, operationId: "scan-2" },
          { now: clock }
        )
      ).result
    ).toBe("already_used")
    expect(
      await db
        .prepare("SELECT count(*) AS n FROM checkins WHERE reversed_at IS NULL")
        .first("n")
    ).toBe(1)
    await reverseCheckIn(
      db,
      "scanner",
      "event",
      first.checkInId!,
      { requestId: "undo", reason: "Guest stepped out before entry" },
      clock
    )
    expect(
      (
        await scanOnline(
          db,
          "scanner",
          { ...input, operationId: "scan-3" },
          { now: clock }
        )
      ).result
    ).toBe("checked_in")
    expect(
      await db.prepare("SELECT count(*) AS n FROM checkins").first("n")
    ).toBe(2)
    expect(
      await db
        .prepare("SELECT count(*) AS n FROM checkins WHERE reversed_at IS NULL")
        .first("n")
    ).toBe(1)
    expect(
      await completeZeroTotalOrder(
        env(),
        "buyer",
        checkout.order.id,
        { requestId: "complete", expectedRevision: checkout.revision },
        { now: clock }
      )
    ).toEqual(completed)
    await expect(
      db
        .prepare(
          "UPDATE orders SET refund_policy_json = json_set(refund_policy_json, '$.instructions', 'Changed') WHERE id = ?"
        )
        .bind(checkout.order.id)
        .run()
    ).rejects.toThrow()
  })

  it("commits one issuance when two completion retries arrive together", async () => {
    const checkout = await startCheckout(db, "buyer", basket("reserve", 2), {
      now: clock,
    })
    const input = { requestId: "complete", expectedRevision: checkout.revision }
    const outcomes = await Promise.all(
      [1, 2].map(() =>
        completeZeroTotalOrder(env(), "buyer", checkout.order.id, input, {
          now: clock,
        })
      )
    )
    expect(outcomes[0]).toEqual(outcomes[1])
    expect(
      await db.prepare("SELECT count(*) AS n FROM tickets").first("n")
    ).toBe(2)
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM outbox WHERE kind = 'order.completed'"
        )
        .first("n")
    ).toBe(1)
    expect(
      await db.prepare("SELECT count(*) AS n FROM transition_guards").first("n")
    ).toBe(0)
  })

  it("rolls back stale issuance after another tab replaces the basket", async () => {
    const checkout = await startCheckout(db, "buyer", basket(), { now: clock })
    await expect(
      completeZeroTotalOrder(
        env(),
        "buyer",
        checkout.order.id,
        { requestId: "complete", expectedRevision: checkout.revision },
        {
          now: clock,
          beforeCommit: async () => {
            await replaceCheckout(
              db,
              "buyer",
              checkout.order.id,
              { ...basket("replace", 2), expectedRevision: checkout.revision },
              { now: clock }
            )
          },
        }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(
      await db.prepare("SELECT count(*) AS n FROM tickets").first("n")
    ).toBe(0)
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM inventory WHERE reservation_id IS NOT NULL"
        )
        .first("n")
    ).toBe(2)
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM request_receipts WHERE request_id = 'complete'"
        )
        .first("n")
    ).toBe(0)
  })

  it("rechecks expiry and cancellation after credential preparation", async () => {
    const checkout = await startCheckout(db, "buyer", basket(), { now: clock })
    await expect(
      completeZeroTotalOrder(
        env(),
        "buyer",
        checkout.order.id,
        { requestId: "complete", expectedRevision: checkout.revision },
        {
          now: clock,
          beforeCommit: async () => {
            now += 600001
          },
        }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(
      await db.prepare("SELECT count(*) AS n FROM tickets").first("n")
    ).toBe(0)
    now -= 600001
    await expect(
      completeZeroTotalOrder(
        env(),
        "buyer",
        checkout.order.id,
        { requestId: "complete", expectedRevision: checkout.revision },
        {
          now: clock,
          beforeCommit: async () => {
            await db
              .prepare("UPDATE events SET cancelled_at = ? WHERE id = 'event'")
              .bind(now)
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(
      await db.prepare("SELECT count(*) AS n FROM tickets").first("n")
    ).toBe(0)
  })

  it("rechecks a lowered per-order limit and occupied capacity before issuing", async () => {
    const checkout = await startCheckout(db, "buyer", basket("reserve", 2), {
      now: clock,
    })
    await startCheckout(db, "other", basket("other", 1), { now: clock })
    for (const [requestId, mutation] of [
      [
        "limit",
        "UPDATE events SET max_tickets_per_order = 1 WHERE id = 'event'",
      ],
      [
        "event-capacity",
        "UPDATE events SET capacity = 2, max_tickets_per_order = 2 WHERE id = 'event'",
      ],
      [
        "type-capacity",
        "UPDATE ticket_types SET quantity = 1 WHERE id = 'type'",
      ],
    ]) {
      await expect(
        completeZeroTotalOrder(
          env(),
          "buyer",
          checkout.order.id,
          { requestId: requestId!, expectedRevision: checkout.revision },
          {
            now: clock,
            beforeCommit: async () => {
              await db.prepare(mutation!).run()
            },
          }
        )
      ).rejects.toMatchObject({ code: "CONFLICT" })
      await db
        .prepare(
          "UPDATE events SET capacity = 4, max_tickets_per_order = 4 WHERE id = 'event'"
        )
        .run()
      await db
        .prepare("UPDATE ticket_types SET quantity = 4 WHERE id = 'type'")
        .run()
    }
    expect(
      await db.prepare("SELECT count(*) AS n FROM tickets").first("n")
    ).toBe(0)
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM inventory WHERE reservation_id IS NOT NULL"
        )
        .first("n")
    ).toBe(3)
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM request_receipts WHERE request_id NOT IN ('reserve', 'other')"
        )
        .first("n")
    ).toBe(0)
  })

  it("executes production D1-clock guards for issuance and admission", async () => {
    const checkout = await startCheckout(db, "buyer", basket())
    const completed = await completeZeroTotalOrder(
      env(),
      "buyer",
      checkout.order.id,
      { requestId: "complete", expectedRevision: 0 }
    )
    const delivered = await readTicket(
      env(),
      "buyer",
      completed.ticketIds[0]!,
      true
    )
    if (!delivered.credential) throw new Error("Missing credential")
    expect(
      (
        await scanOnline(db, "scanner", {
          eventId: "event",
          operationId: "scan",
          credential: delivered.credential,
        })
      ).result
    ).toBe("checked_in")
  })

  it("rejects issuance against the database deadline even when the application clock is behind", async () => {
    now -= 600001
    const checkout = await startCheckout(db, "buyer", basket(), { now: clock })
    vi.spyOn(Date, "now").mockReturnValue(now)
    await expect(
      completeZeroTotalOrder(env(), "buyer", checkout.order.id, {
        requestId: "stale-clock",
        expectedRevision: 0,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(
      await db.prepare("SELECT count(*) AS n FROM tickets").first("n")
    ).toBe(0)
    expect(
      await db
        .prepare("SELECT state FROM orders WHERE id = ?")
        .bind(checkout.order.id)
        .first("state")
    ).toBe("pending")
  })

  it("allows an authorized correction after event end while further scans remain blocked", async () => {
    const { credential } = await issue()
    const first = await scanOnline(
      db,
      "scanner",
      { eventId: "event", operationId: "scan", credential },
      { now: clock }
    )
    now += 7200001
    await reverseCheckIn(
      db,
      "scanner",
      "event",
      first.checkInId!,
      {
        requestId: "correction",
        reason: "Correct an accidental staff scan after reconciliation.",
      },
      clock
    )
    expect(
      await db
        .prepare("SELECT count(*) AS n FROM checkins WHERE reversed_at IS NULL")
        .first("n")
    ).toBe(0)
    expect(
      (
        await scanOnline(
          db,
          "scanner",
          { eventId: "event", operationId: "late-scan", credential },
          { now: clock }
        )
      ).result
    ).toBe("admission_blocked")
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM audit_entries WHERE action = 'checkin.reversed'"
        )
        .first("n")
    ).toBe(1)
  })

  it("rechecks event end when it passes between scan lookup and commit", async () => {
    const { credential } = await issue()
    let advanced = false
    const response = await scanOnline(
      db,
      "scanner",
      { eventId: "event", operationId: "end-race", credential },
      {
        now: clock,
        beforeCommit: async () => {
          if (!advanced) {
            now += 7200001
            advanced = true
          }
        },
      }
    )
    expect(response.result).toBe("admission_blocked")
    expect(
      await db.prepare("SELECT count(*) AS n FROM checkins").first("n")
    ).toBe(0)
  })

  it("has one canonical admission under simultaneous independent scans", async () => {
    const { credential } = await issue()
    const results = await Promise.all(
      ["race-1", "race-2"].map((operationId) =>
        scanOnline(
          db,
          "scanner",
          { eventId: "event", operationId, credential },
          { now: clock }
        )
      )
    )
    expect(results.map((result) => result.result).sort()).toEqual([
      "already_used",
      "checked_in",
    ])
    expect(
      await db
        .prepare("SELECT count(*) AS n FROM checkins WHERE reversed_at IS NULL")
        .first("n")
    ).toBe(1)
  })

  it("does not admit when a refund blocks the order between lookup and commit", async () => {
    const { credential, checkout } = await issue()
    const result = await scanOnline(
      db,
      "scanner",
      { eventId: "event", operationId: "scan", credential },
      {
        now: clock,
        beforeCommit: async () => {
          await db
            .prepare("UPDATE orders SET admission_blocked_at = ? WHERE id = ?")
            .bind(now, checkout.order.id)
            .run()
        },
      }
    )
    expect(result.result).toBe("admission_blocked")
    expect(
      await db.prepare("SELECT count(*) AS n FROM checkins").first("n")
    ).toBe(0)
  })

  it("rejects revoked scan authority, unrelated downloads and reuse of a request identifier for a different credential", async () => {
    const { credential, completed } = await issue()
    await expect(
      readTicket(env(), "other", completed.ticketIds[0]!, true)
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      readTicket(env(), "scanner", completed.ticketIds[0]!, true)
    ).rejects.toMatchObject({ status: 403 })
    const input = { eventId: "event", operationId: "scan", credential }
    await scanOnline(db, "scanner", input, { now: clock })
    await expect(
      scanOnline(
        db,
        "scanner",
        { ...input, credential: { ...credential, token: "A".repeat(43) } },
        { now: clock }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
    await expect(
      scanOnline(
        db,
        "scanner",
        { ...input, operationId: "revoked" },
        {
          now: clock,
          beforeCommit: async () => {
            await db
              .prepare(
                "UPDATE event_permissions SET revoked_at = ? WHERE user_id = 'scanner'"
              )
              .bind(now)
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ status: 403 })
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM request_receipts WHERE request_id = 'revoked'"
        )
        .first("n")
    ).toBe(0)
  })
})
