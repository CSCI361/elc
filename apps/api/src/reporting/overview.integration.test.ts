import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { createPaymentFixture } from "../payments/test-fixture"
import { startCheckout } from "../orders/checkout"
import { abandonCheckout } from "../orders/lifecycle"
import { processPayment } from "../payments/reconcile"
import { startOrderPayment } from "../payments/checkout"
import {
  approveOrderRefund,
  cancelFreeRegistration,
} from "../payments/voluntary"
import {
  ensureEventCancellationRefund,
  processRefund,
} from "../payments/refunds"
import { loadPayment } from "../payments/store"
import { simulateEventPayout } from "../payments/payouts"
import { cancelEvent } from "../events/cancellation"
import { createSupportCase } from "../support/service"
import { completeZeroTotalOrder } from "../tickets/issue"
import { recoverTicketCredential } from "../tickets/credentials"
import { scanOnline, reverseCheckIn } from "../tickets/scan"
import {
  addCalendarDays,
  calendarDateAt,
  calendarDayStart,
  reportingPeriod,
} from "./dates"
import { readEventAnalytics } from "./read"
import {
  overviewCurrentSql,
  overviewMetricsSql,
  readOrganizerAnalytics,
} from "./overview"

describe("authoritative organizer overview with real D1", () => {
  let f: Awaited<ReturnType<typeof createPaymentFixture>>
  beforeEach(async () => {
    f = await createPaymentFixture()
  })
  afterEach(async () => {
    await f?.runtime.dispose()
  })
  const report = (raw: unknown = {}, actor = "owner", now = f.now) =>
    readOrganizerAnalytics(f.db, actor, raw, { now: () => now })
  const day = (offset = 0) =>
    addCalendarDays(calendarDateAt(f.now, "Asia/Almaty"), offset)
  const range = (offset = 0) => ({
    range: "custom",
    start: day(offset),
    end: day(offset),
  })
  async function paid() {
    f.provider.state = "succeeded"
    await processPayment(f.env, f.provider, f.paymentId, { now: () => f.now })
  }
  async function abandon() {
    await abandonCheckout(
      f.db,
      "buyer",
      f.checkout.order.id,
      { requestId: crypto.randomUUID(), expectedRevision: 0 },
      f.now
    )
  }
  async function grant(
    eventId = "event",
    permission = "analytics:read",
    actor = "buyer"
  ) {
    await f.db
      .prepare(
        "INSERT INTO event_permissions(event_id,user_id,permission,granted_at) VALUES(?,?,?,?)"
      )
      .bind(eventId, actor, permission, f.now)
      .run()
  }
  async function seedEvent(
    id: string,
    options: { owner?: string; zone?: string; at?: number; title?: string } = {}
  ) {
    const at = options.at ?? f.now
    await f.db
      .prepare(`INSERT INTO events(id,organizer_id,title,description,category,venue_name,venue_address,time_zone,
      starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,max_tickets_per_order,publication_state,calendar_uid,reporting_id,created_at,updated_at)
      VALUES(?,?,?,'Fixture','Test','Hall','Almaty',?,?,?,?,?,3,3,'published',?,?,?,?)`)
      .bind(
        id,
        options.owner ?? "owner",
        options.title ?? id,
        options.zone ?? "Asia/Almaty",
        at + 3600000,
        at + 7200000,
        at - 3600000,
        at + 3600000,
        id + "@calendar",
        id + "-report",
        at,
        at
      )
      .run()
    await f.db
      .prepare(`INSERT INTO ticket_types(id,event_id,name,kind,price_minor,quantity,sales_start_at,sales_end_at,updated_at)
      VALUES(?,?,'Free admission','free',0,3,?,?,?)`)
      .bind(id + "-type", id, at - 3600000, at + 3600000, at)
      .run()
    for (let i = 0; i < 3; i++)
      await f.db
        .prepare(
          "INSERT INTO inventory(id,event_id,ticket_type_id) VALUES(?,?,?)"
        )
        .bind(id + "-slot-" + i, id, id + "-type")
        .run()
  }
  async function free(eventId: string, at = f.now, quantity = 1) {
    const checkout = await startCheckout(
      f.db,
      "buyer",
      {
        requestId: crypto.randomUUID(),
        eventId,
        items: [
          {
            ticketTypeId: eventId + "-type",
            quantity,
            attendeeNames: Array.from({ length: quantity }, () => "Guest"),
          },
        ],
      },
      { now: () => at }
    )
    await completeZeroTotalOrder(
      f.env,
      "buyer",
      checkout.order.id,
      { requestId: crypto.randomUUID(), expectedRevision: 0 },
      { now: () => at }
    )
    return checkout.order.id
  }
  async function refund(
    confirmedAt = f.now + 86400000,
    orderId = f.checkout.order.id
  ) {
    const support = await createSupportCase(
      f.db,
      "buyer",
      {
        requestId: crypto.randomUUID(),
        audience: "attendee",
        category: "refund",
        subject: "Refund fixture",
        orderId,
        body: "Please refund this order.",
      },
      { now: () => f.now }
    )
    const revision = await f.db
      .prepare("SELECT revision FROM orders WHERE id=?")
      .bind(orderId)
      .first<number>("revision")
    const result = await approveOrderRefund(
      f.db,
      "owner",
      orderId,
      {
        requestId: crypto.randomUUID(),
        expectedRevision: revision,
        caseId: support.case.id,
        reason: "Approved test refund",
      },
      { now: () => f.now }
    )
    await processRefund(f.db, f.provider, result.refundId, confirmedAt)
  }

  it("matches whole-event definitions while keeping aggregate totals independent of event paging", async () => {
    await paid()
    for (const id of ["a", "b", "c"]) {
      await seedEvent(id)
      await free(id)
    }
    const result = await report({ ...range(), limit: 1 })
    expect(result.scope.eventCount).toBe(4)
    expect(result.events).toHaveLength(1)
    expect(result.summary).toMatchObject({
      completedOrders: 4,
      ticketsIssued: 4,
      grossMinor: 1000000,
      processingFeeMinor: 30000,
      estimatedPayoutMinor: 970000,
    })
    expect(result.current).toMatchObject({
      capacity: 13,
      enabledInventory: 13,
      remainingInventory: 9,
      issuedTickets: 4,
      eligibleAttendance: 4,
      unsynchronizedOfflineCount: null,
    })
    const ids: string[] = [],
      summaries = []
    let page = result
    for (;;) {
      ids.push(...page.events.map((e) => e.id))
      summaries.push(...page.events.map((e) => e.summary))
      expect(page.summary).toEqual(result.summary)
      expect(page.daily).toEqual(result.daily)
      if (!page.nextCursor) break
      page = await report({ ...range(), limit: 1, cursor: page.nextCursor })
    }
    expect(ids).toEqual(["a", "b", "c", "event"])
    expect(summaries.reduce((sum, row) => sum + row.grossMinor, 0)).toBe(
      result.summary.grossMinor
    )
    const single = await readEventAnalytics(f.db, "owner", "event", range(), {
      now: () => f.now,
    })
    expect(summaries.at(-1)).toEqual(single.summary)
    expect(
      result.daily.reduce((sum, row) => sum + row.summary.ticketsIssued, 0)
    ).toBe(4)
    await expect(
      report({ ...range(), q: "a", cursor: result.nextCursor })
    ).rejects.toMatchObject({ status: 400 })
  })

  it("uses Almaty midnight for mixed event zones and includes empty dates", async () => {
    const midnight = calendarDayStart(day(1), "Asia/Almaty")
    expect(new Date(midnight).toISOString().slice(11)).toBe("19:00:00.000Z")
    await seedEvent("new-york", { zone: "America/New_York", at: midnight - 1 })
    await seedEvent("auckland", { zone: "Pacific/Auckland", at: midnight + 1 })
    await free("new-york", midnight - 1)
    await free("auckland", midnight + 1)
    const result = await report(
      { range: "custom", start: day(-1), end: day(1) },
      "owner",
      midnight + 1
    )
    expect(result.timeZone).toBe("Asia/Almaty")
    expect(result.period).toMatchObject({
      startAt: new Date(calendarDayStart(day(-1), "Asia/Almaty")).toISOString(),
      endExclusiveAt: new Date(
        calendarDayStart(day(2), "Asia/Almaty")
      ).toISOString(),
      dayCount: 3,
    })
    expect(
      result.daily.map((row) => [row.date, row.summary.completedOrders])
    ).toEqual([
      [day(-1), 0],
      [day(), 1],
      [day(1), 1],
    ])
    expect(result.events.find((e) => e.id === "new-york")?.timeZone).toBe(
      "America/New_York"
    )
    expect(result.events.find((e) => e.id === "auckland")?.timeZone).toBe(
      "Pacific/Auckland"
    )
    expect(
      (await report({ range: "7" }, "owner", midnight + 1)).period.end
    ).toBe(day(1))
    await expect(
      report({ range: "custom", start: day(-180), end: day() })
    ).rejects.toMatchObject({ status: 400 })
  })

  it("scopes every measure to current ownership or analytics permission and handles the revocation batch race", async () => {
    await paid()
    await seedEvent("mine", { owner: "buyer" })
    await free("mine")
    await grant("event", "event:manage")
    await grant("event", "ticket:scan")
    await f.db
      .prepare(
        "INSERT INTO platform_grants(user_id,permission,granted_at) VALUES('buyer','platform:moderate',?)"
      )
      .bind(f.now)
      .run()
    expect((await report(range(), "buyer")).scope.eventCount).toBe(1)
    await grant()
    expect((await report(range(), "buyer")).summary.grossMinor).toBe(1000000)
    let batches = 0
    const db = new Proxy(f.db, {
      get(target, key) {
        if (key === "batch")
          return async (statements: D1PreparedStatement[]) => {
            batches++
            expect(statements).toHaveLength(5)
            return target.batch(statements)
          }
        const value = Reflect.get(target, key)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    const result = await readOrganizerAnalytics(db, "buyer", range(), {
      now: () => f.now,
      beforeRead: async () => {
        await f.db
          .prepare(
            "UPDATE event_permissions SET revoked_at=? WHERE event_id='event' AND user_id='buyer' AND permission='analytics:read'"
          )
          .bind(f.now)
          .run()
      },
    })
    expect(batches).toBe(1)
    expect(result.events.map((e) => e.id)).toEqual(["mine"])
    expect(result.scope.eventCount).toBe(1)
    expect(result.current.capacity).toBe(3)
    expect(result.summary.grossMinor).toBe(0)
    expect(result.otherPayments.activationFeesMinor).toBe(0)
    expect(result.daily.every((row) => row.summary.grossMinor === 0)).toBe(true)
    await expect(
      readOrganizerAnalytics(f.db, "buyer", range(), {
        beforeRead: async () => {
          await f.db
            .prepare("UPDATE user SET email_verified=0 WHERE id='buyer'")
            .run()
        },
      })
    ).rejects.toMatchObject({ status: 403 })
    await expect(report({}, "missing")).rejects.toMatchObject({ status: 403 })
  })

  it("retains original completed sales and reports a later refund alone on its confirmation date", async () => {
    await paid()
    await refund()
    const original = await report(range()),
      later = await report(range(1))
    expect(original.summary).toMatchObject({
      grossMinor: 1000000,
      discountMinor: 0,
      ticketRefundMinor: 0,
      processingFeeMinor: 30000,
    })
    expect(later.summary).toMatchObject({
      grossMinor: 0,
      completedOrders: 0,
      ticketsIssued: 0,
      refundedTickets: 1,
      ticketRefundMinor: 1000000,
      processingFeeReversalMinor: 30000,
      netTicketRevenueMinor: -1000000,
      estimatedPayoutMinor: -970000,
    })
    expect(later.current).toMatchObject({
      issuedTickets: 1,
      refundedTickets: 1,
      eligibleAttendance: 0,
      confirmedAttendance: 0,
      attendancePercent: 0,
    })
    expect(later.daily[0]!.summary).toEqual(later.summary)
    expect(later.events[0]!.summary).toEqual(later.summary)
  })

  it("keeps free cancellation, activation fees and unfulfilled compensation separate from ticket refunds", async () => {
    await seedEvent("free")
    const id = await free("free", f.now, 2)
    await cancelFreeRegistration(
      f.db,
      "owner",
      id,
      {
        requestId: crypto.randomUUID(),
        expectedRevision: 1,
        reason: "Free registration cancelled",
      },
      { now: () => f.now }
    )
    await abandon()
    f.provider.state = "succeeded"
    await processPayment(f.env, f.provider, f.paymentId, { now: () => f.now })
    const refundId = await f.db
      .prepare("SELECT id FROM refunds WHERE payment_attempt_id=?")
      .bind(f.paymentId)
      .first<string>("id")
    await processRefund(f.db, f.provider, refundId!, f.now)
    const result = await report(range())
    expect(result.summary).toMatchObject({
      completedOrders: 1,
      ticketsIssued: 2,
      grossMinor: 0,
      ticketRefundMinor: 0,
      estimatedPayoutMinor: 0,
    })
    expect(result.otherPayments).toMatchObject({
      activationFeesMinor: 500000,
      activationRefundsMinor: 0,
      unfulfilledCompensationMinor: 1000000,
      attendeeProcessingChargesMinor: 0,
    })
    expect(result.current).toMatchObject({
      cancelledTickets: 2,
      refundedTickets: 0,
      eligibleAttendance: 0,
    })
    expect(result.daily[0]!.otherPayments).toEqual(result.otherPayments)
  })

  it("reports recorded payout and later adjustment dates independently of estimated payout", async () => {
    await paid()
    const payoutAt = f.now + 10 * 86400000
    await simulateEventPayout(f.db, "event", { now: () => payoutAt })
    const cancelledAt = payoutAt + 86400000
    await cancelEvent(
      {
        db: f.db,
        actorId: "owner",
        correlationId: "post-payout-cancellation",
        appOrigin: f.env.APP_ORIGIN,
        now: cancelledAt,
      },
      "event",
      {
        requestId: crypto.randomUUID(),
        expectedRevision: await f.db
          .prepare("SELECT revision FROM events WHERE id='event'")
          .first<number>("revision"),
        reason: "Cancel the event after its payout was recorded.",
      }
    )
    const refundId = await ensureEventCancellationRefund(
      f.db,
      await loadPayment(f.db, f.paymentId),
      cancelledAt
    )
    await processRefund(f.db, f.provider, refundId, cancelledAt)
    const sale = await report(range()),
      payout = await report(range(10)),
      adjustment = await report(range(11))
    expect(sale.summary.estimatedPayoutMinor).toBe(970000)
    expect(sale.payouts.completedMinor).toBe(0)
    expect(payout.summary.estimatedPayoutMinor).toBe(0)
    expect(payout.payouts).toEqual({
      completedCount: 1,
      completedMinor: 970000,
      adjustmentCount: 0,
      adjustmentMinor: 0,
      netMinor: 970000,
    })
    expect(adjustment.payouts).toEqual({
      completedCount: 0,
      completedMinor: 0,
      adjustmentCount: 1,
      adjustmentMinor: -970000,
      netMinor: -970000,
    })
    expect(adjustment.daily[0]!.payouts).toEqual(adjustment.payouts)
    expect(adjustment.summary.estimatedPayoutMinor).toBe(-970000)
  })

  it("uses committed discount and fee snapshots after catalog changes and a later full refund", async () => {
    await abandon()
    await f.db.batch([
      f.db
        .prepare(`INSERT INTO campaigns (id,event_id,name,code,token_hash,reporting_id,discount_kind,discount_value,starts_at,ends_at,max_redemptions,enabled,updated_at)
          VALUES ('discount','event','Quarter off','QUARTER','discount-hash','discount-report','percentage',2500,?,?,10,1,?)`)
        .bind(f.now - 1, f.now + 3600000, f.now),
      f.db.prepare(
        "INSERT INTO campaign_ticket_types (campaign_id,ticket_type_id) VALUES ('discount','type')"
      ),
    ])
    const checkout = await startCheckout(
      f.db,
      "buyer",
      {
        requestId: crypto.randomUUID(),
        eventId: "event",
        promoCode: "QUARTER",
        items: [
          {
            ticketTypeId: "type",
            quantity: 1,
            attendeeNames: ["Discounted guest"],
          },
        ],
      },
      { now: () => f.now }
    )
    f.provider.state = "succeeded"
    const payment = await startOrderPayment(
      f.env,
      f.provider,
      "buyer",
      checkout.order.id,
      { requestId: crypto.randomUUID(), expectedRevision: 0 },
      { now: () => f.now }
    )
    await processPayment(f.env, f.provider, payment.payment.id, {
      now: () => f.now,
    })
    const original = await report(range())
    expect(original.summary).toMatchObject({
      completedOrders: 1,
      ticketsIssued: 1,
      grossMinor: 1000000,
      discountMinor: 250000,
      processingFeeMinor: 22500,
      netTicketRevenueMinor: 750000,
      estimatedPayoutMinor: 727500,
      committedRedemptions: 1,
    })
    await f.db.batch([
      f.db.prepare(
        "UPDATE ticket_types SET price_minor=2000000 WHERE id='type'"
      ),
      f.db.prepare(
        "UPDATE campaigns SET discount_value=5000,enabled=0 WHERE id='discount'"
      ),
    ])
    await refund(f.now + 86400000, checkout.order.id)
    expect((await report(range())).summary).toEqual(original.summary)
    const later = await report(range(1))
    expect(later.summary).toMatchObject({
      grossMinor: 0,
      discountMinor: 0,
      ticketRefundMinor: 750000,
      processingFeeReversalMinor: 22500,
      estimatedPayoutMinor: -727500,
      committedRedemptions: 0,
    })
    expect(later.events[0]!.summary).toEqual(later.summary)
    expect(later.daily[0]!.summary).toEqual(later.summary)
  })

  it("applies literal title search to all aggregates and does not leak unauthorized event matches", async () => {
    await seedEvent("literal", { title: "Music %_ special" })
    await free("literal")
    await seedEvent("ordinary", { title: "Music concert" })
    await free("ordinary")
    await seedEvent("private", { owner: "buyer", title: "Music %_ hidden" })
    await free("private")
    const result = await report({ ...range(), q: "%_", limit: 1 })
    expect(result.scope.eventCount).toBe(1)
    expect(result.events.map((e) => e.id)).toEqual(["literal"])
    expect(result.summary.ticketsIssued).toBe(1)
    expect(result.current.capacity).toBe(3)
    expect(result.daily[0]!.summary.ticketsIssued).toBe(1)
    const empty = await report({ ...range(), q: "hidden" })
    expect(empty.scope.eventCount).toBe(0)
    expect(empty.events).toEqual([])
    expect(empty.current.soldPercent).toBe(0)
    expect(empty.current.attendancePercent).toBe(0)
  })

  it("reads coherent current counts while checkout and admission transitions commit", async () => {
    await paid()
    await grant("event", "ticket:scan", "owner")
    await grant("event", "checkin:reverse", "owner")
    const ticket = (await f.db
      .prepare("SELECT id,credential_ciphertext FROM tickets")
      .first<{ id: string; credential_ciphertext: string }>())!
    const credential = await recoverTicketCredential(
      ticket.id,
      ticket.credential_ciphertext,
      f.env.TICKET_ENCRYPTION_KEY
    )
    const [reports, , scan] = await Promise.all([
      Promise.all(Array.from({ length: 3 }, () => report(range()))),
      startCheckout(
        f.db,
        "buyer",
        {
          requestId: crypto.randomUUID(),
          eventId: "event",
          items: [
            { ticketTypeId: "type", quantity: 1, attendeeNames: ["Waiting"] },
          ],
        },
        { now: () => f.now }
      ),
      scanOnline(
        f.db,
        "owner",
        { eventId: "event", operationId: crypto.randomUUID(), credential },
        { now: () => f.now }
      ),
    ])
    for (const result of reports) {
      expect(result.current.confirmedAttendance).toBeLessThanOrEqual(
        result.current.eligibleAttendance
      )
      expect(result.current.absent + result.current.confirmedAttendance).toBe(
        result.current.eligibleAttendance
      )
      expect(
        result.current.remainingInventory + result.current.reservedInventory
      ).toBe(3)
      expect(result.current).toEqual(result.events[0]!.current)
    }
    expect((await report(range())).current).toMatchObject({
      reservedInventory: 1,
      remainingInventory: 2,
      confirmedAttendance: 1,
      absent: 0,
    })
    await reverseCheckIn(
      f.db,
      "owner",
      "event",
      scan.checkInId!,
      { requestId: crypto.randomUUID(), reason: "Correction" },
      () => f.now
    )
    expect((await report(range())).current.confirmedAttendance).toBe(0)
    expect((await report(range(-1))).current.issuedTickets).toBe(1)
  })

  it("fails clearly instead of rounding combined money beyond safe integer precision", async () => {
    await abandon()
    await f.db
      .prepare(
        "UPDATE ticket_types SET price_minor=5000000000000000 WHERE id='type'"
      )
      .run()
    f.provider.state = "succeeded"
    for (let i = 0; i < 2; i++) {
      const checkout = await startCheckout(
        f.db,
        "buyer",
        {
          requestId: crypto.randomUUID(),
          eventId: "event",
          items: [
            {
              ticketTypeId: "type",
              quantity: 1,
              attendeeNames: ["High-value fixture"],
            },
          ],
        },
        { now: () => f.now }
      )
      const payment = await startOrderPayment(
        f.env,
        f.provider,
        "buyer",
        checkout.order.id,
        { requestId: crypto.randomUUID(), expectedRevision: 0 },
        { now: () => f.now }
      )
      await processPayment(f.env, f.provider, payment.payment.id, {
        now: () => f.now,
      })
    }
    await expect(report(range())).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("safe integer"),
    })
  })

  it("uses indexed owner/grant, sale/refund, inventory and admission lookups", async () => {
    const period = reportingPeriod(
      { range: "30", limit: 20 },
      "Asia/Almaty",
      f.now
    )
    const bindings = [
      "owner",
      "",
      period.startAt,
      period.endExclusive,
      f.now,
      "owner",
    ]
    const sales = await f.db
      .prepare(`EXPLAIN QUERY PLAN ${overviewMetricsSql}`)
      .bind(...bindings)
      .all<{ detail: string }>()
    const state = await f.db
      .prepare(`EXPLAIN QUERY PLAN ${overviewCurrentSql}`)
      .bind(...bindings)
      .all<{ detail: string }>()
    const plan = sales.results.map((row) => row.detail).join("\n"),
      current = state.results.map((row) => row.detail).join("\n")
    expect(plan).toContain("events_organizer_start")
    expect(plan).toContain("event_permissions_user")
    expect(plan).toContain("orders_reporting")
    expect(plan).toContain("refund_confirmation_reporting")
    expect(plan).toContain("payment_subject_reporting")
    expect(current).toContain("inventory_availability")
    expect(current).toContain("one_active_admission")
    expect(current).toContain("offline_unresolved_order")
    expect(current).toMatch(
      /SEARCH t USING INDEX tickets_event_order \(event_id=\?\)/
    )
    expect(current).toMatch(
      /SEARCH report USING INDEX offline_unresolved_order \(order_id=\? AND review_state=\?\)/
    )
    expect(current).not.toMatch(/\bSCAN (?:t|op|report)\b/)
  })
})
