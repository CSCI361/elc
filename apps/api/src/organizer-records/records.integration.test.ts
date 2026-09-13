import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import {
  organizerRecordsResponseSchema,
  type OrganizerRecordsKind,
  type OrganizerRecordsResponse,
} from "@elc/shared"
import { createExportFixture } from "../exports/test-fixture"
import { startCheckout } from "../orders/checkout"
import { abandonCheckout } from "../orders/lifecycle"
import { completeZeroTotalOrder } from "../tickets/issue"
import { scanOnline, reverseCheckIn } from "../tickets/scan"
import { createSupportCase, changeSupportStatus } from "../support/service"
import {
  approveOrderRefund,
  cancelFreeRegistration,
} from "../payments/voluntary"
import { processRefund } from "../payments/refunds"
import { RecordedProvider } from "../payments/test-fixture"
import { startOrderPayment } from "../payments/checkout"
import { processPayment } from "../payments/reconcile"
import { issueOfflineSnapshot } from "../offline/snapshots"
import { registerOfflineDevice } from "../offline/devices"
import { syncOfflineScans } from "../offline/sync"
import { ApiFailure } from "../db/transitions"
import type { Bindings } from "../env"
import { readOrganizerRecords, type RecordsDependencies } from "./read"
import { createOrganizerRecordsRoutes } from "./index"

