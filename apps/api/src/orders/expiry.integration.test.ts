import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { createPaymentFixture } from "../payments/test-fixture"
import { processPayment, recordPaymentStatus } from "../payments/reconcile"
import { completePaidOrder } from "../tickets/issue"
import { startCheckout } from "./checkout"
import { abandonCheckout, expireReservations, readCheckout } from "./lifecycle"
import { expireReservationBatch, sweepExpiredReservations } from "./expiry"
import type { Bindings } from "../env"

describe("bounded reservation expiry on migrated D1", () => {
  let f: Awaited<ReturnType<typeof createPaymentFixture>>
  let db: D1Database
  let deadline: number
  beforeEach(async () => {
    f = await createPaymentFixture()
    db = f.db
    deadline = f.now + 600000
  })
  afterEach(async () => {
    await f?.runtime.dispose()
  })
  const sweep = (now = deadline) =>
    sweepExpiredReservations(f.env, { now: () => now })
  const n = (table: string, where = "1") =>
    f.scalar(`SELECT count(*) n FROM ${table} WHERE ${where}`)
  const state = () =>
    db
      .prepare(
        "SELECT o.state order_state,r.state reservation_state,o.revision FROM orders o JOIN reservations r ON r.order_id=o.id WHERE o.id=?"
      )
      .bind(f.checkout.order.id)
      .first()
  async function seedHolds(
    count: number,
    eventId = "event",
    createdAt = f.now
  ) {
    await db.batch([
      db.prepare("UPDATE events SET capacity=1000 WHERE id=?").bind(eventId),
      db
        .prepare("UPDATE ticket_types SET quantity=1000 WHERE event_id=?")
        .bind(eventId),
    ])
    for (let i = 0; i < count; i++) {
      const id = `${eventId}-hold-${i}`
      await db.batch([
        db
          .prepare(
            "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES (?, 'Backlog',?,1,?,?)"
          )
          .bind(id, `${id}@example.test`, createdAt, createdAt),
        db
          .prepare(`INSERT INTO orders(id,account_id,event_id,subtotal_minor,discount_minor,total_minor,processing_fee_basis_points,processing_fee_minor,refund_policy_version,refund_policy_json,created_at)
          SELECT ?,?,?,subtotal_minor,discount_minor,total_minor,processing_fee_basis_points,processing_fee_minor,refund_policy_version,refund_policy_json,? FROM orders WHERE id=?`)
          .bind(id, id, eventId, createdAt, f.checkout.order.id),
        db
          .prepare(
            "INSERT INTO reservations(id,order_id,account_id,event_id,created_at,expires_at) VALUES (?,?,?,?,?,?)"
          )
          .bind(id, id, id, eventId, createdAt, createdAt + 600000),
        db
          .prepare(
            "INSERT INTO inventory(id,event_id,ticket_type_id,reservation_id) VALUES (?,?,?,?)"
          )
          .bind(id, eventId, eventId === "event" ? "type" : "other-type", id),
        db
          .prepare(`INSERT INTO order_items(id,order_id,ticket_type_id,ticket_type_name,quantity,unit_price_minor,subtotal_minor,discount_minor,total_minor,attendees_json,seats_json)
          SELECT ?,?,?,ticket_type_name,quantity,unit_price_minor,subtotal_minor,discount_minor,total_minor,attendees_json,seats_json FROM order_items WHERE order_id=?`)
          .bind(
            id,
            id,
            eventId === "event" ? "type" : "other-type",
            f.checkout.order.id
          ),
      ])
    }
  }
  async function otherEvent() {
    await db.batch([
      db.prepare(`INSERT INTO events(id,organizer_id,title,description,category,venue_name,venue_address,starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,max_tickets_per_order,publication_state,calendar_uid,reporting_id,created_at,updated_at)
        SELECT 'other',organizer_id,title,description,category,venue_name,venue_address,starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,max_tickets_per_order,publication_state,'other-calendar','other-report',created_at,updated_at FROM events WHERE id='event'`),
      db.prepare(`INSERT INTO ticket_types(id,event_id,name,kind,price_minor,quantity,sales_start_at,sales_end_at,updated_at)
        SELECT 'other-type','other',name,kind,price_minor,quantity,sales_start_at,sales_end_at,updated_at FROM ticket_types WHERE id='type'`),
    ])
  }

  it("expires at the exact deadline once and preserves the pending provider attempt", async () => {
    expect(await sweep(deadline - 1)).toBe(0)
    expect(await state()).toMatchObject({
      order_state: "pending",
      reservation_state: "active",
      revision: 0,
    })
    expect(await sweep()).toBe(1)
    expect(await state()).toMatchObject({
      order_state: "expired",
      reservation_state: "expired",
      revision: 1,
    })
    expect(await n("inventory", "reservation_id IS NOT NULL")).toBe(0)
    expect(await n("audit_entries", "action='checkout.expired'")).toBe(1)
    expect(await n("request_receipts", "actor_id='system:expiry'")).toBe(1)
    expect(
      await db
        .prepare(
          "SELECT state,provider_payment_id FROM payment_attempts WHERE id=?"
        )
        .bind(f.paymentId)
        .first()
    ).toMatchObject({
      state: "pending",
      provider_payment_id: `checkout-${f.paymentId}`,
    })
    expect(await sweep(deadline + 1000)).toBe(0)
    expect(await n("audit_entries", "action='checkout.expired'")).toBe(1)
  })

  it("processes only 50 reservations per scheduled invocation and resumes the remainder", async () => {
    await seedHolds(55)
    expect(await sweep()).toBe(50)
    expect(await n("reservations", "state='active'")).toBe(6)
    expect(await n("orders", "state='expired'")).toBe(50)
    expect(await n("inventory", "reservation_id IS NOT NULL")).toBe(6)
    expect(await n("audit_entries", "action='checkout.expired'")).toBe(50)
    expect(await sweep()).toBe(6)
    expect(await sweep()).toBe(0)
    expect(await n("request_receipts", "actor_id='system:expiry'")).toBe(56)
  })

  it("drains lazy expiry in bounded transactions without touching another event", async () => {
    await otherEvent()
    await seedHolds(55)
    await seedHolds(2, "other", f.now - 1)
    expect(await expireReservations(db, "event", deadline)).toBe(56)
    expect(await n("reservations", "event_id='other' AND state='active'")).toBe(
      2
    )
    expect(
      await n("inventory", "event_id='other' AND reservation_id IS NOT NULL")
    ).toBe(2)
    expect(
      (await readCheckout(db, "buyer", f.checkout.order.id, deadline)).order
        .state
    ).toBe("expired")
    expect(await sweep()).toBe(2)
  })

  it("deduplicates overlapping scheduled batches selected before either commits", async () => {
    await seedHolds(55)
    let selected = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const beforeCommit = async () => {
      if (++selected === 2) release()
      await gate
    }
    const result = await Promise.all(
      [0, 1].map(() =>
        sweepExpiredReservations(f.env, { now: () => deadline, beforeCommit })
      )
    )
    expect(result.sort((a, b) => a - b)).toEqual([0, 50])
    expect(await n("audit_entries", "action='checkout.expired'")).toBe(50)
    expect(await n("request_receipts", "actor_id='system:expiry'")).toBe(50)
    expect(await sweep()).toBe(6)
  })

  it.each(["audit_entries", "request_receipts"])(
    "rolls back all expiry effects when %s rejects a write",
    async (table) => {
      const condition =
        table === "audit_entries"
          ? "NEW.action='checkout.expired'"
          : "NEW.actor_id='system:expiry'"
      await db
        .prepare(
          `CREATE TRIGGER reject_expiry BEFORE INSERT ON ${table} WHEN ${condition} BEGIN SELECT RAISE(ABORT,'expiry fixture failure'); END`
        )
        .run()
      await expect(sweep()).rejects.toThrow()
      expect(await state()).toMatchObject({
        order_state: "pending",
        reservation_state: "active",
        revision: 0,
      })
      expect(await n("inventory", "reservation_id IS NOT NULL")).toBe(1)
      expect(await n("audit_entries", "action='checkout.expired'")).toBe(0)
      expect(await n("request_receipts", "actor_id='system:expiry'")).toBe(0)
      await db.prepare("DROP TRIGGER reject_expiry").run()
      expect(await sweep()).toBe(1)
    }
  )

  it("recovers a lost batch acknowledgement without repeating expiry effects", async () => {
    const uncertain = new Proxy(db, {
      get(target, key) {
        if (key === "batch")
          return async (statements: D1PreparedStatement[]) => {
            await target.batch(statements)
            throw new Error("Lost committed acknowledgement")
          }
        const member = Reflect.get(target, key)
        return typeof member === "function" ? member.bind(target) : member
      },
    })
    await expect(
      sweepExpiredReservations({ DB: uncertain }, { now: () => deadline })
    ).rejects.toThrow("Lost committed acknowledgement")
    expect(await sweep()).toBe(0)
    expect(await state()).toMatchObject({
      order_state: "expired",
      reservation_state: "expired",
      revision: 1,
    })
    expect(await n("audit_entries", "action='checkout.expired'")).toBe(1)
  })

  it("does no database work while recovery is paused", async () => {
    const unavailable = new Proxy(db, {
      get() {
        throw new Error("Recovery must not access D1")
      },
    })
    expect(
      await sweepExpiredReservations({
        DB: unavailable,
        RECOVERY_MODE: "paused",
      })
    ).toBe(0)
    expect(await state()).toMatchObject({
      order_state: "pending",
      reservation_state: "active",
    })
  })

  it("checks the recovery gate again before committing selected work", async () => {
    const env: Pick<Bindings, "DB" | "RECOVERY_MODE"> = {
      DB: db,
      RECOVERY_MODE: "running",
    }
    expect(
      await sweepExpiredReservations(env, {
        now: () => deadline,
        beforeCommit: async () => {
          env.RECOVERY_MODE = "paused"
        },
      })
    ).toBe(0)
    expect(await n("audit_entries", "action='checkout.expired'")).toBe(0)
    expect(await state()).toMatchObject({
      order_state: "pending",
      reservation_state: "active",
    })
  })

  it("preserves a paid order that completes after selection but before expiry commits", async () => {
    f.provider.state = "succeeded"
    expect(
      await sweepExpiredReservations(f.env, {
        now: () => deadline,
        beforeCommit: async () => {
          expect(
            await processPayment(f.env, f.provider, f.paymentId, {
              now: () => deadline - 1,
            })
          ).toBe(true)
        },
      })
    ).toBe(0)
    expect(await state()).toMatchObject({
      order_state: "completed",
      reservation_state: "consumed",
    })
    expect(await n("tickets")).toBe(1)
    expect(await n("inventory", "order_id IS NOT NULL")).toBe(1)
    expect(await n("audit_entries", "action='checkout.expired'")).toBe(0)
    expect(f.provider.refunds).toHaveLength(0)
  })

  it("compensates a paid success when expiry wins before ticket issuance commits", async () => {
    f.provider.state = "succeeded"
    await recordPaymentStatus(db, f.provider.status(f.binding), deadline - 1)
    await expect(
      completePaidOrder(f.env, f.paymentId, {
        now: () => deadline - 1,
        beforeCommit: async () => {
          expect(await sweep()).toBe(1)
        },
      })
    ).rejects.toMatchObject({ status: 409 })
    expect(
      await processPayment(f.env, f.provider, f.paymentId, {
        now: () => deadline,
      })
    ).toBe(true)
    expect(
      await processPayment(f.env, f.provider, f.paymentId, {
        now: () => deadline,
      })
    ).toBe(true)
    expect(f.provider.refunds).toHaveLength(1)
    expect(await n("tickets")).toBe(0)
    expect(
      await n("inventory", "order_id IS NOT NULL OR reservation_id IS NOT NULL")
    ).toBe(0)
    expect(await n("refunds", "state='succeeded'")).toBe(1)
    expect(await state()).toMatchObject({
      order_state: "expired",
      reservation_state: "expired",
    })
  })

  it("preserves abandonment that wins after selection", async () => {
    expect(
      await sweepExpiredReservations(f.env, {
        now: () => deadline,
        beforeCommit: async () => {
          await abandonCheckout(
            db,
            "buyer",
            f.checkout.order.id,
            { requestId: "abandon-race", expectedRevision: 0 },
            deadline - 1
          )
        },
      })
    ).toBe(0)
    expect(await state()).toMatchObject({
      order_state: "abandoned",
      reservation_state: "abandoned",
    })
    expect(await n("audit_entries", "action='checkout.expired'")).toBe(0)
  })

  it("releases uncommitted promo capacity and preserves a live replacement hold", async () => {
    await db.batch([
      db
        .prepare(
          "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('promo-buyer','Promo','promo@example.test',1,?,?)"
        )
        .bind(f.now, f.now),
      db
        .prepare(
          "INSERT INTO campaigns(id,event_id,name,code,token_hash,reporting_id,discount_kind,discount_value,starts_at,ends_at,max_redemptions,enabled,updated_at) VALUES ('promo','event','Promo','EXPIRY','expiry-promo-token','expiry-promo-report','percentage',1000,?,?,1,1,?)"
        )
        .bind(f.now - 1000, f.now + 3600000, f.now),
      db.prepare(
        "INSERT INTO campaign_ticket_types(campaign_id,ticket_type_id) VALUES ('promo','type')"
      ),
    ])
    const input = {
      requestId: "promo-start",
      eventId: "event",
      promoCode: "EXPIRY",
      items: [
        { ticketTypeId: "type", quantity: 1, attendeeNames: ["Promo guest"] },
      ],
    }
    const first = await startCheckout(db, "promo-buyer", input, {
      now: () => f.now,
    })
    expect(await sweep()).toBe(2)
    expect(
      await n(
        "promo_allocations",
        "released_at IS NOT NULL AND committed_at IS NULL"
      )
    ).toBe(1)
    const replacement = await startCheckout(
      db,
      "promo-buyer",
      { ...input, requestId: "promo-replacement" },
      { now: () => deadline }
    )
    expect(replacement.order.id).not.toBe(first.order.id)
    expect(await sweep()).toBe(0)
    expect(
      await n(
        "promo_allocations",
        "released_at IS NULL AND committed_at IS NULL"
      )
    ).toBe(1)
    expect(await n("inventory", "reservation_id IS NOT NULL")).toBe(1)
  })

  it("uses indexes for selected expiry work and inventory release", async () => {
    const statements: { sql: string; values: unknown[] }[] = []
    const tracked = new Proxy(db, {
      get(target, key) {
        if (key === "prepare")
          return (sql: string) => {
            const statement = target.prepare(sql)
            return new Proxy(statement, {
              get(inner, member) {
                if (member === "bind")
                  return (...values: unknown[]) => {
                    statements.push({ sql, values })
                    return inner.bind(...values)
                  }
                const value = Reflect.get(inner, member)
                return typeof value === "function" ? value.bind(inner) : value
              },
            })
          }
        const member = Reflect.get(target, key)
        return typeof member === "function" ? member.bind(target) : member
      },
    })
    await expireReservationBatch(tracked, "event", deadline)
    await expireReservationBatch(tracked, undefined, deadline)
    const selected = statements.filter(
      ({ sql }) =>
        sql.startsWith("SELECT r.id") || sql.startsWith("UPDATE inventory")
    )
    expect(selected).toHaveLength(3)
    for (const statement of selected) {
      const plan = await db
        .prepare("EXPLAIN QUERY PLAN " + statement.sql)
        .bind(...statement.values)
        .all<{ detail: string }>()
      const details = plan.results.map((row) => row.detail).join("\n")
      expect(details).not.toMatch(/SCAN (r|o|inventory)\b|USE TEMP B-TREE/)
      expect(details).toContain(
        statement.sql.startsWith("UPDATE inventory")
          ? "inventory_reservation"
          : statement.sql.includes("r.event_id=?")
            ? "reservation_event_expiry"
            : "reservation_expiry"
      )
    }
  })
})
