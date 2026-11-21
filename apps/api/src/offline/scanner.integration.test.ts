import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { Hono } from "hono"
import { createAuthTestDatabase } from "../auth/test-database"
import { startCheckout } from "../orders/checkout"
import { completeZeroTotalOrder } from "../tickets/issue"
import { readTicket } from "../tickets/read"
import { reverseCheckIn, scanOnline } from "../tickets/scan"
import {
  getScannerEvent,
  listScannerEvents,
  searchScannerAttendees,
} from "./scanner"
import { createOfflineRoutes } from "./index"

describe("assigned native scanner queries on D1", () => {
  let fixture: Awaited<ReturnType<typeof createAuthTestDatabase>>
  let db: D1Database
  let now: number
  const clock = () => now
  const id = () => crypto.randomUUID()
  const env = () => ({ DB: db, TICKET_ENCRYPTION_KEY: "A".repeat(43) })
  beforeEach(async () => {
    fixture = await createAuthTestDatabase()
    db = fixture.DB
    now = Date.now()
    await db.batch(
      ["owner", "buyer", "scanner", "lead", "other"].map((account) =>
        db
          .prepare(
            "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
          )
          .bind(account, account, `${account}@example.test`, now, now)
      )
    )
    await db.batch(
      ["event-a", "event-b"].map((eventId) =>
        db
          .prepare(`INSERT INTO events (id, organizer_id, title, description, category, venue_name, venue_address, starts_at, ends_at, registration_opens_at, registration_closes_at, capacity, max_tickets_per_order, publication_state, calendar_uid, reporting_id, created_at, updated_at)
      VALUES (?, 'owner', 'Scanner fixture', 'Description', 'Music', 'Hall', 'Address', ?, ?, ?, ?, 20, 20, 'published', ?, ?, ?, ?)`)
          .bind(
            eventId,
            now + 3600_000,
            now + 7200_000,
            now - 3600_000,
            now + 3600_000,
            `calendar-${eventId}`,
            `report-${eventId}`,
            now,
            now
          )
      )
    )
    await db
      .prepare(
        "INSERT INTO ticket_types (id, event_id, name, kind, price_minor, quantity, sales_start_at, sales_end_at, updated_at) VALUES ('type', 'event-a', 'Free admission', 'free', 0, 20, ?, ?, ?)"
      )
      .bind(now - 3600_000, now + 3600_000, now)
      .run()
    await db
      .prepare(
        "INSERT INTO inventory (id, event_id, ticket_type_id) SELECT 'slot-' || value, 'event-a', 'type' FROM json_each(?)"
      )
      .bind(JSON.stringify(Array.from({ length: 20 }, (_, index) => index)))
      .run()
    await db.batch([
      db
        .prepare(
          "INSERT INTO event_permissions (user_id, event_id, permission, granted_at) VALUES ('scanner', 'event-a', 'ticket:scan', ?) "
        )
        .bind(now),
      db
        .prepare(
          "INSERT INTO event_permissions (user_id, event_id, permission, granted_at) VALUES ('lead', 'event-a', 'checkin:reverse', ?) "
        )
        .bind(now),
    ])
  })
  afterEach(async () => {
    await fixture?.runtime.dispose()
  })
  async function issue(names = ["Guest"]) {
    const checkout = await startCheckout(
      db,
      "buyer",
      {
        requestId: id(),
        eventId: "event-a",
        items: [
          {
            ticketTypeId: "type",
            quantity: names.length,
            attendeeNames: names,
          },
        ],
      },
      { now: clock }
    )
    const complete = await completeZeroTotalOrder(
      env(),
      "buyer",
      checkout.order.id,
      { requestId: id(), expectedRevision: checkout.revision },
      { now: clock }
    )
    return { orderId: checkout.order.id, ticketIds: complete.ticketIds }
  }
  const revokeScanner = () =>
    db
      .prepare(
        "UPDATE event_permissions SET revoked_at = ? WHERE user_id = 'scanner' AND event_id = 'event-a' AND permission = 'ticket:scan'"
      )
      .bind(now)
      .run()

  it("lists only explicit scan assignments, never owner or reversal authority", async () => {
    expect(
      (await listScannerEvents(db, "scanner")).items.map((event) => event.id)
    ).toEqual(["event-a"])
    expect((await listScannerEvents(db, "owner")).items).toEqual([])
    expect((await listScannerEvents(db, "lead")).items).toEqual([])
    await expect(getScannerEvent(db, "owner", "event-a")).rejects.toThrow()
    await expect(
      searchScannerAttendees(db, "scanner", "event-b")
    ).rejects.toThrow()
    await revokeScanner()
    expect((await listScannerEvents(db, "scanner")).items).toEqual([])
    await expect(getScannerEvent(db, "scanner", "event-a")).rejects.toThrow()
  })

  it("should return the first gallery image as the cover", async () => {
    expect(
      (await getScannerEvent(db, "scanner", "event-a")).coverImageUrl
    ).toBeNull()
    for (const position of [1, 0]) {
      const asset = `cover-asset-${position}`
      await db.batch([
        db
          .prepare(`INSERT INTO event_image_assets(id,event_id,uploader_id,request_id,input_hash,expected_revision,alt_text,object_key,content_type,original_size,content_size,content_sha256,created_at,expires_at)
          VALUES (?,'event-a','owner',?,?,0,'Hall',?,'image/png',100,100,?,?,?)`)
          .bind(
            asset,
            `cover-upload-${position}`,
            "a".repeat(64),
            `private/event-images/${asset}`,
            "b".repeat(64),
            now,
            now + 3600000
          ),
        db
          .prepare("UPDATE event_image_assets SET state='ready' WHERE id=?")
          .bind(asset),
        db
          .prepare(
            "INSERT INTO event_images(id,event_id,asset_id,position,alt_text,created_at) VALUES (?,'event-a',?,?,'Hall',?)"
          )
          .bind(`cover-${position}`, asset, position, now),
      ])
    }
    const expected = "/api/events/event-a/images/cover-0"
    expect(
      (await getScannerEvent(db, "scanner", "event-a")).coverImageUrl
    ).toBe(expected)
    expect(
      (await listScannerEvents(db, "scanner")).items[0]?.coverImageUrl
    ).toBe(expected)
  })

  it("bounds event pages and scopes cursors to the authenticated scanner", async () => {
    await db
      .prepare(
        "INSERT INTO event_permissions (user_id, event_id, permission, granted_at) VALUES ('scanner', 'event-b', 'ticket:scan', ?)"
      )
      .bind(now)
      .run()
    const page = await listScannerEvents(db, "scanner", { limit: 1 })
    expect(page.items.map((event) => event.id)).toEqual(["event-a"])
    expect(page.nextCursor).not.toBeNull()
    expect(
      (
        await listScannerEvents(db, "scanner", {
          limit: 1,
          cursor: page.nextCursor,
        })
      ).items.map((event) => event.id)
    ).toEqual(["event-b"])
    await expect(
      listScannerEvents(db, "other", { cursor: page.nextCursor })
    ).rejects.toThrow()
    await expect(
      listScannerEvents(db, "scanner", { limit: 101 })
    ).rejects.toThrow()
  })

  it("reports canonical counts after admission and independently authorized reversal", async () => {
    const { ticketIds, orderId } = await issue(["First guest", "Second guest"])
    const ticket = await readTicket(env(), "buyer", ticketIds[0]!, true)
    expect((await getScannerEvent(db, "scanner", "event-a")).counts).toEqual({
      registered: 2,
      checkedIn: 0,
      unresolvedOffline: 0,
    })
    const scan = await scanOnline(
      db,
      "scanner",
      { eventId: "event-a", operationId: id(), credential: ticket.credential! },
      { now: clock }
    )
    expect(
      (await getScannerEvent(db, "scanner", "event-a")).counts.checkedIn
    ).toBe(1)
    const attendees = await searchScannerAttendees(db, "scanner", "event-a")
    expect(
      attendees.items.find((item) => item.ticketId === ticketIds[0])
        ?.activeCheckInId
    ).toBe(scan.checkInId)
    await expect(
      reverseCheckIn(
        db,
        "scanner",
        "event-a",
        scan.checkInId!,
        { requestId: id(), reason: "Mistaken admission" },
        clock
      )
    ).rejects.toThrow()
    await reverseCheckIn(
      db,
      "lead",
      "event-a",
      scan.checkInId!,
      { requestId: id(), reason: "Mistaken admission" },
      clock
    )
    expect(
      (await getScannerEvent(db, "scanner", "event-a")).counts.checkedIn
    ).toBe(0)
    await db
      .prepare("UPDATE orders SET admission_blocked_at = ? WHERE id = ?")
      .bind(now, orderId)
      .run()
    expect(
      (await getScannerEvent(db, "scanner", "event-a")).counts.registered
    ).toBe(0)
    expect(
      (await searchScannerAttendees(db, "scanner", "event-a")).items.every(
        (item) => item.admissionBlocked
      )
    ).toBe(true)
  })

  it("searches literal names without exposing contacts or credentials and isolates pagination queries", async () => {
    await issue(["A_100% Guest", "Ordinary Guest", "Other Guest"])
    const literal = await searchScannerAttendees(db, "scanner", "event-a", {
      q: "_100%",
    })
    expect(literal.items.map((item) => item.attendeeName)).toEqual([
      "A_100% Guest",
    ])
    expect(JSON.stringify(literal)).not.toMatch(
      /@example\.test|token|credential|email|phone/i
    )
    const page = await searchScannerAttendees(db, "scanner", "event-a", {
      q: "Guest",
      limit: 1,
    })
    const second = await searchScannerAttendees(db, "scanner", "event-a", {
      q: "Guest",
      limit: 1,
      cursor: page.nextCursor,
    })
    expect(second.items[0]!.ticketId).not.toBe(page.items[0]!.ticketId)
    await expect(
      searchScannerAttendees(db, "scanner", "event-a", {
        q: "Other",
        cursor: page.nextCursor,
      })
    ).rejects.toThrow()
    await expect(
      searchScannerAttendees(db, "scanner", "event-a", { q: "x".repeat(101) })
    ).rejects.toThrow()
  })

  it.each(["grant", "account", "verification"])(
    "denies attendee output when %s eligibility changes before the authorized read",
    async (change) => {
      await issue()
      await expect(
        searchScannerAttendees(
          db,
          "scanner",
          "event-a",
          {},
          {
            beforeRead: async () => {
              if (change === "grant") await revokeScanner()
              else if (change === "verification")
                await db
                  .prepare(
                    "UPDATE user SET email_verified = 0 WHERE id = 'scanner'"
                  )
                  .run()
              else
                await db
                  .prepare(
                    "INSERT INTO profiles (user_id, suspended_at) VALUES ('scanner', ?)"
                  )
                  .bind(now)
                  .run()
            },
          }
        )
      ).rejects.toThrow()
    }
  )

  it("returns cancellation and suspension state with no eligible admissions", async () => {
    await issue()
    await db
      .prepare("UPDATE events SET suspended_at = ? WHERE id = 'event-a'")
      .bind(now)
      .run()
    const suspended = await getScannerEvent(db, "scanner", "event-a")
    expect(suspended.suspendedAt).toBe(new Date(now).toISOString())
    expect(suspended.counts.registered).toBe(0)
    await db
      .prepare(
        "UPDATE events SET suspended_at = NULL, cancelled_at = ? WHERE id = 'event-a'"
      )
      .bind(now)
      .run()
    expect((await listScannerEvents(db, "scanner")).items[0]!.cancelledAt).toBe(
      new Date(now).toISOString()
    )
    expect(
      (await searchScannerAttendees(db, "scanner", "event-a")).items[0]!
        .admissionBlocked
    ).toBe(true)
  })

  it("exposes authenticated scanner list, summary and attendee routes", async () => {
    const app = new Hono().route(
      "/api",
      createOfflineRoutes({ identify: async () => "scanner" })
    )
    for (const path of [
      "/scanner/events",
      "/scanner/events/event-a",
      "/scanner/events/event-a/attendees?q=Guest",
    ]) {
      expect((await app.request(`/api${path}`, undefined, env())).status).toBe(
        200
      )
    }
  })
})
