import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { createAuthTestDatabase } from "../auth/test-database"
import { activateTestEvent } from "../activation/test-fixture"
import { startCheckout } from "../orders/checkout"
import { startOrderPayment } from "../payments/checkout"
import { processPayment } from "../payments/reconcile"
import { RecordedProvider } from "../payments/test-fixture"
import { readTicket } from "../tickets/read"

export async function createExportFixture() {
  const database = await createAuthTestDatabase()
  const storage = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script:
        "export default { fetch() { return new Response('export storage test'); } }",
      compatibilityDate: "2026-09-12",
      r2Buckets: ["FILES"],
    })
  )
  try {
    const db = database.DB
    const now = Date.now()
    for (const id of ["owner", "buyer", "scanner", "other", "manager"])
      await db
        .prepare(
          "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
        )
        .bind(id, id, `${id}@example.test`, now, now)
        .run()
    await db
      .prepare(`INSERT INTO events (id, organizer_id, title, description, category, venue_name, venue_address,
      starts_at, ends_at, registration_opens_at, registration_closes_at, capacity, max_tickets_per_order,
      seating_mode, venue_layout_id, publication_state, paid_sales_state, calendar_uid, reporting_id, created_at, updated_at)
      VALUES ('event', 'owner', 'Қазақ өнері / Вечер музыки / Music evening', 'Қош келдіңіз! Живая музыка. Welcome.', 'Music',
      'Алматы өнер залы / Концертный зал', 'Алматы, Абай даңғылы, 10 / проспект Абая, 10',
      ?, ?, ?, ?, 4, 4, 'assigned', 'export-hall', 'published', 'active', 'event@elc.example', 'report', ?, ?)`)
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
        "INSERT INTO ticket_types (id, event_id, name, kind, price_minor, quantity, sales_start_at, sales_end_at, updated_at) VALUES ('type', 'event', 'Балкон / Balcony', 'paid', 1234500, 4, ?, ?, ?)"
      )
      .bind(now - 3600000, now + 3600000, now)
      .run()
    for (let i = 1; i <= 4; i++)
      await db
        .prepare(
          "INSERT INTO inventory (id, event_id, ticket_type_id, section, row, number) VALUES (?, 'event', 'type', 'Ә', 'Б', ?)"
        )
        .bind(`seat-${i}`, String(i))
        .run()
    for (const [actor, permission] of [
      ["scanner", "ticket:scan"],
      ["manager", "event:manage"],
    ])
      await db
        .prepare(
          "INSERT INTO event_permissions (user_id, event_id, permission, granted_at) VALUES (?, 'event', ?, ?)"
        )
        .bind(actor, permission, now)
        .run()
    const files = (await storage.getR2Bucket("FILES")) as unknown as R2Bucket
    const env = {
      DB: db,
      FILES: files,
      APP_ORIGIN: "http://localhost:5173",
      TICKET_ENCRYPTION_KEY: "A".repeat(43),
    }
    await activateTestEvent(db, "event", "owner", now)
    const checkout = await startCheckout(
      db,
      "buyer",
      {
        requestId: "basket",
        eventId: "event",
        items: [
          {
            ticketTypeId: "type",
            quantity: 1,
            seatIds: ["seat-1"],
            attendeeNames: ["Әлия Ғалымқызы / Анна Иванова"],
          },
        ],
      },
      { now: () => now }
    )
    const provider = new RecordedProvider()
    const payment = await startOrderPayment(
      env,
      provider,
      "buyer",
      checkout.order.id,
      { requestId: "payment", expectedRevision: 0 },
      { now: () => now }
    )
    provider.state = "succeeded"
    await processPayment(env, provider, payment.payment.id, { now: () => now })
    const ticketId = await db
      .prepare("SELECT id FROM tickets WHERE order_id = ?")
      .bind(checkout.order.id)
      .first<string>("id")
    if (!ticketId)
      throw new Error("Fixture payment did not issue a canonical ticket")
    const delivered = await readTicket(env, "buyer", ticketId, true)
    if (!("credential" in delivered) || !delivered.credential)
      throw new Error("Fixture credential unavailable")
    return {
      db,
      files,
      env,
      now,
      ticketId,
      orderId: checkout.order.id,
      credential: delivered.credential,
      dispose: async () => {
        await Promise.all([database.runtime.dispose(), storage.dispose()])
      },
    }
  } catch (error) {
    await Promise.all([database.runtime.dispose(), storage.dispose()])
    throw error
  }
}
