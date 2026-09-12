import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { DEMO_PAID_TERMS_VERSION } from "@elc/shared"
import { createAuthTestDatabase } from "../auth/test-database"
import { startCheckout } from "../orders/checkout"
import { startOrderPayment } from "../payments/checkout"
import { processPayment } from "../payments/reconcile"
import { RecordedProvider } from "../payments/test-fixture"
import { completePaidOrder, completeZeroTotalOrder } from "../tickets/issue"
import { loadPayment } from "../payments/store"
import { updateActivation } from "./mutations"
import { activateTestEvent } from "./test-fixture"

describe("current organizer eligibility in attendee purchase transitions", () => {
  let fixture: Awaited<ReturnType<typeof createAuthTestDatabase>>
  let db: D1Database
  let now: number
  let successfulActivationId: string
  const clock = () => now
  const environment = (database = db) => ({
    DB: database,
    APP_ORIGIN: "https://app.example.test",
    TICKET_ENCRYPTION_KEY: "A".repeat(43),
  })
  const basket = (changes: Record<string, unknown> = {}) => ({
    requestId: crypto.randomUUID(),
    eventId: "event",
    items: [
      {
        ticketTypeId: "paid-type",
        quantity: 1,
        attendeeNames: ["Demo attendee"],
      },
    ],
    ...changes,
  })
  const ticketPaymentCount = () =>
    db
      .prepare(
        "SELECT count(*) AS n FROM payment_attempts WHERE purpose = 'ticket_order'"
      )
      .first<number>("n")
  const count = (table: string) =>
    db.prepare(`SELECT count(*) AS n FROM ${table}`).first<number>("n")

  beforeEach(async () => {
    fixture = await createAuthTestDatabase()
    db = fixture.DB
    now = Date.now()
    for (const id of ["owner", "buyer"])
      await db
        .prepare(
          "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
        )
        .bind(id, id, `${id}@example.test`, now, now)
        .run()
    await db
      .prepare(`INSERT INTO events (id, organizer_id, title, description, category, venue_name, venue_address,
      starts_at, ends_at, registration_opens_at, registration_closes_at, capacity, max_tickets_per_order,
      publication_state, calendar_uid, reporting_id, created_at, updated_at)
      VALUES ('event', 'owner', 'Purchase eligibility', 'Demo event', 'Music', 'Hall', 'Address', ?, ?, ?, ?, 4, 4, 'published', 'calendar', 'report', ?, ?)`)
      .bind(
        now + 3_600_000,
        now + 7_200_000,
        now - 3_600_000,
        now + 3_600_000,
        now,
        now
      )
      .run()
    for (const [id, kind, price] of [
      ["paid-type", "paid", 100_000],
      ["free-type", "free", 0],
    ] as const) {
      await db
        .prepare(
          "INSERT INTO ticket_types (id, event_id, name, kind, price_minor, quantity, sales_start_at, sales_end_at, updated_at) VALUES (?, 'event', ?, ?, ?, 2, ?, ?, ?)"
        )
        .bind(id, id, kind, price, now - 3_600_000, now + 3_600_000, now)
        .run()
      for (const index of [1, 2])
        await db
          .prepare(
            "INSERT INTO inventory (id, event_id, ticket_type_id) VALUES (?, 'event', ?)"
          )
          .bind(`${id}-${index}`, id)
          .run()
    }
    successfulActivationId = await activateTestEvent(db, "event", "owner", now)
  })
  afterEach(async () => {
    await fixture?.runtime.dispose()
  })

  async function invalidate(condition: "email" | "suspension" | "checklist") {
    if (condition === "email")
      await db
        .prepare("UPDATE user SET email_verified = 0 WHERE id = 'owner'")
        .run()
    if (condition === "suspension")
      await db
        .prepare(
          "INSERT INTO profiles (user_id, suspended_at, updated_at) VALUES ('owner', ?, ?)"
        )
        .bind(now, now)
        .run()
    if (condition === "checklist")
      await updateActivation(
        db,
        "owner",
        "event",
        {
          requestId: crypto.randomUUID(),
          expectedRevision: 2,
          profile: {
            displayName: "Test organizer",
            legalName: "Test Organizer",
            contact: "test@example.test",
            dummyPayoutReference: "DEMO-TEST",
          },
          identityCheck: "failed",
          payoutCheck: "passed",
          acceptedTermsVersion: DEMO_PAID_TERMS_VERSION,
        },
        { now: clock }
      )
    // A stale or forged active flag must not bypass the current owner/checklist predicate.
    await db
      .prepare(
        "UPDATE events SET paid_sales_state = 'active' WHERE id = 'event'"
      )
      .run()
  }

  async function retainActivationFee() {
    expect(
      await db
        .prepare(
          "SELECT successful_payment_attempt_id FROM event_activations WHERE event_id = 'event'"
        )
        .first("successful_payment_attempt_id")
    ).toBe(successfulActivationId)
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM refunds WHERE payment_attempt_id = ?"
        )
        .bind(successfulActivationId)
        .first("n")
    ).toBe(0)
  }

  it.each(["email", "suspension", "checklist"] as const)(
    "rolls back the reservation if organizer %s eligibility changes after planning",
    async (condition) => {
      await expect(
        startCheckout(db, "buyer", basket(), {
          now: clock,
          beforeCommit: () => invalidate(condition),
        })
      ).rejects.toMatchObject({ code: "CONFLICT" })
      expect(await count("orders")).toBe(0)
      expect(await count("reservations")).toBe(0)
      expect(
        await db
          .prepare(
            "SELECT count(*) AS n FROM inventory WHERE reservation_id IS NOT NULL"
          )
          .first("n")
      ).toBe(0)
      expect(
        await db
          .prepare(
            "SELECT count(*) AS n FROM audit_entries WHERE action = 'checkout.started'"
          )
          .first("n")
      ).toBe(0)
      await retainActivationFee()
    }
  )

  it.each(["email", "suspension", "checklist"] as const)(
    "prevents payment preparation if organizer %s eligibility changes after the basket read",
    async (condition) => {
      const order = await startCheckout(db, "buyer", basket(), { now: clock })
      const provider = new RecordedProvider()
      await expect(
        startOrderPayment(
          environment(),
          provider,
          "buyer",
          order.order.id,
          { requestId: crypto.randomUUID(), expectedRevision: 0 },
          { now: clock, beforeCommit: () => invalidate(condition) }
        )
      ).rejects.toMatchObject({ code: "CONFLICT" })
      expect(await ticketPaymentCount()).toBe(0)
      expect(provider.creates).toHaveLength(0)
      expect(
        await db
          .prepare("SELECT payment_attempt_id FROM reservations WHERE id = ?")
          .bind(order.reservation.id)
          .first("payment_attempt_id")
      ).toBeNull()
      await retainActivationFee()
    }
  )

  it.each(["email", "suspension", "checklist"] as const)(
    "rechecks organizer %s eligibility inside the dispatch claim before any provider POST",
    async (condition) => {
      const order = await startCheckout(db, "buyer", basket(), { now: clock })
      const provider = new RecordedProvider()
      let interrupted = false
      const observedDb = new Proxy(db, {
        get(target, property) {
          if (property === "batch")
            return async (statements: D1PreparedStatement[]) => {
              const prepared = await db
                .prepare(
                  "SELECT 1 FROM payment_attempts WHERE purpose = 'ticket_order' AND dispatch_state = 'prepared' LIMIT 1"
                )
                .first()
              if (prepared && !interrupted) {
                interrupted = true
                await invalidate(condition)
              }
              return db.batch(statements)
            }
          const value: unknown = Reflect.get(target, property)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
      const response = await startOrderPayment(
        environment(observedDb),
        provider,
        "buyer",
        order.order.id,
        { requestId: crypto.randomUUID(), expectedRevision: 0 },
        { now: clock }
      )
      expect(interrupted).toBe(true)
      expect(response.payment).toMatchObject({
        state: "cancelled",
        dispatchState: "reconciled",
        checkoutUrl: null,
      })
      expect(provider.creates).toHaveLength(0)
      expect(await count("tickets")).toBe(0)
      expect(await count("refunds")).toBe(0)
      await retainActivationFee()
    }
  )

  it.each(["email", "suspension", "checklist"] as const)(
    "blocks paid issuance after organizer %s changes, then compensates the attendee only",
    async (condition) => {
      const order = await startCheckout(db, "buyer", basket(), { now: clock })
      const provider = new RecordedProvider()
      const prepared = await startOrderPayment(
        environment(),
        provider,
        "buyer",
        order.order.id,
        { requestId: crypto.randomUUID(), expectedRevision: 0 },
        { now: clock }
      )
      provider.state = "succeeded"
      // The shared reconciliation path obtains a paid fact before preparing canonical tickets.
      expect(
        await processPayment(environment(), provider, prepared.payment.id, {
          now: clock,
          beforeCommit: () => invalidate(condition),
        })
      ).toBe(true)
      expect(await count("tickets")).toBe(0)
      expect(provider.refunds).toHaveLength(1)
      expect(provider.refunds[0]).toMatchObject({
        expected: { purpose: "ticket_order", subjectId: order.order.id },
        amountMinor: 100_000,
      })
      expect((await loadPayment(db, prepared.payment.id)).state).toBe(
        "succeeded"
      )
      expect(
        await db
          .prepare(
            "SELECT count(*) AS n FROM audit_entries WHERE action = 'order.completed'"
          )
          .first("n")
      ).toBe(0)
      await expect(
        completePaidOrder(environment(), prepared.payment.id, { now: clock })
      ).rejects.toMatchObject({ code: "CONFLICT" })
      expect(provider.refunds).toHaveLength(1)
      await retainActivationFee()
    }
  )

  async function fullDiscount() {
    await db
      .prepare(
        "INSERT INTO campaigns (id, event_id, name, code, token_hash, reporting_id, discount_kind, discount_value, starts_at, ends_at, max_redemptions, enabled, updated_at) VALUES ('promo', 'event', 'Full demo discount', 'FREEDEMO', 'hash', 'campaign-report', 'percentage', 10000, ?, ?, 2, 1, ?)"
      )
      .bind(now - 60_000, now + 3_600_000, now)
      .run()
    await db
      .prepare(
        "INSERT INTO campaign_ticket_types (campaign_id, ticket_type_id) VALUES ('promo', 'paid-type')"
      )
      .run()
  }

  it("requires current activation for a fully discounted paid reservation", async () => {
    await fullDiscount()
    await expect(
      startCheckout(db, "buyer", basket({ promoCode: "FREEDEMO" }), {
        now: clock,
        beforeCommit: () => invalidate("checklist"),
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(await count("orders")).toBe(0)
    expect(await count("promo_allocations")).toBe(0)
  })

  it("requires current activation at zero-total paid ticket issuance", async () => {
    await fullDiscount()
    const order = await startCheckout(
      db,
      "buyer",
      basket({ promoCode: "FREEDEMO" }),
      { now: clock }
    )
    expect(order.order.totalMinor).toBe(0)
    await expect(
      completeZeroTotalOrder(
        environment(),
        "buyer",
        order.order.id,
        { requestId: crypto.randomUUID(), expectedRevision: 0 },
        { now: clock, beforeCommit: () => invalidate("checklist") }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(await count("tickets")).toBe(0)
    expect(await ticketPaymentCount()).toBe(0)
    expect(
      await db
        .prepare(
          "SELECT committed_at FROM promo_allocations WHERE order_id = ?"
        )
        .bind(order.order.id)
        .first("committed_at")
    ).toBeNull()
  })

  it("keeps free-only registration available when only paid-sales checklist checks fail", async () => {
    await invalidate("checklist")
    const order = await startCheckout(
      db,
      "buyer",
      basket({
        items: [
          {
            ticketTypeId: "free-type",
            quantity: 1,
            attendeeNames: ["Free attendee"],
          },
        ],
      }),
      { now: clock }
    )
    const completed = await completeZeroTotalOrder(
      environment(),
      "buyer",
      order.order.id,
      { requestId: crypto.randomUUID(), expectedRevision: 0 },
      { now: clock }
    )
    expect(completed.ticketIds).toHaveLength(1)
    expect(await ticketPaymentCount()).toBe(0)
  })
})
