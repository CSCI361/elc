import { readFile, readdir } from "node:fs/promises"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"

describe("D1 migration constraints and atomic batch guards", () => {
  let runtime: Miniflare
  let db: D1Database

  beforeEach(async () => {
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script:
          "export default { fetch() { return new Response('schema test'); } }",
        compatibilityDate: "2026-09-11",
        d1Databases: ["DB"],
      })
    )
    db = (await runtime.getD1Database("DB")) as D1Database
    const directory = new URL("../../migrations/", import.meta.url)
    for (const name of (await readdir(directory))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      const migration = await readFile(new URL(name, directory), "utf8")
      for (const statement of migration
        .split("--> statement-breakpoint")
        .filter((part) => part.trim())) {
        await db.prepare(statement).run()
      }
    }
    for (const id of ["owner", "buyer-a", "buyer-b"]) {
      await db
        .prepare(
          "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, 1, 1)"
        )
        .bind(id, id, `${id}@example.test`)
        .run()
    }
    for (const id of ["event-a", "event-b"]) {
      await db
        .prepare(`INSERT INTO events (id, organizer_id, title, description, category, venue_name, venue_address,
        starts_at, ends_at, registration_opens_at, registration_closes_at, capacity, max_tickets_per_order,
        calendar_uid, reporting_id, created_at, updated_at) VALUES (?, 'owner', ?, 'Description', 'Music', 'Hall',
        'Address', 1000000, 2000000, 0, 1000000, 2, 2, ?, ?, 1, 1)`)
        .bind(id, id, `${id}@elc`, `report-${id}`)
        .run()
      await db
        .prepare(
          "INSERT INTO ticket_types (id, event_id, name, kind, price_minor, quantity, sales_start_at, sales_end_at, updated_at) VALUES (?, ?, 'Free', 'free', 0, 2, 0, 1000000, 1)"
        )
        .bind(`type-${id}`, id)
        .run()
    }
    for (const suffix of ["a", "b"]) {
      await db
        .prepare(
          "INSERT INTO orders (id, account_id, event_id, subtotal_minor, discount_minor, total_minor, processing_fee_minor, refund_policy_version, created_at) VALUES (?, ?, 'event-a', 0, 0, 0, 0, 'academic-v1', 1)"
        )
        .bind(`order-${suffix}`, `buyer-${suffix}`)
        .run()
      await db
        .prepare(
          "INSERT INTO reservations (id, order_id, account_id, event_id, created_at, expires_at) VALUES (?, ?, ?, 'event-a', 1, 600001)"
        )
        .bind(`reservation-${suffix}`, `order-${suffix}`, `buyer-${suffix}`)
        .run()
      await db
        .prepare(
          "INSERT INTO order_items (id, order_id, ticket_type_id, ticket_type_name, quantity, unit_price_minor, subtotal_minor, discount_minor, total_minor, attendees_json, seats_json) VALUES (?, ?, 'type-event-a', 'Free', 1, 0, 0, 0, 0, '[\"Attendee\"]', '[]')"
        )
        .bind(`item-${suffix}`, `order-${suffix}`)
        .run()
    }
    await db
      .prepare(
        "INSERT INTO inventory (id, event_id, ticket_type_id) VALUES ('slot', 'event-a', 'type-event-a')"
      )
      .run()
  })

  afterEach(async () => {
    await runtime?.dispose()
  })

  it("rejects a reservation whose purchaser or event differs from its order", async () => {
    await expect(
      db
        .prepare(
          "UPDATE reservations SET account_id = 'owner' WHERE id = 'reservation-a'"
        )
        .run()
    ).rejects.toThrow()
    await expect(
      db
        .prepare(
          "UPDATE reservations SET event_id = 'event-b' WHERE id = 'reservation-a'"
        )
        .run()
    ).rejects.toThrow()
    expect(
      await db
        .prepare(
          "SELECT account_id FROM reservations WHERE id = 'reservation-a'"
        )
        .first("account_id")
    ).toBe("buyer-a")
  })

  it("rejects inventory and item links to another event's ticket type", async () => {
    await expect(
      db
        .prepare(
          "UPDATE inventory SET ticket_type_id = 'type-event-b' WHERE id = 'slot'"
        )
        .run()
    ).rejects.toThrow()
    await expect(
      db
        .prepare(
          "UPDATE order_items SET ticket_type_id = 'type-event-b' WHERE id = 'item-a'"
        )
        .run()
    ).rejects.toThrow()
  })

  it("allows exactly one active reservation for an account and event", async () => {
    await db
      .prepare(
        "INSERT INTO orders (id, account_id, event_id, subtotal_minor, discount_minor, total_minor, processing_fee_minor, refund_policy_version, created_at) VALUES ('duplicate', 'buyer-a', 'event-a', 0, 0, 0, 0, 'academic-v1', 1)"
      )
      .run()
    await expect(
      db
        .prepare(
          "INSERT INTO reservations (id, order_id, account_id, event_id, created_at, expires_at) VALUES ('duplicate', 'duplicate', 'buyer-a', 'event-a', 1, 600001)"
        )
        .run()
    ).rejects.toThrow()
  })

  it("rejects invalid deadlines and totals at the database boundary", async () => {
    await expect(
      db
        .prepare(
          "UPDATE reservations SET expires_at = 600002 WHERE id = 'reservation-a'"
        )
        .run()
    ).rejects.toThrow()
    await expect(
      db
        .prepare("UPDATE orders SET total_minor = 100 WHERE id = 'order-a'")
        .run()
    ).rejects.toThrow()
    await expect(
      db
        .prepare(
          "UPDATE order_items SET discount_minor = 1 WHERE id = 'item-a'"
        )
        .run()
    ).rejects.toThrow()
  })

  it("makes a zero-row conditional write roll back the entire batch with an explicit guard", async () => {
    await expect(
      db.batch([
        db.prepare(
          "INSERT INTO audit_entries (id, actor_id, scope, action, entity_id, description, correlation_id, created_at) VALUES ('rollback', 'owner', 'platform', 'test', 'slot', 'Guard test', 'test', 1)"
        ),
        db.prepare(
          "UPDATE inventory SET reservation_id = 'reservation-a' WHERE id = 'missing'"
        ),
        db.prepare(
          "INSERT INTO transition_guards (id, valid) SELECT 'test', CASE WHEN EXISTS (SELECT 1 FROM inventory WHERE id = 'slot' AND reservation_id = 'reservation-a') THEN 1 ELSE 0 END"
        ),
      ])
    ).rejects.toThrow()
    expect(
      await db
        .prepare("SELECT id FROM audit_entries WHERE id = 'rollback'")
        .first()
    ).toBeNull()
    expect(
      await db
        .prepare("SELECT reservation_id FROM inventory WHERE id = 'slot'")
        .first("reservation_id")
    ).toBeNull()
  })

  it("serializes competing conditional allocations with one winner and no partial guard rows", async () => {
    const results = await Promise.allSettled(
      ["a", "b"].map((suffix) =>
        db.batch([
          db
            .prepare(
              "UPDATE inventory SET reservation_id = ? WHERE id = 'slot' AND reservation_id IS NULL AND order_id IS NULL"
            )
            .bind(`reservation-${suffix}`),
          db
            .prepare(
              "INSERT INTO transition_guards (id, valid) SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM inventory WHERE id = 'slot' AND reservation_id = ?) THEN 1 ELSE 0 END"
            )
            .bind(suffix, `reservation-${suffix}`),
          db.prepare("DELETE FROM transition_guards WHERE id = ?").bind(suffix),
        ])
      )
    )
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1)
    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(1)
    expect(
      await db.prepare("SELECT count(*) AS n FROM transition_guards").first("n")
    ).toBe(0)
  })

  it("protects active ticket ownership and allows historical inventory reuse after invalidation", async () => {
    const insertTicket = (suffix: string) =>
      db
        .prepare(
          "INSERT INTO tickets (id, order_id, order_item_id, inventory_id, event_id, ticket_type_id, attendee_name, token_hash, credential_ciphertext, created_at) VALUES (?, ?, ?, 'slot', 'event-a', 'type-event-a', 'Attendee', ?, 'test-ciphertext', 1)"
        )
        .bind(
          `ticket-${suffix}`,
          `order-${suffix}`,
          `item-${suffix}`,
          `token-${suffix}`
        )
    await db
      .prepare("UPDATE inventory SET order_id = 'order-a' WHERE id = 'slot'")
      .run()
    await insertTicket("a").run()
    await expect(insertTicket("b").run()).rejects.toThrow()
    await expect(
      db
        .prepare("UPDATE inventory SET order_id = 'order-b' WHERE id = 'slot'")
        .run()
    ).rejects.toThrow()
    await db
      .prepare("UPDATE tickets SET state = 'cancelled' WHERE id = 'ticket-a'")
      .run()
    await db
      .prepare("UPDATE inventory SET order_id = 'order-b' WHERE id = 'slot'")
      .run()
    await insertTicket("b").run()
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM tickets WHERE inventory_id = 'slot'"
        )
        .first("n")
    ).toBe(2)
  })
})
