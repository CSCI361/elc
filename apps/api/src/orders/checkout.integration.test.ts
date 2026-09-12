import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { createAuthTestDatabase } from "../auth/test-database"
import { startCheckout, replaceCheckout } from "./checkout"
import { abandonCheckout, expireReservations, readCheckout } from "./lifecycle"
import { loadOrder } from "./read"

describe("D1 checkout service", () => {
  let fixture: Awaited<ReturnType<typeof createAuthTestDatabase>>
  let db: D1Database
  const now = 1_000_000
  const basket = (
    requestId: string,
    quantity = 1,
    extra: Record<string, unknown> = {}
  ) => ({
    requestId,
    eventId: "event",
    items: [
      {
        ticketTypeId: "type",
        quantity,
        attendeeNames: Array.from(
          { length: quantity },
          (_, index) => `Attendee ${index + 1}`
        ),
      },
    ],
    ...extra,
  })
  const clock = { now: () => now }
  const count = async (table: string, where = "1") =>
    db
      .prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)
      .first<number>("n")

  beforeEach(async () => {
    fixture = await createAuthTestDatabase()
    db = fixture.DB
    for (const id of ["owner", "buyer-a", "buyer-b"])
      await db
        .prepare(
          "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, 1, 1)"
        )
        .bind(id, id, `${id}@example.test`)
        .run()
    await db
      .prepare(`INSERT INTO events (id, organizer_id, title, description, category, venue_name, venue_address, starts_at, ends_at,
      registration_opens_at, registration_closes_at, capacity, max_tickets_per_order, publication_state, paid_sales_state, calendar_uid, reporting_id, created_at, updated_at, refund_instructions)
      VALUES ('event', 'owner', 'Concert', 'Description', 'Music', 'Hall', 'Address', 9000000, 10000000, 0, 9000000, 4, 4, 'published', 'active', 'calendar', 'report', 1, 1, 'Use your order page.')`)
      .run()
    await db
      .prepare(
        "INSERT INTO ticket_types (id, event_id, name, kind, price_minor, quantity, sales_start_at, sales_end_at, updated_at) VALUES ('type', 'event', 'Admission', 'paid', 300000, 4, 0, 9000000, 1)"
      )
      .run()
    for (let index = 1; index <= 4; index++)
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

  async function promo(max = 1) {
    await db
      .prepare(
        "INSERT INTO campaigns (id, event_id, name, code, token_hash, reporting_id, discount_kind, discount_value, starts_at, ends_at, max_redemptions, enabled, updated_at) VALUES ('promo', 'event', 'Promo', 'SAVE', 'token', 'campaign-report', 'percentage', 1000, 0, 9000000, ?, 1, 1)"
      )
      .bind(max)
      .run()
    await db
      .prepare(
        "INSERT INTO campaign_ticket_types (campaign_id, ticket_type_id) VALUES ('promo', 'type')"
      )
      .run()
  }

  it("persists server prices, policy, names, exact deadline and replay without duplicate effects", async () => {
    const result = await startCheckout(db, "buyer-a", basket("start", 2), clock)
    expect(result.order.totalMinor).toBe(600000)
    expect(result.order.processingFeeMinor).toBe(18000)
    expect(result.refundPolicy.instructions).toBe("Use your order page.")
    expect(result.refundPolicy.fullRefundOnly).toBe(true)
    expect(
      Date.parse(result.reservation.expiresAt) -
        Date.parse(result.reservation.createdAt)
    ).toBe(600000)
    expect(result.attendees[0]?.names).toEqual(["Attendee 1", "Attendee 2"])
    expect(
      await startCheckout(db, "buyer-a", basket("start", 2), clock)
    ).toEqual(result)
    expect(await loadOrder(db, "buyer-a", result.order.id)).toEqual(result)
    expect(await count("orders")).toBe(1)
    expect(await count("audit_entries")).toBe(1)
    expect(await count("inventory", "reservation_id IS NOT NULL")).toBe(2)
    await expect(
      startCheckout(db, "buyer-a", basket("start", 1), clock)
    ).rejects.toMatchObject({ code: "CONFLICT" })
    await expect(
      loadOrder(db, "buyer-b", result.order.id)
    ).rejects.toMatchObject({ status: 404 })
  })

  it("lets exactly one competing buyer reserve the last place and rolls the loser back", async () => {
    await db.prepare("DELETE FROM inventory WHERE id <> 'slot-1'").run()
    const results = await Promise.allSettled([
      startCheckout(db, "buyer-a", basket("a"), clock),
      startCheckout(db, "buyer-b", basket("b"), clock),
    ])
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1)
    expect(await count("orders")).toBe(1)
    expect(await count("reservations")).toBe(1)
    expect(await count("request_receipts")).toBe(1)
    expect(await count("transition_guards")).toBe(0)
  })

  it("serializes the last promo redemption across baskets and restores losing inventory", async () => {
    await promo()
    const results = await Promise.allSettled([
      startCheckout(
        db,
        "buyer-a",
        basket("a", 1, { promoCode: "SAVE" }),
        clock
      ),
      startCheckout(
        db,
        "buyer-b",
        basket("b", 1, { promoCode: "SAVE" }),
        clock
      ),
    ])
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(await count("promo_allocations")).toBe(1)
    expect(await count("inventory", "reservation_id IS NOT NULL")).toBe(1)
    expect(await count("orders")).toBe(1)
  })

  it("reserves an assigned basket all-or-none under an overlapping-seat race", async () => {
    await db
      .prepare(
        "UPDATE events SET seating_mode = 'assigned', venue_layout_id = 'hall' WHERE id = 'event'"
      )
      .run()
    for (let index = 1; index <= 4; index++)
      await db
        .prepare(
          "UPDATE inventory SET section = 'Main', row = 'A', number = ? WHERE id = ?"
        )
        .bind(String(index), `slot-${index}`)
        .run()
    const assigned = (requestId: string, seats: string[]) =>
      basket(requestId, 2, {
        items: [
          {
            ticketTypeId: "type",
            quantity: 2,
            attendeeNames: ["First", "Second"],
            seatIds: seats,
          },
        ],
      })
    const results = await Promise.allSettled([
      startCheckout(db, "buyer-a", assigned("a", ["slot-1", "slot-2"]), clock),
      startCheckout(db, "buyer-b", assigned("b", ["slot-2", "slot-3"]), clock),
    ])
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(await count("inventory", "reservation_id IS NOT NULL")).toBe(2)
    const winner = results.find((r) => r.status === "fulfilled")
    if (winner?.status === "fulfilled")
      expect(winner.value.order.items[0]?.seats).toHaveLength(2)
  })

  it("replaces a basket with revision CAS and retains the original ten-minute deadline", async () => {
    await promo()
    const first = await startCheckout(
      db,
      "buyer-a",
      basket("start", 1, { promoCode: "SAVE" }),
      clock
    )
    const changed = await replaceCheckout(
      db,
      "buyer-a",
      first.order.id,
      { ...basket("replace", 2, { promoCode: "SAVE" }), expectedRevision: 0 },
      { now: () => now + 300000 }
    )
    expect(changed.revision).toBe(1)
    expect(changed.order.totalMinor).toBe(540000)
    expect(changed.reservation.expiresAt).toBe(first.reservation.expiresAt)
    expect(changed.reservation.id).toBe(first.reservation.id)
    expect(await count("promo_allocations")).toBe(1)
    expect(await count("inventory", "reservation_id IS NOT NULL")).toBe(2)
    await expect(
      replaceCheckout(
        db,
        "buyer-a",
        first.order.id,
        { ...basket("stale"), expectedRevision: 0 },
        clock
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
    await expect(
      startCheckout(db, "buyer-a", basket("new-tab"), clock)
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })

  it("preserves the entire previous basket when replacement cannot acquire every place", async () => {
    const first = await startCheckout(db, "buyer-a", basket("a"), clock)
    await startCheckout(db, "buyer-b", basket("b", 3), clock)
    await expect(
      replaceCheckout(
        db,
        "buyer-a",
        first.order.id,
        { ...basket("replace", 2), expectedRevision: 0 },
        clock
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(await loadOrder(db, "buyer-a", first.order.id)).toEqual(first)
    expect(
      await count("inventory", `reservation_id = '${first.reservation.id}'`)
    ).toBe(1)
    expect(await count("request_receipts", "request_id = 'replace'")).toBe(0)
  })

  it("freezes a basket after any payment attempt but allows idempotent abandonment", async () => {
    await promo()
    const first = await startCheckout(
      db,
      "buyer-a",
      basket("start", 1, { promoCode: "SAVE" }),
      clock
    )
    await db
      .prepare(
        "INSERT INTO payment_attempts (id, purpose, subject_id, provider, idempotency_key, amount_minor, created_at) VALUES ('payment', 'ticket_order', ?, 'polar_sandbox', 'provider-request', ?, ?)"
      )
      .bind(first.order.id, first.order.totalMinor, now)
      .run()
    await expect(
      replaceCheckout(
        db,
        "buyer-a",
        first.order.id,
        { ...basket("replace"), expectedRevision: 0 },
        clock
      )
    ).rejects.toMatchObject({ code: "CHECKOUT_FROZEN" })
    const abandoned = await abandonCheckout(
      db,
      "buyer-a",
      first.order.id,
      { requestId: "abandon", expectedRevision: 0 },
      now
    )
    expect(abandoned.order.state).toBe("abandoned")
    expect(
      await abandonCheckout(
        db,
        "buyer-a",
        first.order.id,
        { requestId: "abandon", expectedRevision: 0 },
        now
      )
    ).toEqual(abandoned)
    expect(await count("inventory", "reservation_id IS NOT NULL")).toBe(0)
    expect(await count("promo_allocations", "released_at IS NOT NULL")).toBe(1)
    expect(await count("payment_attempts")).toBe(1)
  })

  it("expires once, releases promo capacity and makes held inventory available lazily", async () => {
    await promo()
    const first = await startCheckout(
      db,
      "buyer-a",
      basket("start", 4, { promoCode: "SAVE" }),
      clock
    )
    const second = await startCheckout(
      db,
      "buyer-b",
      basket("second", 4, { promoCode: "SAVE" }),
      { now: () => now + 600000 }
    )
    expect(second.order.state).toBe("pending")
    expect(
      (await readCheckout(db, "buyer-a", first.order.id, now + 600000)).order
        .state
    ).toBe("expired")
    expect(await expireReservations(db, "event", now + 600000)).toBe(0)
    expect(await count("audit_entries", "action = 'checkout.expired'")).toBe(1)
    expect(await count("promo_allocations", "released_at IS NOT NULL")).toBe(1)
    expect(await count("inventory", "reservation_id IS NOT NULL")).toBe(4)
  })

  it("rechecks changed event, account, type price and campaign terms inside the commit", async () => {
    const mutations = [
      "UPDATE events SET publication_state = 'unpublished' WHERE id = 'event'",
      "UPDATE user SET email_verified = 0 WHERE id = 'buyer-a'",
      "UPDATE ticket_types SET price_minor = 400000 WHERE id = 'type'",
    ]
    for (const [index, mutation] of mutations.entries()) {
      await expect(
        startCheckout(db, "buyer-a", basket(`changed-${index}`), {
          ...clock,
          beforeCommit: async () => {
            await db.prepare(mutation).run()
          },
        })
      ).rejects.toMatchObject({ code: "CONFLICT" })
      await db
        .prepare(
          "UPDATE events SET publication_state = 'published' WHERE id = 'event'"
        )
        .run()
      await db
        .prepare("UPDATE user SET email_verified = 1 WHERE id = 'buyer-a'")
        .run()
      await db
        .prepare(
          "UPDATE ticket_types SET price_minor = 300000 WHERE id = 'type'"
        )
        .run()
    }
    await promo()
    await expect(
      startCheckout(
        db,
        "buyer-a",
        basket("changed-promo", 1, { promoCode: "SAVE" }),
        {
          ...clock,
          beforeCommit: async () => {
            await db
              .prepare(
                "UPDATE campaigns SET discount_value = 2000 WHERE id = 'promo'"
              )
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(await count("orders")).toBe(0)
    expect(await count("inventory", "reservation_id IS NOT NULL")).toBe(0)
    expect(await count("request_receipts")).toBe(0)
  })

  it("requires an accepted matching private invitation, honors acceptance after token expiry and rechecks revocation", async () => {
    await db
      .prepare("UPDATE events SET visibility = 'private' WHERE id = 'event'")
      .run()
    await expect(
      startCheckout(db, "buyer-a", basket("no-invite"), clock)
    ).rejects.toMatchObject({ code: "CONFLICT" })
    await db
      .prepare(
        "INSERT INTO invitations (id, event_id, email, token_hash, created_at, expires_at, accepted_by, accepted_at) VALUES ('invite', 'event', 'buyer-a@example.test', 'invite-token', 1, 100, 'buyer-a', 50)"
      )
      .run()
    const accepted = await startCheckout(
      db,
      "buyer-a",
      basket("accepted"),
      clock
    )
    expect(accepted.order.state).toBe("pending")
    await expect(
      replaceCheckout(
        db,
        "buyer-a",
        accepted.order.id,
        { ...basket("revoked"), expectedRevision: 0 },
        {
          ...clock,
          beforeCommit: async () => {
            await db
              .prepare(
                "UPDATE invitations SET revoked_at = ? WHERE id = 'invite'"
              )
              .bind(now)
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(await loadOrder(db, "buyer-a", accepted.order.id)).toEqual(accepted)
  })

  it("enforces configured capacities even when extra inventory rows exist", async () => {
    await db
      .prepare(
        "UPDATE events SET capacity = 2, max_tickets_per_order = 2 WHERE id = 'event'"
      )
      .run()
    await startCheckout(db, "buyer-a", basket("a", 2), clock)
    await expect(
      startCheckout(db, "buyer-b", basket("b"), clock)
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(await count("inventory", "reservation_id IS NOT NULL")).toBe(2)
  })

  it("allows one same-revision replacement winner without extending the deadline", async () => {
    const first = await startCheckout(db, "buyer-a", basket("first"), clock)
    const results = await Promise.allSettled(
      [2, 3].map((quantity) =>
        replaceCheckout(
          db,
          "buyer-a",
          first.order.id,
          { ...basket(`replace-${quantity}`, quantity), expectedRevision: 0 },
          clock
        )
      )
    )
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1)
    const current = await loadOrder(db, "buyer-a", first.order.id)
    expect(current.revision).toBe(1)
    expect(current.reservation.expiresAt).toBe(first.reservation.expiresAt)
    expect(await count("request_receipts")).toBe(2)
  })

  it("checks the deadline again after preflight, rolling back a delayed replacement", async () => {
    const first = await startCheckout(db, "buyer-a", basket("first"), clock)
    let currentTime = now
    await expect(
      replaceCheckout(
        db,
        "buyer-a",
        first.order.id,
        { ...basket("late", 2), expectedRevision: 0 },
        {
          now: () => currentTime,
          beforeCommit: async () => {
            currentTime = now + 600000
          },
        }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(await loadOrder(db, "buyer-a", first.order.id)).toEqual(first)
  })

  it("uses the D1 clock for production deadlines and sales windows", async () => {
    const realNow = Date.now()
    await db
      .prepare(
        "UPDATE events SET starts_at = ?, ends_at = ?, registration_closes_at = ? WHERE id = 'event'"
      )
      .bind(realNow + 1000000, realNow + 2000000, realNow + 1000000)
      .run()
    await db
      .prepare("UPDATE ticket_types SET sales_end_at = ? WHERE id = 'type'")
      .bind(realNow + 1000000)
      .run()
    const checkout = await startCheckout(db, "buyer-a", basket("real-clock"))
    expect(checkout.order.state).toBe("pending")
    expect(Date.parse(checkout.reservation.expiresAt)).toBeGreaterThan(realNow)
  })

  it("snapshots a mixed-type basket and discounts only applicable ticket types", async () => {
    await db
      .prepare("DELETE FROM inventory WHERE id IN ('slot-3', 'slot-4')")
      .run()
    await db
      .prepare("UPDATE ticket_types SET quantity = 2 WHERE id = 'type'")
      .run()
    await db
      .prepare(
        "INSERT INTO ticket_types (id, event_id, name, kind, price_minor, quantity, sales_start_at, sales_end_at, updated_at) VALUES ('other', 'event', 'Premium', 'paid', 500000, 2, 0, 9000000, 1)"
      )
      .run()
    await db
      .prepare(
        "INSERT INTO inventory (id, event_id, ticket_type_id) VALUES ('premium-1', 'event', 'other'), ('premium-2', 'event', 'other')"
      )
      .run()
    await promo()
    const result = await startCheckout(
      db,
      "buyer-a",
      basket("mixed", 1, {
        promoCode: "SAVE",
        items: [
          {
            ticketTypeId: "other",
            quantity: 1,
            attendeeNames: ["Premium guest"],
          },
          {
            ticketTypeId: "type",
            quantity: 2,
            attendeeNames: ["First guest", "Second guest"],
          },
        ],
      }),
      clock
    )
    expect(result.order.subtotalMinor).toBe(1100000)
    expect(result.order.discountMinor).toBe(60000)
    expect(result.order.items.map((item) => item.discountMinor)).toEqual([
      0, 60000,
    ])
    await db
      .prepare(
        "UPDATE ticket_types SET name = 'Renamed', price_minor = 600000 WHERE id = 'other'"
      )
      .run()
    expect(await loadOrder(db, "buyer-a", result.order.id)).toEqual(result)
    expect(await count("inventory", "reservation_id IS NOT NULL")).toBe(3)
  })

  it("requires paid-sales activation even when a campaign reduces a paid basket to zero", async () => {
    await promo()
    await db
      .prepare("UPDATE campaigns SET discount_value = 10000 WHERE id = 'promo'")
      .run()
    await db
      .prepare(
        "UPDATE events SET paid_sales_state = 'pending' WHERE id = 'event'"
      )
      .run()
    await expect(
      startCheckout(
        db,
        "buyer-a",
        basket("zero", 1, { promoCode: "SAVE" }),
        clock
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(await count("orders")).toBe(0)
  })

  it("rejects a selected seat whose physical label becomes null before commit", async () => {
    await db
      .prepare(
        "UPDATE events SET seating_mode = 'assigned', venue_layout_id = 'hall' WHERE id = 'event'"
      )
      .run()
    await db
      .prepare(
        "UPDATE inventory SET section = 'Main', row = 'A', number = '1' WHERE id = 'slot-1'"
      )
      .run()
    await expect(
      startCheckout(
        db,
        "buyer-a",
        basket("seat-change", 1, {
          items: [
            {
              ticketTypeId: "type",
              quantity: 1,
              attendeeNames: ["Guest"],
              seatIds: ["slot-1"],
            },
          ],
        }),
        {
          ...clock,
          beforeCommit: async () => {
            await db
              .prepare(
                "UPDATE inventory SET section = NULL, row = NULL, number = NULL WHERE id = 'slot-1'"
              )
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(await count("orders")).toBe(0)
    expect(await count("inventory", "reservation_id IS NOT NULL")).toBe(0)
  })
})