describe("organizer event records on migrated D1", () => {
  let f: Awaited<ReturnType<typeof createExportFixture>>,
    db: D1Database,
    now: number
  const clock = () => now
  const read = <K extends OrganizerRecordsKind = "tickets">(
    kind: K = "tickets" as K,
    raw: Record<string, unknown> = {},
    actorId = "owner",
    dependencies: RecordsDependencies = {}
  ) =>
    readOrganizerRecords(
      db,
      actorId,
      "event",
      { kind, ...raw },
      { now: clock, ...dependencies }
    ) as Promise<Extract<OrganizerRecordsResponse, { kind: K }>>
  const revision = async (orderId: string) =>
    (await db
      .prepare("SELECT revision FROM orders WHERE id=?")
      .bind(orderId)
      .first<number>("revision"))!
  const grant = async (actor: string, permission: string) =>
    db
      .prepare(
        "INSERT INTO event_permissions(event_id,user_id,permission,granted_at) VALUES('event',?,?,?) ON CONFLICT(event_id,user_id,permission) DO UPDATE SET revoked_at=NULL"
      )
      .bind(actor, permission, now)
      .run()
  beforeEach(async () => {
    f = await createExportFixture()
    db = f.db
    now = f.now
  })
  afterEach(async () => {
    await f?.dispose()
  })
  async function free(quantity = 1, complete = true) {
    await db.batch([
      db.prepare("UPDATE events SET capacity=8 WHERE id='event'"),
      db
        .prepare(
          "INSERT INTO ticket_types(id,event_id,name,kind,price_minor,quantity,sales_start_at,sales_end_at,updated_at) VALUES('free','event','Free registration','free',0,4,?,?,?)"
        )
        .bind(now - 1000, now + 3600000, now),
      ...Array.from({ length: 4 }, (_, i) =>
        db
          .prepare(
            "INSERT INTO inventory(id,event_id,ticket_type_id,section,row,number) VALUES(?,'event','free','Free','A',?)"
          )
          .bind(`free-${i}`, String(i))
      ),
    ])
    const checkout = await startCheckout(
      db,
      "other",
      {
        requestId: "free-basket",
        eventId: "event",
        items: [
          {
            ticketTypeId: "free",
            quantity,
            seatIds: Array.from({ length: quantity }, (_, i) => `free-${i}`),
            attendeeNames: Array.from(
              { length: quantity },
              (_, i) => `Guest 100%_${i}`
            ),
          },
        ],
      },
      { now: clock }
    )
    if (complete)
      await completeZeroTotalOrder(
        f.env,
        "other",
        checkout.order.id,
        { requestId: "free-complete", expectedRevision: checkout.revision },
        { now: clock }
      )
    return checkout.order.id
  }
  async function refund() {
    const support = await createSupportCase(
      db,
      "buyer",
      {
        requestId: "refund-case",
        audience: "attendee",
        category: "refund",
        subject: "Refund request",
        orderId: f.orderId,
        body: "Please refund my order.",
      },
      { now: clock }
    )
    const approved = await approveOrderRefund(
      db,
      "owner",
      f.orderId,
      {
        requestId: "approve-refund",
        caseId: support.case.id,
        reason: "Approved at the purchaser's request.",
        expectedRevision: await revision(f.orderId),
      },
      { now: clock }
    )
    return { approved, support }
  }
  async function reportOffline(ticketId = f.ticketId) {
    const pair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    )
    const env = {
      ...f.env,
      OFFLINE_SIGNING_PRIVATE_JWK: JSON.stringify(
        await crypto.subtle.exportKey("jwk", pair.privateKey)
      ),
      OFFLINE_SIGNING_KEY_ID: "records-test",
    }
    const device = await registerOfflineDevice(
      db,
      "scanner",
      "event",
      { requestId: crypto.randomUUID(), label: "Records test" },
      { now: clock }
    )
    const manifest = await issueOfflineSnapshot(
      env,
      "scanner",
      "event",
      { requestId: crypto.randomUUID(), deviceId: device.id },
      { now: clock }
    )
    now += 1
    const tokenHash = (await db
      .prepare("SELECT token_hash FROM tickets WHERE id=?")
      .bind(ticketId)
      .first<string>("token_hash"))!
    const response = await syncOfflineScans(
      db,
      "scanner",
      "event",
      {
        requestId: crypto.randomUUID(),
        accountId: "scanner",
        deviceId: device.id,
        units: [
          {
            scan: {
              kind: "scan",
              operationId: crypto.randomUUID(),
              snapshotId: manifest.snapshotId,
              snapshotVersion: 1,
              deviceTimestamp: new Date(now).toISOString(),
              deviceSequence: 1,
              ticketId,
              tokenHash,
            },
          },
        ],
      },
      {
        now: clock,
        beforeCommit: async () => {
          await db
            .prepare(
              "UPDATE event_permissions SET revoked_at=? WHERE event_id='event' AND user_id='scanner' AND permission='ticket:scan'"
            )
            .bind(now)
            .run()
        },
      }
    )
    expect(response.results[0]?.result).toBe("forbidden")
  }
  it("shows completed free registrations with zero money, canonical tickets and no payment attempt", async () => {
    const orderId = await free(2)
    const orders = await read("orders", { orderId })
    expect(orders.items).toHaveLength(1)
    expect(orders.items[0]).toMatchObject({
      id: orderId,
      state: "completed",
      quantity: 2,
      totalMinor: 0,
      processingFeeMinor: 0,
      ticketCount: 2,
      refundState: null,
    })
    expect((await read("tickets", { orderId })).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attendeeName: "Guest 100%_0",
          ticketTypeName: "Free registration",
          state: "valid",
          admissionBlocked: false,
        }),
      ])
    )
    expect(
      await db
        .prepare(
          "SELECT count(*) n FROM payment_attempts WHERE purpose='ticket_order' AND subject_id=?"
        )
        .bind(orderId)
        .first("n")
    ).toBe(0)
  })
  it("keeps pending baskets separate from issued registrations and searches pending attendee snapshots", async () => {
    const orderId = await free(1, false)
    expect((await read("orders", { q: "100%_0" })).items[0]).toMatchObject({
      id: orderId,
      state: "pending",
      quantity: 1,
      ticketCount: 0,
      admissionBlocked: true,
    })
    expect((await read("tickets", { orderId })).items).toEqual([])
  })
  it("shows paid snapshots and a pending then confirmed full refund without rewriting original fees", async () => {
    expect((await read("orders")).items[0]).toMatchObject({
      id: f.orderId,
      state: "completed",
      subtotalMinor: 1234500,
      totalMinor: 1234500,
      processingFeeMinor: 37035,
      refundState: null,
      ticketCount: 1,
    })
    const { approved } = await refund()
    expect((await read("orders")).items[0]).toMatchObject({
      state: "completed",
      admissionBlocked: true,
      refundState: "pending",
      refundAmountMinor: 1234500,
    })
    expect((await read()).items[0]?.admissionBlocked).toBe(true)
    await processRefund(db, new RecordedProvider(), approved.refundId, now)
    expect((await read("orders")).items[0]).toMatchObject({
      state: "refunded",
      refundState: "succeeded",
      refundAmountMinor: 1234500,
      subtotalMinor: 1234500,
      totalMinor: 1234500,
      processingFeeMinor: 37035,
      ticketCount: 1,
    })
    expect((await read()).items[0]).toMatchObject({
      state: "refunded",
      admissionBlocked: true,
    })
  })
  it("shows compensated late payments as refunded money on an unfulfilled abandoned order", async () => {
    const basket = await startCheckout(
      db,
      "other",
      {
        requestId: "late-basket",
        eventId: "event",
        items: [
          {
            ticketTypeId: "type",
            quantity: 1,
            seatIds: ["seat-2"],
            attendeeNames: ["Late payment attendee"],
          },
        ],
      },
      { now: clock }
    )
    const provider = new RecordedProvider()
    const payment = await startOrderPayment(
      f.env,
      provider,
      "other",
      basket.order.id,
      { requestId: "late-payment", expectedRevision: basket.revision },
      { now: clock }
    )
    await abandonCheckout(
      db,
      "other",
      basket.order.id,
      {
        requestId: "abandon-late",
        expectedRevision: await revision(basket.order.id),
      },
      now
    )
    provider.state = "succeeded"
    await processPayment(f.env, provider, payment.payment.id, { now: clock })
    const result = await read("orders", { orderId: basket.order.id })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      state: "abandoned",
      completedAt: null,
      totalMinor: 1234500,
      refundState: "succeeded",
      refundAmountMinor: 1234500,
      ticketCount: 0,
      admissionBlocked: true,
    })
    expect((await read("tickets", { orderId: basket.order.id })).items).toEqual(
      []
    )
    expect(provider.refunds).toHaveLength(1)
  })
  it("retains free cancellation records and preserves issued ticket counts", async () => {
    const orderId = await free()
    await cancelFreeRegistration(
      db,
      "owner",
      orderId,
      {
        requestId: "cancel-free",
        expectedRevision: await revision(orderId),
        reason: "Registration cancelled at request.",
      },
      { now: clock }
    )
    expect((await read("orders", { orderId })).items[0]).toMatchObject({
      state: "cancelled",
      ticketCount: 1,
      refundState: null,
    })
    expect((await read("tickets", { orderId })).items[0]).toMatchObject({
      state: "cancelled",
      admissionBlocked: true,
    })
  })
  it("uses immutable ticket type and seat snapshots after current configuration changes", async () => {
    const first = (await read()).items[0]!
    await db
      .prepare(
        "UPDATE ticket_types SET name='Renamed current ticket' WHERE id='type'"
      )
      .run()
    await expect(
      db
        .prepare(
          "UPDATE inventory SET section='Changed',row='Changed',number='99' WHERE id='seat-1'"
        )
        .run()
    ).rejects.toThrow("inventory_historical_assignment")
    await db
      .prepare(
        "UPDATE inventory SET section='Changed',row='Changed',number='99' WHERE id='seat-2'"
      )
      .run()
    const current = (await read()).items[0]!
    expect(current.ticketTypeName).toBe("Балкон / Balcony")
    expect(current.seat).toEqual(first.seat)
    expect(current.seat).toMatchObject({ section: "Ә", row: "Б", number: "1" })
  })
  it("keeps canonical, reversed and unresolved offline admissions separate", async () => {
    await grant("scanner", "checkin:reverse")
    const scan = await scanOnline(
      db,
      "scanner",
      { eventId: "event", operationId: "scan-first", credential: f.credential },
      { now: clock }
    )
    expect((await read()).items[0]).toMatchObject({
      activeCheckinId: scan.checkInId,
      activeCheckinAt: new Date(now).toISOString(),
      unresolvedOfflineAdmission: false,
    })
    await reverseCheckIn(
      db,
      "scanner",
      "event",
      scan.checkInId!,
      { requestId: "reverse", reason: "Wrong entrance recorded." },
      clock
    )
    now += 1
    const second = await scanOnline(
      db,
      "scanner",
      {
        eventId: "event",
        operationId: "scan-second",
        credential: f.credential,
      },
      { now: clock }
    )
    const history = await read("checkins")
    expect(history.items).toHaveLength(2)
    expect(history.items[0]).toMatchObject({
      id: second.checkInId,
      reversedAt: null,
    })
    expect(history.items[1]).toMatchObject({
      id: scan.checkInId,
      reversedBy: "scanner",
      reversalReason: "Wrong entrance recorded.",
    })
    expect(history.items[1]?.reversedAt).not.toBeNull()
    const orderId = await free()
    const ticket = (await read("tickets", { orderId })).items[0]!
    await reportOffline(ticket.id)
    expect(
      (await read("tickets", { ticketId: ticket.id })).items[0]
    ).toMatchObject({
      state: "valid",
      activeCheckinId: null,
      unresolvedOfflineAdmission: true,
    })
    expect((await read("checkins", { ticketId: ticket.id })).items).toEqual([])
    expect((await read("checkins")).items).toHaveLength(2)
  })
  it("returns independent current capabilities for owner, manager and history-only staff", async () => {
    expect((await read()).capabilities).toEqual({
      manage: true,
      history: true,
      analytics: true,
      support: true,
      refund: true,
    })
    expect((await read("tickets", {}, "manager")).capabilities).toEqual({
      manage: true,
      history: false,
      analytics: false,
      support: false,
      refund: false,
    })
    await grant("other", "history:read")
    expect((await read("tickets", {}, "other")).capabilities).toEqual({
      manage: false,
      history: true,
      analytics: false,
      support: false,
      refund: false,
    })
    await grant("other", "support:manage")
    await grant("other", "refund:initiate")
    expect((await read("orders", {}, "other")).capabilities).toMatchObject({
      manage: false,
      history: true,
      support: true,
      refund: true,
      analytics: false,
    })
  })
  it.each(["buyer", "scanner", "other"])(
    "denies %s without organizer record authority",
    async (actor) => {
      if (actor === "other") {
        await grant(actor, "analytics:read")
        await grant(actor, "support:manage")
        await grant(actor, "refund:initiate")
      }
      await expect(read("tickets", {}, actor)).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
      })
    }
  )
  it.each(["revoked", "suspended", "unverified", "owner_changed"])(
    "rejects %s access at the final read",
    async (change) => {
      const actor = change === "owner_changed" ? "owner" : "manager"
      await expect(
        read("orders", {}, actor, {
          beforeRead: async () => {
            if (change === "revoked")
              await db
                .prepare(
                  "UPDATE event_permissions SET revoked_at=? WHERE user_id='manager'"
                )
                .bind(now)
                .run()
            if (change === "suspended")
              await db
                .prepare(
                  "INSERT INTO profiles(user_id,suspended_at,updated_at) VALUES('manager',?,?)"
                )
                .bind(now, now)
                .run()
            if (change === "unverified")
              await db
                .prepare("UPDATE user SET email_verified=0 WHERE id='manager'")
                .run()
            if (change === "owner_changed")
              await db
                .prepare(
                  "UPDATE events SET organizer_id='other' WHERE id='event'"
                )
                .run()
          },
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 })
    }
  )
  it("updates independent capabilities in the same final snapshot", async () => {
    await grant("manager", "refund:initiate")
    const result = await read("orders", {}, "manager", {
      beforeRead: async () => {
        await db
          .prepare(
            "UPDATE event_permissions SET revoked_at=? WHERE user_id='manager' AND permission='refund:initiate'"
          )
          .bind(now)
          .run()
      },
    })
    expect(result.capabilities).toMatchObject({ manage: true, refund: false })
  })
  it("supports literal name search and event-local order/ticket drilldown", async () => {
    const orderId = await free(2)
    const tickets = (await read("tickets", { q: "100%_" })).items
    expect(tickets).toHaveLength(2)
    expect((await read("tickets", { q: "100%_0" })).items).toHaveLength(1)
    expect((await read("orders", { q: tickets[0]!.id })).items[0]?.id).toBe(
      orderId
    )
    expect((await read("tickets", { q: orderId })).items).toHaveLength(2)
    expect(
      (await read("orders", { ticketId: tickets[0]!.id })).items[0]?.id
    ).toBe(orderId)
    expect(
      (await read("tickets", { orderId: f.orderId, ticketId: tickets[0]!.id }))
        .items
    ).toEqual([])
    for (const kind of ["orders", "tickets", "checkins"] as const)
      expect(
        (await read(kind, { orderId: "other-event-order" })).items
      ).toEqual([])
    await db
      .prepare(
        "INSERT INTO events(id,organizer_id,title,description,category,venue_name,venue_address,starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,calendar_uid,reporting_id,created_at,updated_at) VALUES('foreign','owner','Foreign','Foreign event description','Test','Venue','Address',?,?,?, ?,6,'foreign-calendar','foreign-report',?,?)"
      )
      .bind(now + 3600000, now + 7200000, now - 1000, now + 3600000, now, now)
      .run()
    expect(
      (
        await readOrganizerRecords(
          db,
          "owner",
          "foreign",
          { kind: "tickets", ticketId: f.ticketId },
          { now: clock }
        )
      ).items
    ).toEqual([])
    expect(
      (
        await readOrganizerRecords(
          db,
          "owner",
          "foreign",
          { kind: "orders", orderId: f.orderId },
          { now: clock }
        )
      ).items
    ).toEqual([])
  })
  it.each(["orders", "tickets", "checkins"] as const)(
    "paginates %s without duplicates and binds the cursor to actor, event, kind and filters",
    async (kind) => {
      await free(2)
      if (kind === "checkins") {
        await grant("scanner", "checkin:reverse")
        const scan = await scanOnline(
          db,
          "scanner",
          {
            eventId: "event",
            operationId: "page-first",
            credential: f.credential,
          },
          { now: clock }
        )
        await reverseCheckIn(
          db,
          "scanner",
          "event",
          scan.checkInId!,
          { requestId: "page-reverse", reason: "Pagination reversal." },
          clock
        )
        await scanOnline(
          db,
          "scanner",
          {
            eventId: "event",
            operationId: "page-second",
            credential: f.credential,
          },
          { now: clock }
        )
      }
      const whole = await read(kind),
        first = await read(kind, { limit: 1 })
      expect(first.nextCursor).not.toBeNull()
      const seen = first.items.map((item) => item.id)
      let cursor = first.nextCursor
      while (cursor) {
        const page = await read(kind, { limit: 1, cursor })
        seen.push(...page.items.map((item) => item.id))
        cursor = page.nextCursor
      }
      expect(seen).toEqual(whole.items.map((item) => item.id))
      for (const raw of [
        { q: "changed" },
        { orderId: f.orderId },
        { ticketId: f.ticketId },
        { kind: kind === "orders" ? "tickets" : "orders" },
      ])
        await expect(
          read(kind, { cursor: first.nextCursor, ...raw })
        ).rejects.toMatchObject({ code: "INVALID_INPUT" })
      await expect(
        read(kind, { cursor: first.nextCursor }, "manager")
      ).rejects.toMatchObject({ code: "INVALID_INPUT" })
      await expect(
        readOrganizerRecords(
          db,
          "owner",
          "foreign",
          { kind, cursor: first.nextCursor },
          { now: clock }
        )
      ).rejects.toMatchObject({ code: "INVALID_INPUT" })
    }
  )
  it.each([
    null,
    { kind: "payments" },
    { limit: 51 },
    { limit: 0 },
    { q: "x".repeat(201) },
    { cursor: "invalid" },
    { unexpected: "value" },
  ])("rejects malformed filters %j", async (raw) => {
    await expect(
      readOrganizerRecords(db, "owner", "event", raw, { now: clock })
    ).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 })
  })
  it("hides records at the exact retention deadline, including expiry during a read", async () => {
    const deadline = Date.parse((await read()).retention.expiresAt)
    now = deadline - 1
    expect((await read()).items).toHaveLength(1)
    await expect(
      read("tickets", {}, "owner", {
        beforeRead: async () => {
          now = deadline
        },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    for (const kind of ["orders", "tickets", "checkins"] as const)
      await expect(read(kind)).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
  it("extends the deadline for linked support activity", async () => {
    const original = Date.parse((await read()).retention.expiresAt)
    now += 10 * 86400000
    const support = await createSupportCase(
      db,
      "buyer",
      {
        requestId: "general-case",
        audience: "attendee",
        category: "event_information",
        subject: "Past order question",
        orderId: f.orderId,
        body: "Question about my ticket.",
      },
      { now: clock }
    )
    const extended = Date.parse((await read()).retention.expiresAt)
    expect(extended).toBe(now + 180 * 86400000)
    expect(extended).toBeGreaterThan(original)
    await changeSupportStatus(
      db,
      "owner",
      support.case.id,
      {
        requestId: "resolve-general",
        expectedRevision: support.case.revision,
        status: "resolved",
      },
      { now: clock }
    )
    now = extended - 1
    expect((await read()).items).toHaveLength(1)
    now = extended
    await expect(read()).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
  it("retains pending refunds past expiry", async () => {
    await refund()
    now = Date.parse((await read()).retention.expiresAt) + 1
    const held = await read("orders")
    expect(held.retention).toMatchObject({
      held: true,
      holdReasons: expect.arrayContaining(["refund", "financial_case"]),
    })
    expect(held.items[0]?.refundState).toBe("pending")
  })
  it("retains payment reconciliation and unresolved admission work after the normal deadline", async () => {
    const basket = await startCheckout(
      db,
      "other",
      {
        requestId: "pending-paid",
        eventId: "event",
        items: [
          {
            ticketTypeId: "type",
            quantity: 1,
            seatIds: ["seat-2"],
            attendeeNames: ["Pending attendee"],
          },
        ],
      },
      { now: clock }
    )
    await startOrderPayment(
      f.env,
      new RecordedProvider(),
      "other",
      basket.order.id,
      { requestId: "pending-payment", expectedRevision: basket.revision },
      { now: clock }
    )
    await reportOffline()
    now = Date.parse((await read()).retention.expiresAt) + 1
    const held = await read()
    expect(held.retention).toMatchObject({
      held: true,
      holdReasons: expect.arrayContaining([
        "payment_reconciliation",
        "reported_admission",
      ]),
    })
    expect(held.items[0]?.unresolvedOfflineAdmission).toBe(true)
  })
  it("keeps cancelled and suspended event records visible while marking admission blocked", async () => {
    await db
      .prepare(
        "UPDATE events SET cancelled_at=?,suspended_at=? WHERE id='event'"
      )
      .bind(now, now)
      .run()
    expect((await read()).items[0]).toMatchObject({
      id: f.ticketId,
      admissionBlocked: true,
    })
    expect((await read("orders")).items[0]?.admissionBlocked).toBe(true)
  })
  it("mounts a private no-store GET and omits contacts, payment URLs and all admission secrets", async () => {
    const app = new Hono<{
      Bindings: Bindings
      Variables: { requestId: string }
    }>()
      .route(
        "/api",
        createOrganizerRecordsRoutes({
          identify: async () => "owner",
          now: clock,
        })
      )
      .onError((error, c) =>
        c.json(
          { code: error instanceof ApiFailure ? error.code : "ERROR" },
          error instanceof HTTPException ? error.status : 500
        )
      )
    for (const kind of ["orders", "tickets", "checkins"]) {
      const response = await app.request(
        `http://elc.test/api/events/event/records?kind=${kind}`,
        {},
        f.env as Bindings
      )
      expect(response.status).toBe(200)
      expect(response.headers.get("Cache-Control")).toBe("private, no-store")
      expect(response.headers.get("Vary")).toBe("Cookie")
      const payload = await response.json()
      expect(organizerRecordsResponseSchema.safeParse(payload).success).toBe(
        true
      )
      const serialized = JSON.stringify(payload)
      for (const sensitive of [
        "@example.test",
        f.credential.token,
        "credential",
        "tokenHash",
        "accountId",
        "checkoutUrl",
        "providerPaymentId",
        "https://sandbox",
      ])
        expect(serialized).not.toContain(sensitive)
    }
    expect(
      (
        await app.request(
          "http://elc.test/api/events/event/records",
          { method: "POST" },
          f.env as Bindings
        )
      ).status
    ).toBe(404)
  })
})
