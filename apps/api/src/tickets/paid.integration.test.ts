import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { createAuthTestDatabase } from "../auth/test-database"
import { startCheckout, replaceCheckout } from "../orders/checkout"
import { expireReservations } from "../orders/lifecycle"
import { completePaidOrder, completeZeroTotalOrder } from "./issue"

describe("D1 canonical issuance from recorded paid orders", () => {
  let fixture: Awaited<ReturnType<typeof createAuthTestDatabase>>
  let db: D1Database
  let now: number
  const clock = () => now
  const env = () => ({ DB: db, TICKET_ENCRYPTION_KEY: "A".repeat(43) })
  const basket = (requestId: string, quantity = 1) => ({
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
  const count = (table: string) =>
    db.prepare(`SELECT count(*) AS n FROM ${table}`).first<number>("n")

  beforeEach(async () => {
    fixture = await createAuthTestDatabase()
    db = fixture.DB
    now = Date.now()
    for (const id of ["owner", "buyer", "other"])
      await db
        .prepare(
          "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
        )
        .bind(id, id, `${id}@example.test`, now, now)
        .run()
    await db
      .prepare(`INSERT INTO events (id, organizer_id, title, description, category, venue_name, venue_address,
      starts_at, ends_at, registration_opens_at, registration_closes_at, capacity, max_tickets_per_order,
      publication_state, paid_sales_state, calendar_uid, reporting_id, created_at, updated_at)
      VALUES ('event', 'owner', 'Paid test', 'Description', 'Music', 'Hall', 'Address', ?, ?, ?, ?, 4, 4, 'published', 'active', 'calendar', 'report', ?, ?)`)
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
      .prepare(
        "INSERT INTO ticket_types (id, event_id, name, kind, price_minor, quantity, sales_start_at, sales_end_at, updated_at) VALUES ('type', 'event', 'Paid admission', 'paid', 300000, 4, ?, ?, ?)"
      )
      .bind(now - 3600000, now + 3600000, now)
      .run()
    for (let index = 0; index < 4; index++)
      await db
        .prepare(
          "INSERT INTO inventory (id, event_id, ticket_type_id) VALUES (?, 'event', 'type')"
        )
        .bind(`slot-${index}`)
        .run()
  })

  afterEach(async () => {
    await fixture?.runtime.dispose()
  })

  async function paymentFor(
    checkout: Awaited<ReturnType<typeof startCheckout>>,
    state = "succeeded",
    attach = true,
    successTimestamp: number | null = state === "succeeded" ? now : null
  ) {
    const id = crypto.randomUUID()
    await db
      .prepare(`INSERT INTO payment_attempts (id, purpose, subject_id, state, provider, provider_payment_id, idempotency_key, amount_minor, currency, created_at, succeeded_at)
      VALUES (?, 'ticket_order', ?, ?, 'polar_sandbox', ?, ?, ?, 'KZT', ?, ?)`)
      .bind(
        id,
        checkout.order.id,
        state,
        `provider-${id}`,
        id,
        checkout.order.totalMinor,
        now,
        successTimestamp
      )
      .run()
    if (attach)
      await db
        .prepare("UPDATE reservations SET payment_attempt_id = ? WHERE id = ?")
        .bind(id, checkout.reservation.id)
        .run()
    return id
  }

  async function reserveAndPay(quantity = 1) {
    const checkout = await startCheckout(
      db,
      "buyer",
      basket("reserve", quantity),
      { now: clock }
    )
    return { checkout, paymentId: await paymentFor(checkout) }
  }

  it("issues one paid basket and one outbox job under concurrent retries without changing the payment fact", async () => {
    const { checkout, paymentId } = await reserveAndPay(2)
    const before = await db
      .prepare("SELECT * FROM payment_attempts WHERE id = ?")
      .bind(paymentId)
      .first()
    const results = await Promise.all(
      [1, 2].map(() => completePaidOrder(env(), paymentId, { now: clock }))
    )
    expect(results[0]).toEqual(results[1])
    expect(results[0]?.ticketIds).toHaveLength(2)
    expect(await count("tickets")).toBe(2)
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM outbox WHERE kind = 'order.completed'"
        )
        .first("n")
    ).toBe(1)
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM request_receipts WHERE actor_id = 'system:paid-issuance' AND request_id = ?"
        )
        .bind(paymentId)
        .first("n")
    ).toBe(1)
    expect(
      await db
        .prepare("SELECT * FROM payment_attempts WHERE id = ?")
        .bind(paymentId)
        .first()
    ).toEqual(before)
    expect(await completePaidOrder(env(), paymentId, { now: clock })).toEqual(
      results[0]
    )
    expect(
      await db
        .prepare("SELECT state FROM reservations WHERE id = ?")
        .bind(checkout.reservation.id)
        .first("state")
    ).toBe("consumed")
    expect(await count("transition_guards")).toBe(0)
  })

  it("keeps paid and zero-total entry points separate while sharing canonical issuance", async () => {
    const { checkout, paymentId } = await reserveAndPay()
    const results = await Promise.allSettled([
      completePaidOrder(env(), paymentId, { now: clock }),
      completeZeroTotalOrder(
        env(),
        "buyer",
        checkout.order.id,
        { requestId: "zero", expectedRevision: 0 },
        { now: clock }
      ),
    ])
    expect(results[0]?.status).toBe("fulfilled")
    expect(results[1]?.status).toBe("rejected")
    expect(await count("tickets")).toBe(1)
    await db
      .prepare(
        "UPDATE ticket_types SET kind = 'free', price_minor = 0 WHERE id = 'type'"
      )
      .run()
    const free = await startCheckout(db, "other", basket("free"), {
      now: clock,
    })
    const issued = await completeZeroTotalOrder(
      env(),
      "other",
      free.order.id,
      { requestId: "complete-free", expectedRevision: 0 },
      { now: clock }
    )
    expect(issued.ticketIds).toHaveLength(1)
    expect(await count("tickets")).toBe(2)
    expect(await count("payment_attempts")).toBe(1)
  })

  it("never reclaims the last place after its paid hold expires and another buyer completes", async () => {
    await db.prepare("DELETE FROM inventory WHERE id <> 'slot-0'").run()
    const { checkout, paymentId } = await reserveAndPay()
    now += 600001
    await expireReservations(db, "event", now)
    const replacement = await startCheckout(db, "other", basket("other"), {
      now: clock,
    })
    const replacementPayment = await paymentFor(replacement)
    await completePaidOrder(env(), replacementPayment, { now: clock })
    await expect(
      completePaidOrder(env(), paymentId, { now: clock })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(await count("tickets")).toBe(1)
    expect(
      await db
        .prepare("SELECT order_id FROM inventory WHERE id = 'slot-0'")
        .first("order_id")
    ).toBe(replacement.order.id)
    expect(
      await db
        .prepare("SELECT state FROM payment_attempts WHERE id = ?")
        .bind(paymentId)
        .first("state")
    ).toBe("succeeded")
    expect(
      await db
        .prepare("SELECT count(*) AS n FROM tickets WHERE order_id = ?")
        .bind(checkout.order.id)
        .first("n")
    ).toBe(0)
  })

  it.each(["pending", "failed", "cancelled"])(
    "rejects a %s payment without changing its financial state",
    async (state) => {
      const checkout = await startCheckout(db, "buyer", basket("reserve"), {
        now: clock,
      })
      const paymentId = await paymentFor(checkout, state)
      await expect(
        completePaidOrder(env(), paymentId, { now: clock })
      ).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" })
      expect(await count("tickets")).toBe(0)
      expect(
        await db
          .prepare("SELECT state FROM payment_attempts WHERE id = ?")
          .bind(paymentId)
          .first("state")
      ).toBe(state)
    }
  )

  it("requires the exact attempt attached to the reservation and a recorded success timestamp", async () => {
    const checkout = await startCheckout(db, "buyer", basket("reserve"), {
      now: clock,
    })
    const paymentId = await paymentFor(checkout, "succeeded", false)
    await expect(
      completePaidOrder(env(), paymentId, { now: clock })
    ).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" })
    await db
      .prepare("UPDATE reservations SET payment_attempt_id = ? WHERE id = ?")
      .bind(paymentId, checkout.reservation.id)
      .run()
    const other = await startCheckout(db, "other", basket("other"), {
      now: clock,
    })
    const missingTimestamp = await paymentFor(other, "succeeded", true, null)
    await expect(
      completePaidOrder(env(), missingTimestamp, { now: clock })
    ).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" })
    expect(await count("tickets")).toBe(0)
  })

  it.each([
    "cancelled",
    "expired",
    "refund_pending",
    "refund_succeeded",
    "refund_failed",
    "refunded",
    "blocked",
    "paid_sales_suspended",
    "account_unverified",
    "revision_changed",
    "type_reclassified",
  ])(
    "rolls issuance back when %s becomes true during credential preparation",
    async (condition) => {
      const { checkout, paymentId } = await reserveAndPay()
      await expect(
        completePaidOrder(env(), paymentId, {
          now: clock,
          beforeCommit: async () => {
            if (condition === "cancelled")
              await db
                .prepare(
                  "UPDATE events SET cancelled_at = ? WHERE id = 'event'"
                )
                .bind(now)
                .run()
            else if (condition === "expired") now += 600001
            else if (condition.startsWith("refund_"))
              await db
                .prepare(
                  "INSERT INTO refunds (id, payment_attempt_id, reason, state, amount_minor, created_at) VALUES (?, ?, 'technical_compensation', ?, ?, ?)"
                )
                .bind(
                  crypto.randomUUID(),
                  paymentId,
                  condition.slice(7),
                  checkout.order.totalMinor,
                  now
                )
                .run()
            else if (condition === "refunded")
              await db
                .prepare(
                  "UPDATE orders SET state = 'refunded', completed_at = ? WHERE id = ?"
                )
                .bind(now, checkout.order.id)
                .run()
            else if (condition === "blocked")
              await db
                .prepare(
                  "UPDATE orders SET admission_blocked_at = ? WHERE id = ?"
                )
                .bind(now, checkout.order.id)
                .run()
            else if (condition === "paid_sales_suspended")
              await db
                .prepare(
                  "UPDATE events SET paid_sales_state = 'suspended' WHERE id = 'event'"
                )
                .run()
            else if (condition === "account_unverified")
              await db
                .prepare(
                  "UPDATE user SET email_verified = 0 WHERE id = 'buyer'"
                )
                .run()
            else if (condition === "revision_changed")
              await db
                .prepare(
                  "UPDATE orders SET revision = revision + 1 WHERE id = ?"
                )
                .bind(checkout.order.id)
                .run()
            else if (condition === "type_reclassified") {
              await db
                .prepare(
                  "UPDATE ticket_types SET kind = 'free', price_minor = 0 WHERE id = 'type'"
                )
                .run()
              await db
                .prepare(
                  "UPDATE events SET paid_sales_state = 'suspended' WHERE id = 'event'"
                )
                .run()
            }
          },
        })
      ).rejects.toMatchObject({ code: "CONFLICT" })
      expect(await count("tickets")).toBe(0)
      expect(
        await db
          .prepare(
            "SELECT count(*) AS n FROM outbox WHERE kind = 'order.completed'"
          )
          .first("n")
      ).toBe(0)
      expect(
        await db
          .prepare(
            "SELECT count(*) AS n FROM request_receipts WHERE actor_id = 'system:paid-issuance'"
          )
          .first("n")
      ).toBe(0)
      expect(
        await db
          .prepare("SELECT state FROM payment_attempts WHERE id = ?")
          .bind(paymentId)
          .first("state")
      ).toBe("succeeded")
      expect(
        await db
          .prepare("SELECT reservation_id FROM inventory WHERE id = 'slot-0'")
          .first("reservation_id")
      ).toBe(checkout.reservation.id)
    }
  )

  it("keeps payment-frozen baskets immutable and commits allocated promo attribution", async () => {
    await db
      .prepare(
        "INSERT INTO campaigns (id, event_id, name, code, token_hash, reporting_id, discount_kind, discount_value, starts_at, ends_at, max_redemptions, enabled, updated_at) VALUES ('promo', 'event', 'Promo', 'SAVE', 'hash', 'promo-report', 'percentage', 1000, ?, ?, 1, 1, ?)"
      )
      .bind(now - 60000, now + 3600000, now)
      .run()
    await db
      .prepare(
        "INSERT INTO campaign_ticket_types (campaign_id, ticket_type_id) VALUES ('promo', 'type')"
      )
      .run()
    const checkout = await startCheckout(
      db,
      "buyer",
      { ...basket("reserve", 2), promoCode: "SAVE" },
      { now: clock }
    )
    const paymentId = await paymentFor(checkout)
    await expect(
      replaceCheckout(
        db,
        "buyer",
        checkout.order.id,
        { ...basket("replace"), expectedRevision: 0 },
        { now: clock }
      )
    ).rejects.toMatchObject({ code: "CHECKOUT_FROZEN" })
    await completePaidOrder(env(), paymentId, { now: clock })
    expect(checkout.order.totalMinor).toBe(540000)
    expect(
      await db
        .prepare(
          "SELECT committed_at FROM promo_allocations WHERE order_id = ?"
        )
        .bind(checkout.order.id)
        .first("committed_at")
    ).toBe(now)
  })

  it("retains immutable provider identity before completing the recorded payment", async () => {
    const { paymentId } = await reserveAndPay()
    const completed = await completePaidOrder(env(), paymentId, {
      now: clock,
      beforeCommit: async () => {
        await expect(
          db
            .prepare(
              "UPDATE payment_attempts SET provider_payment_id = 'changed' WHERE id = ?"
            )
            .bind(paymentId)
            .run()
        ).rejects.toThrow("payment_dispatch")
      },
    })
    expect(completed.ticketIds).toHaveLength(1)
    expect(
      await db
        .prepare(
          "SELECT provider_payment_id FROM payment_attempts WHERE id = ?"
        )
        .bind(paymentId)
        .first("provider_payment_id")
    ).toBe(`provider-${paymentId}`)
    expect(
      await db
        .prepare(
          "SELECT actor_id FROM audit_entries WHERE action = 'order.completed'"
        )
        .first("actor_id")
    ).toBe("system:paid-issuance")
  })

  it("replays fulfilled payment after a later refund without issuing or scheduling compensation again", async () => {
    const { checkout, paymentId } = await reserveAndPay()
    const completed = await completePaidOrder(env(), paymentId, { now: clock })
    await db
      .prepare(
        "INSERT INTO refunds (id, payment_attempt_id, reason, state, amount_minor, created_at, confirmed_at) VALUES ('refund', ?, 'event_cancelled', 'succeeded', ?, ?, ?)"
      )
      .bind(paymentId, checkout.order.totalMinor, now, now)
      .run()
    await db
      .prepare(
        "UPDATE orders SET state = 'refunded', admission_blocked_at = ? WHERE id = ?"
      )
      .bind(now, checkout.order.id)
      .run()
    await db
      .prepare("UPDATE tickets SET state = 'refunded' WHERE order_id = ?")
      .bind(checkout.order.id)
      .run()
    await db
      .prepare("UPDATE user SET email_verified = 0 WHERE id = 'buyer'")
      .run()
    expect(await completePaidOrder(env(), paymentId, { now: clock })).toEqual(
      completed
    )
    expect(await count("tickets")).toBe(1)
    expect(
      await db
        .prepare("SELECT state FROM tickets WHERE id = ?")
        .bind(completed.ticketIds[0])
        .first("state")
    ).toBe("refunded")
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM outbox WHERE kind = 'order.completed'"
        )
        .first("n")
    ).toBe(1)
    expect(await count("refunds")).toBe(1)
  })
})
