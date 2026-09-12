import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test"
import {
  createCampaignRequestSchema,
  createEventRequestSchema,
  createTicketTypeRequestSchema,
  eventDetailResponseSchema,
  eventListResponseSchema,
  inventoryResponseSchema,
  updateEventRequestSchema,
} from "@elc/shared"
import { createAuth, type AuthEmail } from "../auth"
import { createAuthTestDatabase } from "../auth/test-database"
import { ApiFailure } from "../db/transitions"
import type { Bindings } from "../env"
import { startCheckout } from "../orders/checkout"
import { completeZeroTotalOrder } from "../tickets/issue"
import { createEventsRoutes } from "./index"
import {
  createCampaign,
  createEvent,
  createTicketType,
  hashCampaignToken,
  setCampaignEnabled,
  setPublication,
  setSeatEnabled,
  updateEvent,
  updateTicketType,
} from "./mutations"
import { listEvents, readCampaigns, readEvent, readInventory } from "./queries"
import type { EventContext } from "./store"

describe("event and campaign transitions on D1", () => {
  let database: Awaited<ReturnType<typeof createAuthTestDatabase>>
  let db: D1Database
  let env: Bindings
  const now = Date.now()
  const iso = (offset: number) => new Date(now + offset).toISOString()
  const revision = (value: number) => ({
    requestId: crypto.randomUUID(),
    expectedRevision: value,
  })
  const context = (actorId = "owner", databaseOverride = db): EventContext => ({
    db: databaseOverride,
    actorId,
    correlationId: crypto.randomUUID(),
    appOrigin: "http://localhost:5173",
    now,
  })
  const definition = (changes: Record<string, unknown> = {}) =>
    createEventRequestSchema.parse({
      requestId: crypto.randomUUID(),
      title: "Campus concert",
      description: "A test event for the academic demo.",
      category: "Music",
      venueName: "Campus hall",
      venueAddress: "Almaty campus",
      startsAt: iso(3_600_000),
      endsAt: iso(7_200_000),
      registrationOpensAt: iso(-3_600_000),
      registrationClosesAt: iso(3_600_000),
      capacity: 4,
      maxTicketsPerOrder: 4,
      ...changes,
    })
  const typeInput = (
    eventId: string,
    expectedRevision = 0,
    changes: Record<string, unknown> = {}
  ) =>
    createTicketTypeRequestSchema.parse({
      ...revision(expectedRevision),
      eventId,
      name: "Admission",
      kind: "free",
      priceMinor: 0,
      quantity: 4,
      salesStartAt: iso(-3_600_000),
      salesEndAt: iso(3_600_000),
      ...changes,
    })
  const event = async (changes: Record<string, unknown> = {}) =>
    createEvent(context(), definition(changes))
  async function published(changes: Record<string, unknown> = {}) {
    const created = await event(changes)
    const type = await createTicketType(
      context(),
      created.eventId,
      typeInput(created.eventId)
    )
    await setPublication(context(), created.eventId, revision(1), true)
    return {
      eventId: created.eventId,
      ticketTypeId: type.resourceId,
      revision: 2,
    }
  }
  const number = async (sql: string, ...bindings: unknown[]) =>
    db
      .prepare(sql)
      .bind(...bindings)
      .first<number>("n")

  beforeAll(async () => {
    database = await createAuthTestDatabase()
    db = database.DB
    env = {
      DB: db,
      APP_ORIGIN: "http://localhost:5173",
      AUTH_URL: "http://localhost:8787",
      AUTH_SECRET: "test-only-auth-secret-with-more-than-32-characters",
      EMAIL_FROM: "elc <noreply@example.test>",
      ENVIRONMENT: "local",
    } as Bindings
    for (const id of [
      "owner",
      "buyer",
      "other",
      "manager",
      "scanner",
      "unverified",
      "suspended",
    ]) {
      await db
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
        .run()
    }
    await db
      .prepare(
        "INSERT INTO profiles (user_id, suspended_at, updated_at) VALUES ('suspended', ?, ?)"
      )
      .bind(now, now)
      .run()
  })
  afterAll(async () => {
    await database?.runtime.dispose()
  })

  it("keeps drafts private and requires a verified active owner to mutate", async () => {
    for (const id of ["unverified", "suspended"])
      await expect(
        createEvent(context(id), definition())
      ).rejects.toMatchObject({ status: 403 })
    const created = await event()
    await expect(readEvent(db, created.eventId, now)).rejects.toMatchObject({
      status: 404,
    })
    await expect(
      readEvent(db, created.eventId, now, "other", true)
    ).rejects.toMatchObject({ status: 403 })
    const draft = await readEvent(db, created.eventId, now, "owner", true)
    expect(draft.event).toMatchObject({
      publicationState: "draft",
      paidSalesState: "pending",
      revision: 0,
    })
    expect(eventDetailResponseSchema.safeParse(draft).success).toBe(true)
    await expect(
      setPublication(context("other"), created.eventId, revision(0), true)
    ).rejects.toMatchObject({ status: 403 })
  })

  it("publishes complete ticket inventory without activating paid sales and can unpublish", async () => {
    const created = await event()
    await expect(
      setPublication(context(), created.eventId, revision(0), true)
    ).rejects.toMatchObject({ status: 409 })
    await createTicketType(
      context(),
      created.eventId,
      typeInput(created.eventId, 0, { kind: "paid", priceMinor: 250_000 })
    )
    await setPublication(context(), created.eventId, revision(1), true)
    const visible = await readEvent(db, created.eventId, now)
    expect(visible.event).toMatchObject({
      publicationState: "published",
      paidSalesState: "pending",
      revision: 2,
    })
    expect(visible.ticketTypes[0]).toMatchObject({
      quantity: 4,
      available: 4,
      sold: 0,
      reserved: 0,
    })
    await setPublication(context(), created.eventId, revision(2), false)
    await expect(readEvent(db, created.eventId, now)).rejects.toMatchObject({
      status: 404,
    })
    expect(
      (await readEvent(db, created.eventId, now, "owner", true)).event
        .publicationState
    ).toBe("unpublished")
  })

  it("filters discovery and paginates deterministically while link-only events remain readable", async () => {
    const unique = `Discovery ${crypto.randomUUID()}`
    const first = await published({ title: unique, category: unique })
    const second = await published({
      title: unique,
      category: unique,
      startsAt: iso(4_000_000),
    })
    const unlisted = await published({
      title: unique,
      category: unique,
      visibility: "unlisted",
    })
    const privateEvent = await published({
      title: unique,
      category: unique,
      visibility: "private",
    })
    const suspended = await published({ title: unique, category: unique })
    const completed = await published({ title: unique, category: unique })
    const cancelled = await published({ title: unique, category: unique })
    await db
      .prepare("UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?")
      .bind(now - 7200000, now - 3600000, completed.eventId)
      .run()
    await db
      .prepare("UPDATE events SET cancelled_at = ? WHERE id = ?")
      .bind(now, cancelled.eventId)
      .run()
    await db
      .prepare("UPDATE events SET suspended_at = ? WHERE id = ?")
      .bind(now, suspended.eventId)
      .run()
    const results = await listEvents(
      db,
      {
        limit: 1,
        category: unique,
        q: unique,
        phase: "upcoming",
        startsFrom: iso(0),
        startsBefore: iso(5_000_000),
      },
      now
    )
    expect(eventListResponseSchema.safeParse(results).success).toBe(true)
    expect(results.items.map((item) => item.id)).toEqual([first.eventId])
    expect(results.nextCursor).toBeTruthy()
    const next = await listEvents(
      db,
      { limit: 1, category: unique, cursor: results.nextCursor! },
      now
    )
    expect(next.items.map((item) => item.id)).toEqual([second.eventId])
    expect(next.nextCursor).toBeNull()
    expect((await readEvent(db, unlisted.eventId, now)).event.visibility).toBe(
      "unlisted"
    )
    await expect(
      readEvent(db, privateEvent.eventId, now, "buyer")
    ).rejects.toMatchObject({ status: 404 })
    expect(
      (await listEvents(db, { limit: 100, category: unique }, now, "owner"))
        .items
    ).toHaveLength(7)
    expect(
      (
        await listEvents(
          db,
          { limit: 20, category: unique, phase: "completed" },
          now
        )
      ).items.map((item) => item.id)
    ).toEqual([completed.eventId])
    expect(
      (
        await listEvents(
          db,
          { limit: 20, category: unique, phase: "cancelled" },
          now
        )
      ).items.map((item) => item.id)
    ).toEqual([cancelled.eventId])
    await expect(
      listEvents(db, { limit: 1, cursor: "invalid" }, now)
    ).rejects.toMatchObject({ status: 400 })
  })

  it("separates scan grants from event management and private invitations", async () => {
    const created = await published({ visibility: "private" })
    await db
      .prepare(
        "INSERT INTO event_permissions (event_id, user_id, permission, granted_at) VALUES (?, 'scanner', 'ticket:scan', ?)"
      )
      .bind(created.eventId, now)
      .run()
    expect(
      (await readEvent(db, created.eventId, now, "scanner")).event.id
    ).toBe(created.eventId)
    await expect(
      readEvent(db, created.eventId, now, "scanner", true)
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      setPublication(context("scanner"), created.eventId, revision(2), false)
    ).rejects.toMatchObject({ status: 403 })
    await db
      .prepare(`INSERT INTO invitations (id, event_id, email, token_hash, expires_at, accepted_by, accepted_at, created_at)
      VALUES (?, ?, 'BUYER@example.test', ?, ?, 'buyer', ?, ?)`)
      .bind(
        crypto.randomUUID(),
        created.eventId,
        crypto.randomUUID(),
        now + 60_000,
        now,
        now
      )
      .run()
    expect((await readEvent(db, created.eventId, now, "buyer")).event.id).toBe(
      created.eventId
    )
    await expect(
      readEvent(db, created.eventId, now, "other")
    ).rejects.toMatchObject({ status: 404 })
  })

  it("replays identical mutations once and rejects changed input or stale revisions", async () => {
    const input = definition()
    const created = await createEvent(context(), input)
    expect(await createEvent(context(), input)).toEqual(created)
    await expect(
      createEvent(context(), { ...input, title: "Changed" })
    ).rejects.toMatchObject({ status: 409 })
    const update = updateEventRequestSchema.parse({
      ...input,
      ...revision(0),
      title: "Revised title",
    })
    const changed = await updateEvent(context(), created.eventId, update)
    expect(await updateEvent(context(), created.eventId, update)).toEqual(
      changed
    )
    await expect(
      updateEvent(context(), created.eventId, {
        ...update,
        requestId: crypto.randomUUID(),
      })
    ).rejects.toMatchObject({ status: 409 })
    const detail = await readEvent(db, created.eventId, now, "owner", true)
    expect(detail.event).toMatchObject({
      title: "Revised title",
      revision: 1,
      calendar: { sequence: 1 },
    })
    expect(
      await number(
        "SELECT COUNT(*) AS n FROM audit_entries WHERE event_id = ?",
        created.eventId
      )
    ).toBe(2)
    expect(
      await number(
        "SELECT COUNT(*) AS n FROM outbox WHERE entity_id = ? AND kind = 'event.changed'",
        created.eventId
      )
    ).toBe(2)
  })

  it("serializes competing capacity changes and rolls back every side effect on overflow", async () => {
    const created = await event({ capacity: 3, maxTicketsPerOrder: 3 })
    const attempts = await Promise.allSettled(
      ["First", "Second"].map((name) =>
        createTicketType(
          context(),
          created.eventId,
          typeInput(created.eventId, 0, { name, quantity: 2 })
        )
      )
    )
    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled")
    ).toHaveLength(1)
    expect(
      attempts.filter((attempt) => attempt.status === "rejected")
    ).toHaveLength(1)
    const overflow = typeInput(created.eventId, 1, { quantity: 2 })
    await expect(
      createTicketType(context(), created.eventId, overflow)
    ).rejects.toMatchObject({ status: 409 })
    expect(
      await number(
        "SELECT COUNT(*) AS n FROM inventory WHERE event_id = ?",
        created.eventId
      )
    ).toBe(2)
    expect(
      await number(
        "SELECT COUNT(*) AS n FROM ticket_types WHERE event_id = ?",
        created.eventId
      )
    ).toBe(1)
    expect(
      await number(
        "SELECT COUNT(*) AS n FROM audit_entries WHERE event_id = ?",
        created.eventId
      )
    ).toBe(2)
    expect(
      await number(
        "SELECT COUNT(*) AS n FROM outbox WHERE entity_id = ? AND kind = 'event.changed'",
        created.eventId
      )
    ).toBe(2)
    expect(
      await number(
        "SELECT COUNT(*) AS n FROM request_receipts WHERE request_id = ?",
        overflow.requestId
      )
    ).toBe(0)
    await expect(
      updateEvent(
        context(),
        created.eventId,
        updateEventRequestSchema.parse({
          ...definition({ capacity: 1, maxTicketsPerOrder: 1 }),
          ...revision(1),
        })
      )
    ).rejects.toMatchObject({ status: 409 })
  })

  it("rechecks an event grant in the transaction after a concurrent revocation", async () => {
    const created = await event()
    await db
      .prepare(
        "INSERT INTO event_permissions (event_id, user_id, permission, granted_at) VALUES (?, 'manager', 'event:manage', ?)"
      )
      .bind(created.eventId, now)
      .run()
    let revoke = true
    const interrupted = new Proxy(db, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            if (revoke) {
              revoke = false
              await db
                .prepare(
                  "UPDATE event_permissions SET revoked_at = ? WHERE event_id = ? AND user_id = 'manager'"
                )
                .bind(now, created.eventId)
                .run()
            }
            return target.batch(statements)
          }
        const value = Reflect.get(target, property)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    await expect(
      createTicketType(
        context("manager", interrupted),
        created.eventId,
        typeInput(created.eventId)
      )
    ).rejects.toMatchObject({ status: 403 })
    expect(
      await number(
        "SELECT COUNT(*) AS n FROM ticket_types WHERE event_id = ?",
        created.eventId
      )
    ).toBe(0)
    expect(
      await number(
        "SELECT COUNT(*) AS n FROM audit_entries WHERE event_id = ?",
        created.eventId
      )
    ).toBe(1)
  })

  it("keeps one inventory row per ticket and will not shrink through a live reservation", async () => {
    const created = await published()
    await startCheckout(
      db,
      "buyer",
      {
        requestId: crypto.randomUUID(),
        eventId: created.eventId,
        items: [
          {
            ticketTypeId: created.ticketTypeId,
            quantity: 3,
            attendeeNames: ["One", "Two", "Three"],
          },
        ],
      },
      { now: () => now }
    )
    await expect(
      updateTicketType(
        context(),
        created.eventId,
        created.ticketTypeId,
        typeInput(created.eventId, 2, { quantity: 2 })
      )
    ).rejects.toMatchObject({ status: 409 })
    expect(
      await number(
        "SELECT COUNT(*) AS n FROM inventory WHERE event_id = ?",
        created.eventId
      )
    ).toBe(4)
    await updateTicketType(
      context(),
      created.eventId,
      created.ticketTypeId,
      typeInput(created.eventId, 2, { quantity: 3 })
    )
    expect(
      await number(
        "SELECT COUNT(*) AS n FROM inventory WHERE event_id = ?",
        created.eventId
      )
    ).toBe(3)
    expect(
      (await readEvent(db, created.eventId, now)).ticketTypes[0]
    ).toMatchObject({ quantity: 3, reserved: 3, available: 0 })
    await updateTicketType(
      context(),
      created.eventId,
      created.ticketTypeId,
      typeInput(created.eventId, 3, { quantity: 4 })
    )
    expect(
      (await readEvent(db, created.eventId, now)).ticketTypes[0]
    ).toMatchObject({ quantity: 4, reserved: 3, available: 1 })
  })

  it("creates the fixed 80-seat hall and preserves seat identity while editing prices and availability", async () => {
    await expect(
      event({
        seatingMode: "assigned",
        venueLayoutId: "elc-demo-hall",
        capacity: 79,
      })
    ).rejects.toMatchObject({ status: 400 })
    const created = await event({
      seatingMode: "assigned",
      venueLayoutId: "elc-demo-hall",
      capacity: 80,
    })
    const another = await event({
      seatingMode: "assigned",
      venueLayoutId: "elc-demo-hall",
      capacity: 80,
    })
    const inventory = await readInventory(
      db,
      created.eventId,
      now,
      "owner",
      true
    )
    expect(inventoryResponseSchema.safeParse(inventory).success).toBe(true)
    expect(inventory.seats).toHaveLength(80)
    expect(inventory.seats.filter((seat) => seat.accessible)).toHaveLength(4)
    expect(
      inventory.ticketTypes.map((type) => [
        type.name,
        type.priceMinor,
        type.quantity,
      ])
    ).toEqual([
      ["Premium", 500_000, 40],
      ["Standard", 300_000, 40],
    ])
    const ids = new Set(inventory.seats.map((seat) => seat.id))
    expect(
      (
        await readInventory(db, another.eventId, now, "owner", true)
      ).seats.every((seat) => !ids.has(seat.id))
    ).toBe(true)
    const premium = inventory.ticketTypes[0]!
    await updateTicketType(
      context(),
      created.eventId,
      premium.id,
      typeInput(created.eventId, 0, {
        name: premium.name,
        quantity: 40,
        kind: "paid",
        priceMinor: 600_000,
      })
    )
    await setSeatEnabled(context(), created.eventId, inventory.seats[0]!.id, {
      ...revision(1),
      enabled: false,
    })
    const updated = await readInventory(db, created.eventId, now, "owner", true)
    expect(
      updated.seats.map(({ id, section, row, number, accessible }) => ({
        id,
        section,
        row,
        number,
        accessible,
      }))
    ).toEqual(
      inventory.seats.map(({ id, section, row, number, accessible }) => ({
        id,
        section,
        row,
        number,
        accessible,
      }))
    )
    expect(updated.seats[0]).toMatchObject({
      state: "unavailable",
      priceMinor: 600_000,
    })
    await expect(
      updateTicketType(
        context(),
        created.eventId,
        premium.id,
        typeInput(created.eventId, 2, {
          quantity: 39,
          kind: "paid",
          priceMinor: 600_000,
        })
      )
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      updateEvent(
        context(),
        created.eventId,
        updateEventRequestSchema.parse({
          ...definition({ capacity: 80 }),
          ...revision(2),
        })
      )
    ).rejects.toMatchObject({ status: 409 })
  })

  it("defaults campaigns to disabled, 10 percent, 100 uses, and the event sales window", async () => {
    const created = await published()
    const input = createCampaignRequestSchema.parse({
      ...revision(2),
      eventId: created.eventId,
      name: "Student invitation",
      applicableTicketTypeIds: [created.ticketTypeId],
    })
    const campaign = await createCampaign(context(), created.eventId, input)
    const read = (
      await readCampaigns(
        db,
        created.eventId,
        "owner",
        env.APP_ORIGIN,
        campaign.resourceId
      )
    ).items[0]!
    expect(read).toMatchObject({
      enabled: false,
      discount: { kind: "percentage", basisPoints: 1_000 },
      maxRedemptions: 100,
      startsAt: iso(-3_600_000),
      endsAt: iso(3_600_000),
      applicableTicketTypeIds: [created.ticketTypeId],
    })
    expect(new URL(read.campaignUrl).searchParams.get("campaign")).toBe(
      read.code
    )
    expect(JSON.stringify(read)).not.toContain("token_hash")
    expect(
      await db
        .prepare("SELECT token_hash FROM campaigns WHERE id = ?")
        .bind(campaign.resourceId)
        .first("token_hash")
    ).toBe(await hashCampaignToken(read.code))
    await expect(
      readCampaigns(db, created.eventId, "buyer", env.APP_ORIGIN)
    ).rejects.toMatchObject({ status: 403 })
    await setCampaignEnabled(
      context(),
      created.eventId,
      campaign.resourceId,
      revision(3),
      true
    )
    expect(
      (await readCampaigns(db, created.eventId, "owner", env.APP_ORIGIN))
        .items[0]?.enabled
    ).toBe(true)
    await setCampaignEnabled(
      context(),
      created.eventId,
      campaign.resourceId,
      revision(4),
      false
    )
    expect(
      (await readCampaigns(db, created.eventId, "owner", env.APP_ORIGIN))
        .items[0]?.enabled
    ).toBe(false)
    expect(
      (await readEvent(db, created.eventId, now)).event.paidSalesState
    ).toBe("pending")
    const other = await published()
    await expect(
      createCampaign(context(), created.eventId, {
        ...input,
        ...revision(5),
        applicableTicketTypeIds: [other.ticketTypeId],
      })
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      createCampaign(context(), created.eventId, {
        ...input,
        ...revision(5),
        applicableTicketTypeIds: [created.ticketTypeId, created.ticketTypeId],
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(
      await number(
        "SELECT COUNT(*) AS n FROM campaigns WHERE event_id = ?",
        created.eventId
      )
    ).toBe(1)
  })

  it("protects sold seat allocations and ticket snapshots during subsequent organizer edits", async () => {
    const created = await event({
      seatingMode: "assigned",
      venueLayoutId: "elc-demo-hall",
      capacity: 80,
    })
    const initial = await readInventory(db, created.eventId, now, "owner", true)
    const premium = initial.ticketTypes[0]!
    const seat = initial.seats[0]!
    await updateTicketType(
      context(),
      created.eventId,
      premium.id,
      typeInput(created.eventId, 0, {
        name: "Free invited admission",
        kind: "free",
        quantity: 40,
      })
    )
    await setPublication(context(), created.eventId, revision(1), true)
    const checkout = await startCheckout(
      db,
      "buyer",
      {
        requestId: crypto.randomUUID(),
        eventId: created.eventId,
        items: [
          {
            ticketTypeId: premium.id,
            quantity: 1,
            attendeeNames: ["Seat guest"],
            seatIds: [seat.id],
          },
        ],
      },
      { now: () => now }
    )
    await expect(
      setSeatEnabled(context(), created.eventId, seat.id, {
        ...revision(2),
        enabled: false,
      })
    ).rejects.toMatchObject({ status: 409 })
    const issued = await completeZeroTotalOrder(
      { DB: db, TICKET_ENCRYPTION_KEY: "A".repeat(43) },
      "buyer",
      checkout.order.id,
      { requestId: crypto.randomUUID(), expectedRevision: checkout.revision },
      { now: () => now }
    )
    const ticketBefore = await db
      .prepare("SELECT * FROM tickets WHERE id = ?")
      .bind(issued.ticketIds[0])
      .first()
    await expect(
      setSeatEnabled(context(), created.eventId, seat.id, {
        ...revision(2),
        enabled: false,
      })
    ).rejects.toMatchObject({ status: 409 })
    await updateTicketType(
      context(),
      created.eventId,
      premium.id,
      typeInput(created.eventId, 2, {
        name: "Repriced Premium",
        kind: "paid",
        priceMinor: 750_000,
        quantity: 40,
      })
    )
    expect(
      await db
        .prepare("SELECT * FROM tickets WHERE id = ?")
        .bind(issued.ticketIds[0])
        .first()
    ).toEqual(ticketBefore)
    expect(
      (await readInventory(db, created.eventId, now)).seats.find(
        (value) => value.id === seat.id
      )
    ).toMatchObject({
      state: "sold",
      section: seat.section,
      row: seat.row,
      number: seat.number,
      accessible: seat.accessible,
    })
  })

  it("bounds campaign queries and returns each campaign once across cursor pages", async () => {
    const created = await published()
    const ids: string[] = []
    for (const index of [0, 1, 2]) {
      const result = await createCampaign(
        context(),
        created.eventId,
        createCampaignRequestSchema.parse({
          ...revision(2 + index),
          eventId: created.eventId,
          name: `Campaign ${index}`,
          applicableTicketTypeIds: [created.ticketTypeId],
        })
      )
      ids.push(result.resourceId)
    }
    const page = await readCampaigns(
      db,
      created.eventId,
      "owner",
      env.APP_ORIGIN,
      undefined,
      { limit: 2 }
    )
    expect(page.items).toHaveLength(2)
    expect(page.nextCursor).toBeTruthy()
    const next = await readCampaigns(
      db,
      created.eventId,
      "owner",
      env.APP_ORIGIN,
      undefined,
      { limit: 2, cursor: page.nextCursor! }
    )
    expect(next.items).toHaveLength(1)
    expect(next.nextCursor).toBeNull()
    expect(
      [...page.items, ...next.items].map((item) => item.id).sort()
    ).toEqual(ids.sort())
  })

  function appWithActor(actorId?: string) {
    return new Hono<{ Bindings: Bindings; Variables: { requestId: string } }>()
      .route(
        "/api",
        createEventsRoutes({ identify: async () => actorId, now: () => now })
      )
      .onError((error, c) => {
        if (error instanceof HTTPException)
          return c.json(
            {
              error: {
                code: error instanceof ApiFailure ? error.code : "HTTP_ERROR",
                message: error.message,
              },
            },
            error.status
          )
        throw error
      })
  }

  it("validates HTTP contracts and does not accept identity, activation, or seat-label overrides", async () => {
    const ownerApp = appWithActor("owner")
    const send = (path: string, value: unknown, method = "POST") =>
      ownerApp.request(
        path,
        {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        },
        env
      )
    expect(
      (await appWithActor().request("/api/events", { method: "POST" }, env))
        .status
    ).toBe(401)
    expect(
      (await send("/api/events", { ...definition(), organizerId: "other" }))
        .status
    ).toBe(400)
    expect(
      (await send("/api/events", { ...definition(), paidSalesState: "active" }))
        .status
    ).toBe(400)
    const response = await send("/api/events", definition())
    expect(response.status).toBe(201)
    const result = (await response.json()) as { eventId: string }
    expect(
      (
        await ownerApp.request(
          `/api/events/${result.eventId}/preview`,
          undefined,
          env
        )
      ).status
    ).toBe(200)
    expect(
      (
        await send(
          `/api/events/${result.eventId}/inventory/fake`,
          { ...revision(0), enabled: false, row: "Z" },
          "PATCH"
        )
      ).status
    ).toBe(400)
    expect(
      (await ownerApp.request("/api/events?limit=1000", undefined, env)).status
    ).toBe(400)
    expect(
      (await ownerApp.request("/api/events?unknown=1", undefined, env)).status
    ).toBe(400)
  })

  it("authenticates the production route factory with a real Better Auth session cookie", async () => {
    const mailbox: AuthEmail[] = []
    const auth = createAuth(env, {
      sendEmail: async (email) => {
        mailbox.push(email)
      },
    })
    const account = {
      email: "event-cookie@example.test",
      name: "Cookie owner",
      password: "event-test-password-123",
    }
    const postAuth = (path: string) =>
      auth.handler(
        new Request(`${env.AUTH_URL}/api/auth${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: env.APP_ORIGIN,
          },
          body: JSON.stringify(account),
        })
      )
    expect((await postAuth("/sign-up/email")).status).toBe(200)
    const link = mailbox
      .find((email) => email.kind === "verify-email")
      ?.text.match(/https?:\/\/[^\s]+/)?.[0]
    expect(link).toBeTruthy()
    expect((await auth.handler(new Request(link!))).status).toBe(302)
    const signIn = await postAuth("/sign-in/email")
    expect(signIn.status).toBe(200)
    const cookie = signIn.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ")
    const app = new Hono<{
      Bindings: Bindings
      Variables: { requestId: string }
    }>().route("/api", createEventsRoutes())
    const response = await app.request(
      "/api/events",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify(definition()),
      },
      env
    )
    expect(response.status).toBe(201)
    const result = (await response.json()) as { eventId: string }
    const owner = await db
      .prepare(
        "SELECT u.email FROM events e JOIN user u ON u.id = e.organizer_id WHERE e.id = ?"
      )
      .bind(result.eventId)
      .first("email")
    expect(owner).toBe(account.email)
  })
})
