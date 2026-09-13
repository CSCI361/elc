import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { startCheckout } from "../orders/checkout"
import { abandonCheckout } from "../orders/lifecycle"
import { startOrderPayment } from "../payments/checkout"
import { processPayment } from "../payments/reconcile"
import { processRefund } from "../payments/refunds"
import { createPaymentFixture } from "../payments/test-fixture"
import {
  approveOrderRefund,
  cancelFreeRegistration,
} from "../payments/voluntary"
import { createSupportCase } from "../support/service"
import { recoverTicketCredential } from "../tickets/credentials"
import { completeZeroTotalOrder } from "../tickets/issue"
import { reverseCheckIn, scanOnline } from "../tickets/scan"
import { calendarDateAt, addCalendarDays } from "./dates"
import { readEventAnalytics } from "./read"
import { metricSelection, salesEntries } from "./sql"
import { listAnalyticsEvents } from "./events"

describe("authoritative D1 event reports", () => {
  let f: Awaited<ReturnType<typeof createPaymentFixture>>
  beforeEach(async () => {
    f = await createPaymentFixture()
  })
  afterEach(async () => {
    await f?.runtime.dispose()
  })
  const report = (query: unknown = {}, actor = "owner") =>
    readEventAnalytics(f.db, actor, "event", query, { now: () => f.now })
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
      { requestId: "abandon", expectedRevision: f.checkout.revision },
      f.now
    )
  }
  async function grant(permission = "analytics:read", actor = "buyer") {
    await f.db
      .prepare(
        "INSERT INTO event_permissions (event_id,user_id,permission,granted_at) VALUES ('event',?,?,?)"
      )
      .bind(actor, permission, f.now)
      .run()
  }
  async function refund(orderId: string, confirmedAt = f.now + 86_400_000) {
    const support = await createSupportCase(
      f.db,
      "buyer",
      {
        requestId: crypto.randomUUID(),
        audience: "attendee",
        category: "refund",
        subject: "Please refund",
        orderId,
        body: "Please refund the order.",
      },
      { now: () => f.now }
    )
    const revision = await f.db
      .prepare("SELECT revision FROM orders WHERE id = ?")
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
        reason: "Approved refund request.",
      },
      { now: () => f.now }
    )
    await processRefund(f.db, f.provider, result.refundId, confirmedAt)
  }
  async function splitTypes() {
    await abandon()
    await f.db.batch([
      f.db.prepare(
        "UPDATE ticket_types SET price_minor = 17, quantity = 2 WHERE id = 'type'"
      ),
      f.db
        .prepare(
          "INSERT INTO ticket_types (id,event_id,name,kind,price_minor,quantity,sales_start_at,sales_end_at,updated_at) VALUES ('z-type','event','Second type','paid',17,2,?,?,?)"
        )
        .bind(f.now - 1000, f.now + 3_600_000, f.now),
      f.db.prepare(
        "UPDATE inventory SET ticket_type_id = 'z-type' WHERE id IN ('slot-2','slot-3')"
      ),
    ])
  }
  async function campaign(id: string, discount = 5000) {
    await f.db.batch([
      f.db
        .prepare(`INSERT INTO campaigns (id,event_id,name,code,token_hash,reporting_id,discount_kind,discount_value,starts_at,ends_at,max_redemptions,enabled,updated_at)
        VALUES (?,'event',?,?,?,?,'percentage',?,?,?,10,1,?)`)
        .bind(
          id,
          id,
          id,
          `hash-${id}`,
          `report-${id}`,
          discount,
          f.now - 1,
          f.now + 3_600_000,
          f.now
        ),
      f.db
        .prepare(
          "INSERT INTO campaign_ticket_types (campaign_id,ticket_type_id) VALUES (?,'type')"
        )
        .bind(id),
    ])
  }
  async function mixedOrder(promoCode?: string) {
    const basket = await startCheckout(
      f.db,
      "buyer",
      {
        requestId: crypto.randomUUID(),
        eventId: "event",
        promoCode,
        items: [
          { ticketTypeId: "type", quantity: 1, attendeeNames: ["One"] },
          { ticketTypeId: "z-type", quantity: 1, attendeeNames: ["Two"] },
        ],
      },
      { now: () => f.now }
    )
    f.provider.state = "succeeded"
    const payment = await startOrderPayment(
      f.env,
      f.provider,
      "buyer",
      basket.order.id,
      { requestId: crypto.randomUUID(), expectedRevision: basket.revision },
      { now: () => f.now }
    )
    await processPayment(f.env, f.provider, payment.payment.id, {
      now: () => f.now,
    })
    return basket.order.id
  }

  it("reports held inventory before payment, completed snapshots after payment and activation separately", async () => {
    const held = await report()
    expect(held.current).toMatchObject({
      capacity: 4,
      remainingInventory: 3,
      reservedInventory: 1,
      issuedTickets: 0,
      eligibleAttendance: 0,
      attendancePercent: 0,
    })
    expect(held.summary.ticketsIssued).toBe(0)
    expect(held.otherPayments).toMatchObject({
      activationFeesMinor: 500_000,
      unfulfilledCompensationMinor: 0,
      attendeeProcessingChargesMinor: 0,
    })
    await paid()
    const result = await report()
    expect(result.current).toMatchObject({
      capacity: 4,
      remainingInventory: 3,
      reservedInventory: 0,
      issuedTickets: 1,
      soldPercent: 25,
      eligibleAttendance: 1,
      confirmedAttendance: 0,
      absent: 1,
    })
    expect(result.summary).toEqual({
      completedOrders: 1,
      ticketsIssued: 1,
      grossMinor: 1_000_000,
      discountMinor: 0,
      refundedTickets: 0,
      ticketRefundMinor: 0,
      netTicketRevenueMinor: 1_000_000,
      processingFeeMinor: 30_000,
      processingFeeReversalMinor: 0,
      estimatedPayoutMinor: 970_000,
      committedRedemptions: 0,
    })
    expect(result.daily.find((row) => row.date === day())?.grossMinor).toBe(
      1_000_000
    )
    expect(result.daily.filter((row) => row.grossMinor)).toHaveLength(1)
    expect((await report(range(-1))).summary.grossMinor).toBe(0)
    expect((await report(range(-1))).current.issuedTickets).toBe(1)
    await f.db
      .prepare(
        "UPDATE ticket_types SET price_minor = 2, name = 'Renamed current type' WHERE id = 'type'"
      )
      .run()
    expect((await report()).summary.grossMinor).toBe(1_000_000)
  })

  it("retains original sales and reports later full refunds on their confirmation day with fee reversal", async () => {
    await paid()
    await refund(f.checkout.order.id)
    const sale = await report(range())
    expect(sale.summary).toMatchObject({
      grossMinor: 1_000_000,
      ticketRefundMinor: 0,
      netTicketRevenueMinor: 1_000_000,
    })
    expect(sale.current).toMatchObject({
      issuedTickets: 1,
      refundedTickets: 1,
      nonCancelledNonRefundedTickets: 0,
      eligibleAttendance: 0,
    })
    const later = await report(range(1))
    expect(later.summary).toMatchObject({
      completedOrders: 0,
      ticketsIssued: 0,
      refundedTickets: 1,
      grossMinor: 0,
      ticketRefundMinor: 1_000_000,
      netTicketRevenueMinor: -1_000_000,
      processingFeeMinor: 0,
      processingFeeReversalMinor: 30_000,
      estimatedPayoutMinor: -970_000,
    })
    const combined = await report({
      range: "custom",
      start: day(),
      end: day(1),
    })
    expect(combined.summary).toMatchObject({
      completedOrders: 1,
      grossMinor: 1_000_000,
      netTicketRevenueMinor: 0,
      estimatedPayoutMinor: 0,
    })
    expect(combined.daily[0]!.netTicketRevenueMinor).toBe(1_000_000)
    expect(combined.daily[1]!.netTicketRevenueMinor).toBe(-1_000_000)
  })

  it("allocates one rounded fee across a mixed order before filtering and keeps original snapshots", async () => {
    await splitTypes()
    const orderId = await mixedOrder()
    const all = await report(range())
    const first = await report({ ...range(), ticketTypeId: "type" })
    const second = await report({ ...range(), ticketTypeId: "z-type" })
    expect(all.summary).toMatchObject({
      completedOrders: 1,
      ticketsIssued: 2,
      grossMinor: 34,
      processingFeeMinor: 1,
      estimatedPayoutMinor: 33,
    })
    expect(first.summary).toMatchObject({
      ticketsIssued: 1,
      processingFeeMinor: 1,
      grossMinor: 17,
    })
    expect(second.summary).toMatchObject({
      ticketsIssued: 1,
      processingFeeMinor: 0,
      grossMinor: 17,
    })
    expect(first.current).toMatchObject({
      capacity: 2,
      remainingInventory: 1,
      soldPercent: 50,
    })
    expect(
      all.ticketTypes.reduce((sum, row) => sum + row.processingFeeMinor, 0)
    ).toBe(1)
    await refund(orderId)
    expect(
      (await report({ ...range(1), ticketTypeId: "type" })).summary
        .processingFeeReversalMinor
    ).toBe(1)
    expect(
      (await report({ ...range(1), ticketTypeId: "z-type" })).summary
        .processingFeeReversalMinor
    ).toBe(0)
  })

  it("counts committed campaign orders once across types and retains attribution through refunds and pagination", async () => {
    await splitTypes()
    await campaign("campaign-a")
    await campaign("campaign-b")
    const orderId = await mixedOrder("campaign-a")
    const reportA = await report({ ...range(), limit: 1 })
    expect(reportA.campaigns[0]).toMatchObject({
      id: "campaign-a",
      completedOrders: 1,
      committedRedemptions: 1,
      ticketsIssued: 2,
      grossMinor: 34,
      discountMinor: 9,
      netTicketRevenueMinor: 25,
    })
    expect(reportA.nextCampaignCursor).toBe("campaign-a")
    expect(reportA.nextTypeCursor).toBe("type")
    const next = await report({
      ...range(),
      limit: 1,
      campaignAfter: reportA.nextCampaignCursor,
      typeAfter: reportA.nextTypeCursor,
    })
    expect(next.campaigns[0]).toMatchObject({
      id: "campaign-b",
      ticketsIssued: 0,
      committedRedemptions: 0,
    })
    expect(next.ticketTypes[0]?.id).toBe("z-type")
    expect(next.nextCampaignCursor).toBeNull()
    await refund(orderId)
    const later = await report(range(1))
    expect(later.campaigns[0]).toMatchObject({
      id: "campaign-a",
      committedRedemptions: 0,
      completedOrders: 0,
      refundedTickets: 2,
      ticketRefundMinor: 25,
      netTicketRevenueMinor: -25,
    })
    expect(
      await f.scalar(
        "SELECT count(*) n FROM promo_allocations WHERE committed_at IS NOT NULL"
      )
    ).toBe(1)
  })

  it("keeps fee allocation exact near the safe integer amount limit", async () => {
    await splitTypes()
    await f.db
      .prepare(
        "UPDATE ticket_types SET price_minor = 4000000000000017 WHERE event_id = 'event'"
      )
      .run()
    await mixedOrder()
    const result = await report(range())
    expect(result.summary).toMatchObject({
      grossMinor: 8_000_000_000_000_034,
      processingFeeMinor: 240_000_000_000_001,
      estimatedPayoutMinor: 7_760_000_000_000_033,
    })
    expect(result.ticketTypes.map((row) => row.processingFeeMinor)).toEqual([
      120_000_000_000_001, 120_000_000_000_000,
    ])
  })

  it("includes zero-total issued tickets and consumed redemptions after free cancellation", async () => {
    await abandon()
    await campaign("free", 10000)
    const basket = await startCheckout(
      f.db,
      "buyer",
      {
        requestId: "free-basket",
        eventId: "event",
        promoCode: "free",
        items: [
          { ticketTypeId: "type", quantity: 2, attendeeNames: ["One", "Two"] },
        ],
      },
      { now: () => f.now }
    )
    await completeZeroTotalOrder(
      f.env,
      "buyer",
      basket.order.id,
      { requestId: "complete-free", expectedRevision: basket.revision },
      { now: () => f.now }
    )
    const revision = await f.db
      .prepare("SELECT revision FROM orders WHERE id = ?")
      .bind(basket.order.id)
      .first<number>("revision")
    await cancelFreeRegistration(
      f.db,
      "owner",
      basket.order.id,
      {
        requestId: "cancel-free",
        expectedRevision: revision,
        reason: "Unable to attend.",
      },
      { now: () => f.now }
    )
    const result = await report()
    expect(result.summary).toMatchObject({
      completedOrders: 1,
      ticketsIssued: 2,
      grossMinor: 2_000_000,
      discountMinor: 2_000_000,
      netTicketRevenueMinor: 0,
      committedRedemptions: 1,
      processingFeeMinor: 0,
    })
    expect(result.current).toMatchObject({
      cancelledTickets: 2,
      nonCancelledNonRefundedTickets: 0,
      soldPercent: 0,
      eligibleAttendance: 0,
      attendancePercent: 0,
      remainingInventory: 4,
    })
    expect(result.campaigns[0]!.committedRedemptions).toBe(1)
  })

  it("excludes unfulfilled late-payment compensation from ticket revenue and attendance", async () => {
    await abandon()
    f.provider.state = "succeeded"
    await processPayment(f.env, f.provider, f.paymentId, { now: () => f.now })
    const refundId = (await f.db
      .prepare("SELECT id FROM refunds WHERE payment_attempt_id = ?")
      .bind(f.paymentId)
      .first<string>("id"))!
    await processRefund(f.db, f.provider, refundId, f.now)
    const result = await report()
    expect(result.summary).toMatchObject({
      completedOrders: 0,
      ticketsIssued: 0,
      grossMinor: 0,
      ticketRefundMinor: 0,
      estimatedPayoutMinor: 0,
    })
    expect(result.otherPayments.unfulfilledCompensationMinor).toBe(1_000_000)
    expect(result.current.eligibleAttendance).toBe(0)
  })

  it("counts canonical active admissions, removes reversals and excludes admission-blocked history", async () => {
    await paid()
    await grant("ticket:scan", "owner")
    await grant("checkin:reverse", "owner")
    const ticket = (await f.db
      .prepare("SELECT id,credential_ciphertext FROM tickets")
      .first<{ id: string; credential_ciphertext: string }>())!
    const credential = await recoverTicketCredential(
      ticket.id,
      ticket.credential_ciphertext,
      f.env.TICKET_ENCRYPTION_KEY
    )
    const scan = await scanOnline(
      f.db,
      "owner",
      { eventId: "event", operationId: "scan", credential },
      { now: () => f.now }
    )
    expect((await report()).current).toMatchObject({
      confirmedAttendance: 1,
      absent: 0,
      attendancePercent: 100,
    })
    await reverseCheckIn(
      f.db,
      "owner",
      "event",
      scan.checkInId!,
      { requestId: "reverse", reason: "Correction" },
      () => f.now
    )
    expect((await report()).current).toMatchObject({
      confirmedAttendance: 0,
      absent: 1,
    })
    await scanOnline(
      f.db,
      "owner",
      { eventId: "event", operationId: "scan-again", credential },
      { now: () => f.now }
    )
    await f.db
      .prepare("UPDATE orders SET admission_blocked_at = ? WHERE id = ?")
      .bind(f.now, f.checkout.order.id)
      .run()
    expect((await report()).current).toMatchObject({
      issuedTickets: 1,
      eligibleAttendance: 0,
      confirmedAttendance: 0,
      absent: 0,
      attendancePercent: 0,
      unsynchronizedOfflineCount: null,
    })
    expect(
      await f.scalar(
        "SELECT count(*) n FROM checkins WHERE reversed_at IS NULL"
      )
    ).toBe(1)
  })

  it("rechecks current permission, suspension and time zone in the reporting transaction", async () => {
    await paid()
    await expect(report({}, "buyer")).rejects.toMatchObject({ status: 404 })
    await grant("event:manage")
    await expect(report({}, "buyer")).rejects.toMatchObject({ status: 404 })
    await grant()
    expect((await report({}, "buyer")).summary.ticketsIssued).toBe(1)
    await expect(
      report({ ticketTypeId: "unrelated" }, "buyer")
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      readEventAnalytics(
        f.db,
        "buyer",
        "event",
        {},
        {
          beforeRead: async () => {
            await f.db
              .prepare(
                "UPDATE event_permissions SET revoked_at = ? WHERE user_id = 'buyer'"
              )
              .bind(f.now)
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      readEventAnalytics(
        f.db,
        "owner",
        "event",
        {},
        {
          beforeRead: async () => {
            await f.db
              .prepare("UPDATE events SET time_zone = 'UTC' WHERE id = 'event'")
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ status: 404 })
    await f.db
      .prepare(
        "INSERT INTO profiles (user_id,locale,suspended_at,updated_at) VALUES ('owner','kk',?,?)"
      )
      .bind(f.now, f.now)
      .run()
    await expect(report()).rejects.toMatchObject({ status: 404 })
  })

  it("lists analytics-only assignments without requiring management access and removes revoked results", async () => {
    expect((await listAnalyticsEvents(f.db, "buyer")).items).toEqual([])
    await grant()
    expect(
      (await listAnalyticsEvents(f.db, "buyer", { q: "Webhook", limit: 1 }))
        .items[0]?.id
    ).toBe("event")
    expect(
      (await listAnalyticsEvents(f.db, "buyer", { q: "%" })).items
    ).toEqual([])
    expect(
      (await listAnalyticsEvents(f.db, "buyer", { after: "event" })).items
    ).toEqual([])
    await f.db
      .prepare(
        "UPDATE event_permissions SET revoked_at = ? WHERE user_id = 'buyer'"
      )
      .bind(f.now)
      .run()
    expect((await listAnalyticsEvents(f.db, "buyer")).items).toEqual([])
    await expect(listAnalyticsEvents(f.db, "unknown")).rejects.toMatchObject({
      status: 403,
    })
    await expect(
      listAnalyticsEvents(f.db, "owner", { limit: 51 })
    ).rejects.toMatchObject({ status: 400 })
  })

  it("reads consistent current counts while checkout and scanning commit, with indexed sales and refund lookups", async () => {
    await paid()
    await grant("ticket:scan", "owner")
    const ticket = (await f.db
      .prepare("SELECT id,credential_ciphertext FROM tickets")
      .first<{ id: string; credential_ciphertext: string }>())!
    const credential = await recoverTicketCredential(
      ticket.id,
      ticket.credential_ciphertext,
      f.env.TICKET_ENCRYPTION_KEY
    )
    const [reports] = await Promise.all([
      Promise.all(Array.from({ length: 3 }, () => report())),
      startCheckout(
        f.db,
        "buyer",
        {
          requestId: "concurrent-basket",
          eventId: "event",
          items: [
            {
              ticketTypeId: "type",
              quantity: 2,
              attendeeNames: ["One", "Two"],
            },
          ],
        },
        { now: () => f.now }
      ),
      scanOnline(
        f.db,
        "owner",
        { eventId: "event", operationId: "concurrent-scan", credential },
        { now: () => f.now }
      ),
    ])
    for (const result of reports) {
      expect(
        result.current.remainingInventory +
          result.current.reservedInventory +
          result.current.issuedTickets
      ).toBe(4)
      expect(result.current.confirmedAttendance + result.current.absent).toBe(
        result.current.eligibleAttendance
      )
      expect(result.summary.ticketsIssued).toBe(1)
    }
    expect((await report()).current).toMatchObject({
      remainingInventory: 1,
      reservedInventory: 2,
      confirmedAttendance: 1,
    })
    const plan = await f.db
      .prepare(
        `EXPLAIN QUERY PLAN ${salesEntries} SELECT ${metricSelection} FROM entries entry`
      )
      .bind(
        "event",
        "Asia/Almaty",
        "owner",
        f.now - 86_400_000,
        f.now + 86_400_000,
        null
      )
      .all<{ detail: string }>()
    const detail = plan.results.map((row) => row.detail).join("\n")
    expect(detail).toContain("orders_reporting")
    expect(detail).toContain("refund_confirmation_reporting")
  })
})
