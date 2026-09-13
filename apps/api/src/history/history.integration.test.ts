import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import {
  createEventRequestSchema,
  createTicketTypeRequestSchema,
  demoVenue,
} from "@elc/shared"
import { createAuthTestDatabase } from "../auth/test-database"
import {
  createEvent,
  createTicketType,
  setPublication,
  updateTicketType,
} from "../events/mutations"
import { findEvent, type EventContext } from "../events/store"
import { listEvents, readEvent } from "../events/queries"
import { createSupportCase } from "../support/service"
import { startCheckout } from "../orders/checkout"
import { completeZeroTotalOrder } from "../tickets/issue"
import { activateTestEvent } from "../activation/test-fixture"
import { listOrganizerHistory, readEventHistory } from "./queries"
import { duplicatePastEvent } from "./duplicate"
import { createHistoryRoutes } from "./index"
import type { Bindings } from "../env"

const day = 86400000
const iso = (at: number) => new Date(at).toISOString()
describe("organizer history and duplication on real D1", () => {
  let database: Awaited<ReturnType<typeof createAuthTestDatabase>>,
    db: D1Database
  let now: number, eventId: string, typeId: string
  const clock = () => now
  const context = (actorId = "owner", at = now - 3 * day): EventContext => ({
    db,
    actorId,
    now: at,
    correlationId: crypto.randomUUID(),
    appOrigin: "https://history.example.test",
  })
  const definition = (changes: Record<string, unknown> = {}) =>
    createEventRequestSchema.parse({
      requestId: crypto.randomUUID(),
      title: "Past campus event",
      description: "Reusable description",
      category: "Education",
      venueName: "Campus hall",
      venueAddress: "Almaty",
      startsAt: iso(now - 2 * day),
      endsAt: iso(now - day),
      registrationOpensAt: iso(now - 4 * day),
      registrationClosesAt: iso(now - 2 * day),
      capacity: 4,
      maxTicketsPerOrder: 4,
      refundInstructions: "Contact event support.",
      ...changes,
    })
  const typeInput = (
    id: string,
    revision = 0,
    changes: Record<string, unknown> = {}
  ) =>
    createTicketTypeRequestSchema.parse({
      requestId: crypto.randomUUID(),
      expectedRevision: revision,
      eventId: id,
      name: "Admission",
      description: "Reusable type",
      kind: "free",
      priceMinor: 0,
      quantity: 4,
      salesStartAt: iso(now - 4 * day),
      salesEndAt: iso(now - 2 * day),
      ...changes,
    })
  const request = (changes: Record<string, unknown> = {}) => ({
    requestId: crypto.randomUUID(),
    expectedRevision: 2,
    startsAt: iso(now + 2 * day),
    endsAt: iso(now + 3 * day),
    registrationOpensAt: iso(now + 3600000),
    registrationClosesAt: iso(now + 2 * day),
    ...changes,
  })
  const grant = (actor: string, permission: string, id = eventId) =>
    db
      .prepare(
        "INSERT INTO event_permissions (event_id,user_id,permission,granted_at) VALUES (?,?,?,?)"
      )
      .bind(id, actor, permission, now - 4 * day)
      .run()
  const audit = (
    id: string,
    action: string,
    at: number,
    scope = "event",
    entity = eventId,
    description = "Recorded history action"
  ) =>
    db
      .prepare(
        "INSERT INTO audit_entries (id,event_id,actor_id,scope,action,entity_id,description,correlation_id,created_at) VALUES (?,?,'owner',?,?,?,?,?,?)"
      )
      .bind(
        id,
        eventId,
        scope,
        action,
        entity,
        description,
        `correlation-${id}`,
        at
      )
      .run()
  beforeEach(async () => {
    database = await createAuthTestDatabase()
    db = database.DB
    now = Date.now()
    for (const actor of [
      "owner",
      "buyer",
      "manager",
      "historian",
      "analyst",
      "scanner",
      "other",
      "platform",
      "unverified",
    ])
      await db
        .prepare(
          "INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)"
        )
        .bind(
          actor,
          actor,
          `${actor}@example.test`,
          actor === "unverified" ? 0 : 1,
          now - 5 * day,
          now
        )
        .run()
    eventId = (await createEvent(context(), definition())).eventId
    typeId = (await createTicketType(context(), eventId, typeInput(eventId)))
      .resourceId
    await setPublication(
      context(),
      eventId,
      { requestId: "publish", expectedRevision: 1 },
      true
    )
    await grant("manager", "event:manage")
    await grant("historian", "history:read")
    await grant("analyst", "analytics:read")
    await grant("scanner", "ticket:scan")
    await db
      .prepare(
        "INSERT INTO platform_grants (user_id,permission,granted_at) VALUES ('platform','platform:moderate',?)"
      )
      .bind(now)
      .run()
  })
  afterEach(async () => {
    await database?.runtime.dispose()
  })

  it("lists retained completed/cancelled events only under current history authority", async () => {
    const cancelled = (
      await createEvent(
        context(),
        definition({
          title: "Cancelled fixture",
          startsAt: iso(now + day),
          endsAt: iso(now + 2 * day),
        })
      )
    ).eventId
    await db
      .prepare("UPDATE events SET cancelled_at=? WHERE id=?")
      .bind(now, cancelled)
      .run()
    await createEvent(
      context(),
      definition({
        title: "Upcoming",
        startsAt: iso(now + day),
        endsAt: iso(now + 2 * day),
      })
    )
    expect(
      (await listOrganizerHistory(db, "owner", {}, { now: clock })).items.map(
        (item) => item.event.phase
      )
    ).toEqual(["cancelled", "completed"])
    const history = await listOrganizerHistory(
      db,
      "historian",
      {},
      { now: clock }
    )
    expect(history.items.map((item) => item.event.id)).toEqual([eventId])
    expect(history.items[0]?.canDuplicate).toBe(false)
    for (const actor of [
      "manager",
      "analyst",
      "scanner",
      "other",
      "platform",
    ]) {
      expect(
        (await listOrganizerHistory(db, actor, {}, { now: clock })).items
      ).toEqual([])
      await expect(
        readEventHistory(db, actor, eventId, {}, { now: clock })
      ).rejects.toMatchObject({ status: 403 })
    }
    await expect(
      listOrganizerHistory(db, "unverified", {}, { now: clock })
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      readEventHistory(
        db,
        "historian",
        eventId,
        {},
        {
          now: clock,
          beforeReturn: async () => {
            await db
              .prepare(
                "UPDATE event_permissions SET revoked_at=? WHERE user_id='historian'"
              )
              .bind(now)
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ status: 403 })
    expect(
      (
        await listOrganizerHistory(
          db,
          "owner",
          { phase: "cancelled", q: "fixture" },
          { now: clock }
        )
      ).items.map((item) => item.event.id)
    ).toEqual([cancelled])
  })

  it("filters timeline by civil date/type and excludes platform/account and unauthorized support entries", async () => {
    const attendee = await createSupportCase(
      db,
      "buyer",
      {
        requestId: "attendee-case",
        audience: "attendee",
        category: "technical",
        subject: "Hidden subject",
        eventId,
        body: "Private message body",
      },
      { now: clock }
    )
    const platformCase = await createSupportCase(
      db,
      "owner",
      {
        requestId: "platform-case",
        audience: "organizer_platform",
        category: "account",
        subject: "Platform private subject",
        eventId,
        body: "Platform private body",
      },
      { now: clock }
    )
    await audit(
      "platform-audit",
      "moderation.private",
      now - 1000,
      "platform",
      platformCase.case.id,
      "Must not appear"
    )
    await audit(
      "account-audit",
      "account.changed",
      now - 1000,
      "account",
      "owner",
      "Must not appear"
    )
    await audit(
      "forged-event-case",
      "support.status",
      now - 1000,
      "event",
      platformCase.case.id,
      "Must not appear"
    )
    await audit(
      "missing-case",
      "support.status",
      now - 1000,
      "event",
      "missing",
      "Must not appear"
    )
    const owner = await readEventHistory(
      db,
      "owner",
      eventId,
      { activityType: "support" },
      { now: clock }
    )
    expect(owner.items).toHaveLength(1)
    expect(owner.items[0]?.entityId).toBe(attendee.case.id)
    expect(JSON.stringify(owner)).not.toContain("Private message body")
    expect(JSON.stringify(owner)).not.toContain("Must not appear")
    expect(
      (
        await readEventHistory(
          db,
          "historian",
          eventId,
          { activityType: "support" },
          { now: clock }
        )
      ).items
    ).toEqual([])
    await grant("historian", "support:manage")
    expect(
      (
        await readEventHistory(
          db,
          "historian",
          eventId,
          { activityType: "support" },
          { now: clock }
        )
      ).items
    ).toHaveLength(1)
    await db
      .prepare("UPDATE events SET time_zone='America/New_York' WHERE id=?")
      .bind(eventId)
      .run()
    // March 8, 2026 is a 23-hour day in this event's zone.
    await audit(
      "before-day",
      "checkin.created",
      Date.parse("2026-03-08T04:59:59Z")
    )
    await audit("in-day", "checkin.created", Date.parse("2026-03-08T05:00:00Z"))
    await audit(
      "after-day",
      "checkin.created",
      Date.parse("2026-03-09T04:00:00Z")
    )
    const filtered = await readEventHistory(
      db,
      "owner",
      eventId,
      {
        range: "custom",
        start: "2026-03-08",
        end: "2026-03-08",
        activityType: "checkin",
      },
      { now: clock }
    )
    expect(filtered.items.map((item) => item.id)).toEqual(["in-day"])
  })

  it("paginates tied timestamps without duplicates and rejects actor/filter cursor reuse", async () => {
    for (let i = 0; i < 5; i++)
      await audit(`tie-${i}`, "refund.pending", now - 1000)
    const first = await readEventHistory(
      db,
      "owner",
      eventId,
      { activityType: "refund", limit: 2 },
      { now: clock }
    )
    const second = await readEventHistory(
      db,
      "owner",
      eventId,
      { activityType: "refund", limit: 2, cursor: first.nextCursor! },
      { now: clock }
    )
    const third = await readEventHistory(
      db,
      "owner",
      eventId,
      { activityType: "refund", limit: 2, cursor: second.nextCursor! },
      { now: clock }
    )
    expect(
      [...first.items, ...second.items, ...third.items].map((item) => item.id)
    ).toEqual(["tie-0", "tie-1", "tie-2", "tie-3", "tie-4"])
    expect(third.nextCursor).toBeNull()
    await expect(
      readEventHistory(
        db,
        "historian",
        eventId,
        { activityType: "refund", cursor: first.nextCursor! },
        { now: clock }
      )
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      readEventHistory(
        db,
        "owner",
        eventId,
        { activityType: "event", cursor: first.nextCursor! },
        { now: clock }
      )
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      readEventHistory(
        db,
        "owner",
        eventId,
        { range: "custom", start: "2025-01-01", end: "2026-01-01" },
        { now: clock }
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  it("copies an ordered gallery to fresh event-scoped URLs while sharing immutable assets", async () => {
    for (const [index, alt] of [
      "Campus entrance",
      "Accessible auditorium",
    ].entries()) {
      const asset = `image-asset-${index}`,
        image = `image-link-${index}`
      await db.batch([
        db
          .prepare(`INSERT INTO event_image_assets(id,event_id,uploader_id,request_id,input_hash,expected_revision,alt_text,object_key,content_type,original_size,content_size,content_sha256,created_at,expires_at)
          VALUES (?,?,'owner',?,?,2,?,?,'image/png',100,100,?,?,?)`)
          .bind(
            asset,
            eventId,
            `image-upload-${index}`,
            "a".repeat(64),
            alt,
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
            "INSERT INTO event_images(id,event_id,asset_id,position,alt_text,created_at) VALUES (?,?,?,?,?,?)"
          )
          .bind(image, eventId, asset, index, alt, now),
      ])
    }
    const original = await readEvent(db, eventId, now)
    expect(original.event.images.map((image) => image.altText)).toEqual([
      "Campus entrance",
      "Accessible auditorium",
    ])
    expect(
      (await listEvents(db, { limit: 20, phase: "completed" }, now)).items.find(
        (event) => event.id === eventId
      )?.images
    ).toEqual(original.event.images)
    expect(
      (await readEventHistory(db, "owner", eventId, {}, { now: clock })).event
        .images
    ).toEqual(original.event.images)
    const result = await duplicatePastEvent(db, "manager", eventId, request(), {
      now: clock,
    })
    const duplicate = await readEvent(db, result.eventId, now, "manager", true)
    expect(duplicate.event.images.map((image) => image.altText)).toEqual(
      original.event.images.map((image) => image.altText)
    )
    expect(duplicate.event.images.map((image) => image.id)).not.toEqual(
      original.event.images.map((image) => image.id)
    )
    expect(duplicate.event.images[0]!.url).toContain(
      `/events/${result.eventId}/images/`
    )
    expect(
      (
        await db
          .prepare(
            "SELECT asset_id FROM event_images WHERE event_id=? ORDER BY position"
          )
          .bind(result.eventId)
          .all<{ asset_id: string }>()
      ).results
    ).toEqual([{ asset_id: "image-asset-0" }, { asset_id: "image-asset-1" }])
    expect(
      (
        await db
          .prepare("SELECT count(*) n FROM event_image_assets")
          .first<{ n: number }>()
      )?.n
    ).toBe(2)
    await expect(
      readEvent(db, result.eventId, now, "other")
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      db
        .prepare(
          "UPDATE event_image_assets SET state='deleting',retired_at=? WHERE id='image-asset-0'"
        )
        .bind(now)
        .run()
    ).rejects.toThrow()
    expect((await readEvent(db, eventId, now)).event.images).toEqual(
      original.event.images
    )
  })

  it("duplicates reusable general admission while preserving original tickets and excluding all history and grants", async () => {
    const env = { DB: db, TICKET_ENCRYPTION_KEY: "A".repeat(43) }
    const purchaseAt = now - 3 * day
    const checkout = await startCheckout(
      db,
      "buyer",
      {
        requestId: "purchase",
        eventId,
        items: [
          {
            ticketTypeId: typeId,
            quantity: 1,
            attendeeNames: ["Synthetic attendee"],
          },
        ],
      },
      { now: () => purchaseAt }
    )
    await completeZeroTotalOrder(
      env,
      "buyer",
      checkout.order.id,
      { requestId: "issue", expectedRevision: checkout.revision },
      { now: () => purchaseAt }
    )
    const support = await createSupportCase(
      db,
      "buyer",
      {
        requestId: "case",
        audience: "attendee",
        category: "refund",
        subject: "Past refund question",
        orderId: checkout.order.id,
        eventId,
        body: "Original history",
      },
      { now: clock }
    )
    await db
      .prepare(
        "INSERT INTO campaigns (id,event_id,name,code,token_hash,reporting_id,discount_kind,discount_value,starts_at,ends_at,updated_at) VALUES ('campaign',?,'Original campaign','original-code','private-token-hash','rpt_originalcampaign','percentage',1000,?,?,?)"
      )
      .bind(eventId, now - 4 * day, now - 2 * day, now - 3 * day)
      .run()
    const sourceBefore = await findEvent(db, eventId)
    const result = await duplicatePastEvent(db, "manager", eventId, request(), {
      now: clock,
    })
    const copied = await findEvent(db, result.eventId)
    expect(copied).toMatchObject({
      organizer_id: "manager",
      title: sourceBefore.title,
      description: sourceBefore.description,
      refund_instructions: sourceBefore.refund_instructions,
      publication_state: "draft",
      paid_sales_state: "pending",
      revision: 0,
      calendar_sequence: 0,
      cancelled_at: null,
      suspended_at: null,
    })
    expect(copied.calendar_uid).not.toBe(sourceBefore.calendar_uid)
    expect(copied.reporting_id).not.toBe(sourceBefore.reporting_id)
    expect(await findEvent(db, eventId)).toEqual(sourceBefore)
    const inventory = (
      await db
        .prepare("SELECT * FROM inventory WHERE event_id=?")
        .bind(result.eventId)
        .all<{
          id: string
          ticket_type_id: string
          order_id: null
          reservation_id: null
        }>()
    ).results
    expect(inventory).toHaveLength(4)
    expect(
      inventory.every(
        (row) =>
          row.ticket_type_id !== typeId &&
          row.order_id === null &&
          row.reservation_id === null
      )
    ).toBe(true)
    expect(
      await db
        .prepare("SELECT count(*) AS n FROM tickets WHERE event_id=?")
        .bind(eventId)
        .first<number>("n")
    ).toBe(1)
    for (const table of [
      "orders",
      "tickets",
      "campaigns",
      "support_cases",
      "event_permissions",
      "invitations",
      "event_activations",
      "activation_attempts",
      "offline_devices",
    ])
      expect(
        await db
          .prepare(`SELECT count(*) AS n FROM ${table} WHERE event_id=?`)
          .bind(result.eventId)
          .first<number>("n"),
        table
      ).toBe(0)
    expect(
      await db
        .prepare("SELECT id FROM support_cases WHERE id=?")
        .bind(support.case.id)
        .first()
    ).not.toBeNull()
    expect(
      await db
        .prepare("SELECT count(*) AS n FROM audit_entries WHERE event_id=?")
        .bind(result.eventId)
        .first<number>("n")
    ).toBe(1)
    expect(
      await db
        .prepare("SELECT count(*) AS n FROM outbox WHERE entity_id=?")
        .bind(result.eventId)
        .first<number>("n")
    ).toBe(1)
  })

  it("copies assigned-seat configuration into fresh inventory and requires fresh paid activation", async () => {
    const assigned = (
      await createEvent(
        context(),
        definition({
          seatingMode: "assigned",
          venueLayoutId: demoVenue.id,
          capacity: 80,
          maxTicketsPerOrder: 6,
        })
      )
    ).eventId
    await activateTestEvent(db, assigned, "owner", now - 3 * day)
    await db
      .prepare(
        "UPDATE inventory SET enabled=0 WHERE id=(SELECT id FROM inventory WHERE event_id=? ORDER BY id LIMIT 1)"
      )
      .bind(assigned)
      .run()
    const source = await findEvent(db, assigned)
    const result = await duplicatePastEvent(
      db,
      "owner",
      assigned,
      request({ expectedRevision: source.revision }),
      { now: clock }
    )
    const copy = await findEvent(db, result.eventId)
    expect(copy.paid_sales_state).toBe("pending")
    const configuration =
      "SELECT section,row,number,accessible,enabled FROM inventory WHERE event_id=? ORDER BY section,row,number"
    expect(
      (await db.prepare(configuration).bind(result.eventId).all()).results
    ).toEqual((await db.prepare(configuration).bind(assigned).all()).results)
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM inventory copy JOIN inventory source ON source.id=copy.id WHERE copy.event_id=? AND source.event_id=?"
        )
        .bind(result.eventId, assigned)
        .first<number>("n")
    ).toBe(0)
    expect(
      await db
        .prepare("SELECT count(*) AS n FROM event_activations WHERE event_id=?")
        .bind(result.eventId)
        .first<number>("n")
    ).toBe(0)
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM payment_attempts WHERE subject_id=?"
        )
        .bind(result.eventId)
        .first<number>("n")
    ).toBe(0)
    expect(
      await db
        .prepare("SELECT count(*) AS n FROM inventory WHERE event_id=?")
        .bind(result.eventId)
        .first<number>("n")
    ).toBe(80)
  })

  it("replays concurrent identical duplication exactly once and rejects a changed request", async () => {
    const input = request()
    const results = await Promise.all([
      duplicatePastEvent(db, "owner", eventId, input, { now: clock }),
      duplicatePastEvent(db, "owner", eventId, input, { now: clock }),
    ])
    expect(results[0]).toEqual(results[1])
    expect(
      await db.prepare("SELECT count(*) AS n FROM events").first<number>("n")
    ).toBe(2)
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM audit_entries WHERE action='event.duplicated'"
        )
        .first<number>("n")
    ).toBe(1)
    await expect(
      duplicatePastEvent(
        db,
        "owner",
        eventId,
        { ...input, endsAt: iso(now + 4 * day) },
        { now: clock }
      )
    ).rejects.toMatchObject({ status: 409 })
  })

  it("aborts stale configuration, revoked authority, suspension and elapsed new deadlines at commit", async () => {
    await expect(
      duplicatePastEvent(db, "owner", eventId, request(), {
        now: clock,
        beforeCommit: async () => {
          await updateTicketType(
            context(),
            eventId,
            typeId,
            typeInput(eventId, 2, { name: "Changed admission" })
          )
        },
      })
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      duplicatePastEvent(
        db,
        "manager",
        eventId,
        request({ expectedRevision: 3 }),
        {
          now: clock,
          beforeCommit: async () => {
            await db
              .prepare(
                "UPDATE event_permissions SET revoked_at=? WHERE user_id='manager'"
              )
              .bind(now)
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      duplicatePastEvent(
        db,
        "historian",
        eventId,
        request({ expectedRevision: 3 }),
        { now: clock }
      )
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      duplicatePastEvent(
        db,
        "owner",
        eventId,
        request({ expectedRevision: 3 }),
        {
          now: clock,
          beforeCommit: async () => {
            await db
              .prepare(
                "INSERT INTO profiles (user_id,suspended_at,updated_at) VALUES ('owner',?,?)"
              )
              .bind(now, now)
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ status: 403 })
    await db
      .prepare("UPDATE profiles SET suspended_at=NULL WHERE user_id='owner'")
      .run()
    await expect(
      duplicatePastEvent(
        db,
        "owner",
        eventId,
        request({ expectedRevision: 3 }),
        {
          now: clock,
          beforeCommit: async () => {
            now += 4 * day
          },
        }
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(
      await db.prepare("SELECT count(*) AS n FROM events").first<number>("n")
    ).toBe(1)
  })

  it("rolls back all copied rows if audit/outbox commit fails, and rejects upcoming or suspended source events", async () => {
    await db
      .prepare(
        "CREATE TRIGGER fail_duplicate_job BEFORE INSERT ON outbox WHEN json_extract(NEW.payload_json,'$.action')='event.duplicated' BEGIN SELECT RAISE(ABORT,'synthetic job failure'); END"
      )
      .run()
    const input = request()
    await expect(
      duplicatePastEvent(db, "owner", eventId, input, { now: clock })
    ).rejects.toThrow()
    expect(
      await db.prepare("SELECT count(*) AS n FROM events").first<number>("n")
    ).toBe(1)
    expect(
      await db.prepare("SELECT count(*) AS n FROM inventory").first<number>("n")
    ).toBe(4)
    expect(
      await db
        .prepare("SELECT 1 FROM request_receipts WHERE request_id=?")
        .bind(input.requestId)
        .first()
    ).toBeNull()
    await db.prepare("DROP TRIGGER fail_duplicate_job").run()
    await db
      .prepare("UPDATE events SET suspended_at=? WHERE id=?")
      .bind(now, eventId)
      .run()
    await expect(
      duplicatePastEvent(db, "owner", eventId, request(), { now: clock })
    ).rejects.toMatchObject({ status: 409 })
    await db
      .prepare(
        "UPDATE events SET suspended_at=NULL,starts_at=?,ends_at=? WHERE id=?"
      )
      .bind(now + day, now + 2 * day, eventId)
      .run()
    await expect(
      duplicatePastEvent(db, "owner", eventId, request(), { now: clock })
    ).rejects.toMatchObject({ status: 409 })
  })

  it("hides expired retained history, extends expiry for case activity and keeps blocked financial workflows visible", async () => {
    const originalEnd = (await findEvent(db, eventId)).ends_at
    const initial = await readEventHistory(
      db,
      "owner",
      eventId,
      {},
      { now: clock }
    )
    expect(initial.retention.expiresAt).toBe(iso(originalEnd + 180 * day))
    now = originalEnd + 181 * day
    expect(
      (await listOrganizerHistory(db, "owner", {}, { now: clock })).items
    ).toEqual([])
    await expect(
      readEventHistory(db, "owner", eventId, {}, { now: clock })
    ).rejects.toMatchObject({ status: 404 })
    await createSupportCase(
      db,
      "buyer",
      {
        requestId: "late-case",
        audience: "attendee",
        category: "technical",
        subject: "Retained case activity",
        eventId,
        body: "A new case extends the policy deadline",
      },
      { now: clock }
    )
    const renewed = await readEventHistory(
      db,
      "owner",
      eventId,
      {},
      { now: clock }
    )
    expect(renewed.retention.expiresAt).toBe(iso(now + 180 * day))
    expect(renewed.retention.held).toBe(false)
    await db
      .prepare(
        "INSERT INTO payment_attempts (id,purpose,subject_id,state,provider,amount_minor,currency,idempotency_key,created_at,updated_at) VALUES ('pending-activation','event_activation',?,'pending','simulation',100000,'KZT','pending-activation',?,?)"
      )
      .bind(eventId, now, now)
      .run()
    now += 181 * day
    const held = await readEventHistory(
      db,
      "owner",
      eventId,
      {},
      { now: clock }
    )
    expect(held.retention.held).toBe(true)
    expect(held.retention.holdReasons).toContain("payment_reconciliation")
  })

  it("mounts read/create routes with denied unauthenticated access and no audit editing endpoint", async () => {
    const app = new Hono<{ Bindings: Bindings }>()
      .route(
        "/api",
        createHistoryRoutes({
          now: clock,
          identify: async (c) => {
            const id = c.req.header("x-test-actor")
            if (!id) throw new HTTPException(401)
            return id
          },
        })
      )
      .onError((error, c) =>
        c.json(
          { error: error.message },
          error instanceof HTTPException ? error.status : 500
        )
      )
    const env = { DB: db } as Bindings
    expect(
      (await app.request(`/api/events/${eventId}/history`, {}, env)).status
    ).toBe(401)
    expect(
      (
        await app.request(
          `/api/events/${eventId}/history`,
          { headers: { "x-test-actor": "owner" } },
          env
        )
      ).status
    ).toBe(200)
    expect(
      (
        await app.request(
          `/api/events/${eventId}/history`,
          { method: "PATCH", headers: { "x-test-actor": "owner" } },
          env
        )
      ).status
    ).toBe(404)
    expect(
      (
        await app.request(
          `/api/events/${eventId}/duplicate`,
          {
            method: "POST",
            headers: {
              "x-test-actor": "owner",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(request()),
          },
          env
        )
      ).status
    ).toBe(201)
  })
  it("keeps non-support audit history immutable in D1 and bounds inventory duplication", async () => {
    await audit("immutable-history", "event.updated", now)
    await expect(
      db
        .prepare(
          "UPDATE audit_entries SET description='changed' WHERE id='immutable-history'"
        )
        .run()
    ).rejects.toThrow()
    await db
      .prepare("UPDATE events SET capacity=10001 WHERE id=?")
      .bind(eventId)
      .run()
    await expect(
      duplicatePastEvent(db, "owner", eventId, request(), { now: clock })
    ).rejects.toMatchObject({ status: 409 })
    expect(
      await db.prepare("SELECT count(*) AS n FROM events").first<number>("n")
    ).toBe(1)
  })
  it("rejects a time-zone change between planning civil boundaries and the final read batch", async () => {
    await expect(
      readEventHistory(
        db,
        "owner",
        eventId,
        {},
        {
          now: clock,
          beforeReturn: async () => {
            await db
              .prepare(
                "UPDATE events SET time_zone='America/New_York',revision=revision+1 WHERE id=?"
              )
              .bind(eventId)
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ status: 409 })
    const retry = await readEventHistory(
      db,
      "owner",
      eventId,
      {},
      { now: clock }
    )
    expect(retry.timeZone).toBe("America/New_York")
  })
})
