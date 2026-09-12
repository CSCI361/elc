import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { policy } from "@elc/shared"
import { cancelEvent } from "../events/cancellation"
import { startCheckout } from "../orders/checkout"
import { createSupportCase, changeSupportStatus } from "../support/service"
import { startOrderPayment } from "./checkout"
import { readEventPayouts } from "./payout-read"
import { simulateDuePayouts, simulateEventPayout } from "./payouts"
import { processPayment } from "./reconcile"
import { prepareEventCancellationRefunds, processRefund } from "./refunds"
import { createPaymentFixture } from "./test-fixture"
import { approveOrderRefund } from "./voluntary"

describe("D1 simulated payout ledger", () => {
  let f: Awaited<ReturnType<typeof createPaymentFixture>>
  let due: number
  beforeEach(async () => {
    f = await createPaymentFixture()
    f.provider.state = "succeeded"
    await processPayment(f.env, f.provider, f.paymentId, { now: () => f.now })
    due = f.now + 7_200_000 + policy.payoutDelayMs
  })
  afterEach(async () => {
    await f?.runtime.dispose()
  })
  const run = (now = due, beforeCommit?: () => Promise<void>) =>
    simulateEventPayout(f.db, "event", { now: () => now, beforeCommit })
  const count = (table: string) => f.scalar(`SELECT count(*) n FROM ${table}`)
  async function support(
    category: "refund" | "dispute" | "compensation" | "technical" = "refund"
  ) {
    return createSupportCase(f.db, "buyer", {
      requestId: `case-${category}`,
      audience: "attendee",
      category,
      subject: "Financial request",
      orderId: f.checkout.order.id,
      body: "Please review this order.",
    })
  }
  async function anotherPaidOrder() {
    const basket = await startCheckout(
      f.db,
      "buyer",
      {
        requestId: crypto.randomUUID(),
        eventId: "event",
        items: [
          {
            ticketTypeId: "type",
            quantity: 1,
            attendeeNames: ["Second guest"],
          },
        ],
      },
      { now: () => f.now }
    )
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
  async function makeActuallyDue() {
    await f.db
      .prepare(`UPDATE events SET registration_opens_at = ?, registration_closes_at = ?,
      starts_at = ?, ends_at = ? WHERE id = 'event'`)
      .bind(
        f.now - 10 * 86_400_000,
        f.now - 9 * 86_400_000,
        f.now - 8 * 86_400_000 - 3_600_000,
        f.now - 8 * 86_400_000
      )
      .run()
  }

  it("holds the full balance until seven days after event end, then pays once without deducting activation", async () => {
    const before = await readEventPayouts(f.db, "owner", "event")
    expect(before.summary).toMatchObject({
      completedPaymentsMinor: 1_000_000,
      remainingProcessingFeesMinor: 30_000,
      estimatedContributionMinor: 970_000,
      outstandingMinor: 970_000,
      heldMinor: 970_000,
      availableMinor: 0,
    })
    expect(await run(due - 1)).toBeNull()
    expect(await simulateEventPayout(f.db, "event")).toBeNull()
    expect(await run()).toMatchObject({
      simulation: true,
      amountMinor: 970_000,
      orderCount: 1,
    })
    expect(await run(due + 1)).toBeNull()
    const after = await readEventPayouts(f.db, "owner", "event")
    expect(after).toMatchObject({
      simulation: true,
      currency: "KZT",
      summary: {
        simulatedPaidMinor: 970_000,
        adjustmentMinor: 0,
        outstandingMinor: 0,
        heldMinor: 0,
      },
    })
    expect(after.payouts[0]!.items[0]).toMatchObject({
      orderId: f.checkout.order.id,
      paidMinor: 1_000_000,
      processingFeeMinor: 30_000,
      contributionMinor: 970_000,
      adjustment: null,
    })
    expect(await count("simulated_payout_items")).toBe(1)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM audit_entries WHERE action = 'payout.simulated'"
      )
    ).toBe(1)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM outbox WHERE kind = 'payout.simulated'"
      )
    ).toBe(1)
    expect(f.provider.refunds).toHaveLength(0)
  })

  it.each(["refund", "dispute", "compensation"] as const)(
    "withholds only the order with an unresolved %s case and releases it after resolution",
    async (category) => {
      const second = await anotherPaidOrder()
      const opened = await support(category)
      expect(await run()).toMatchObject({ amountMinor: 970_000, orderCount: 1 })
      expect(
        await f.db
          .prepare("SELECT order_id FROM simulated_payout_items")
          .first<string>("order_id")
      ).toBe(second)
      expect(await run()).toBeNull()
      await changeSupportStatus(f.db, "owner", opened.case.id, {
        requestId: "resolved",
        expectedRevision: opened.case.revision,
        status: "resolved",
      })
      expect(await run(due + 1)).toMatchObject({
        amountMinor: 970_000,
        orderCount: 1,
      })
      expect(await count("simulated_payouts")).toBe(2)
    }
  )

  it("ordinary support and a later sales suspension do not create an extra reserve", async () => {
    await support("technical")
    await f.db
      .prepare(
        "UPDATE events SET paid_sales_state = 'suspended' WHERE id = 'event'"
      )
      .run()
    await f.db
      .prepare(
        "UPDATE event_activations SET identity_check = 'failed', revision = revision + 1 WHERE event_id = 'event'"
      )
      .run()
    expect(await run()).toMatchObject({ amountMinor: 970_000 })
  })

  it("retains a financial hold after the support case closes while the refund is pending or failed", async () => {
    const opened = await support()
    const revision = (await f.db
      .prepare("SELECT revision FROM orders WHERE id = ?")
      .bind(f.checkout.order.id)
      .first<number>("revision"))!
    const approved = await approveOrderRefund(
      f.db,
      "owner",
      f.checkout.order.id,
      {
        requestId: "approve",
        expectedRevision: revision,
        caseId: opened.case.id,
        reason: "Approved by organizer",
      }
    )
    await changeSupportStatus(f.db, "owner", opened.case.id, {
      requestId: "resolve",
      expectedRevision: opened.case.revision,
      status: "resolved",
    })
    expect(await run()).toBeNull()
    f.provider.refundOutcome = "definite_failure"
    await processRefund(f.db, f.provider, approved.refundId)
    expect(await run()).toBeNull()
    expect(
      (await readEventPayouts(f.db, "owner", "event")).summary.heldMinor
    ).toBe(970_000)
  })

  it.each(["case", "cancellation", "end_time"] as const)(
    "rechecks %s at payout commit and rolls back the entire run",
    async (change) => {
      await anotherPaidOrder()
      expect(
        await run(due, async () => {
          if (change === "case") await support("dispute")
          if (change === "cancellation")
            await f.db
              .prepare("UPDATE events SET cancelled_at = ? WHERE id = 'event'")
              .bind(f.now)
              .run()
          if (change === "end_time")
            await f.db
              .prepare(
                "UPDATE events SET ends_at = ends_at + 1 WHERE id = 'event'"
              )
              .run()
        })
      ).toBeNull()
      expect(await count("simulated_payouts")).toBe(0)
      expect(await count("simulated_payout_items")).toBe(0)
      expect(
        await f.scalar(
          "SELECT count(*) n FROM outbox WHERE kind = 'payout.simulated'"
        )
      ).toBe(0)
      expect(await count("transition_guards")).toBe(0)
      if (change === "case")
        expect(await run()).toMatchObject({
          orderCount: 1,
          amountMinor: 970_000,
        })
    }
  )

  it("competing scheduled runs cannot pay the same completed order twice", async () => {
    const result = await Promise.all([run(), run()])
    expect(result.filter(Boolean)).toHaveLength(1)
    expect(await count("simulated_payouts")).toBe(1)
    expect(await count("simulated_payout_items")).toBe(1)
  })

  it("uses the database clock for Cron and records one linked negative adjustment after a later full refund", async () => {
    await makeActuallyDue()
    await simulateDuePayouts(f.db)
    await simulateDuePayouts(f.db)
    const payout = (await readEventPayouts(f.db, "owner", "event")).payouts[0]!
    expect(payout.amountMinor).toBe(970_000)
    const revision = (await f.db
      .prepare("SELECT revision FROM events WHERE id = 'event'")
      .first<number>("revision"))!
    await cancelEvent(
      {
        db: f.db,
        actorId: "owner",
        now: Date.now(),
        correlationId: "cancel",
        appOrigin: f.env.APP_ORIGIN,
      },
      "event",
      {
        requestId: "cancel",
        expectedRevision: revision,
        reason: "Cancelled after the demonstration",
      }
    )
    await prepareEventCancellationRefunds(f.db, "event")
    const refundId = (await f.db
      .prepare("SELECT id FROM refunds WHERE payment_attempt_id = ?")
      .bind(f.paymentId)
      .first<string>("id"))!
    await processRefund(f.db, f.provider, refundId)
    await processRefund(f.db, f.provider, refundId)
    await processPayment(f.env, f.provider, f.paymentId)
    const report = await readEventPayouts(f.db, "owner", "event")
    expect(report.summary).toEqual({
      completedPaymentsMinor: 1_000_000,
      confirmedRefundsMinor: 1_000_000,
      remainingProcessingFeesMinor: 0,
      estimatedContributionMinor: 0,
      simulatedPaidMinor: 970_000,
      adjustmentMinor: -970_000,
      outstandingMinor: 0,
      heldMinor: 0,
      availableMinor: 0,
    })
    expect(report.payouts[0]).toMatchObject({
      id: payout.id,
      amountMinor: 970_000,
      items: [
        {
          paidMinor: 1_000_000,
          processingFeeMinor: 30_000,
          contributionMinor: 970_000,
          adjustment: { refundId, amountMinor: -970_000 },
        },
      ],
    })
    expect(await count("simulated_payout_adjustments")).toBe(1)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM audit_entries WHERE action = 'payout.adjusted'"
      )
    ).toBe(1)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM outbox WHERE kind = 'payout.adjusted'"
      )
    ).toBe(1)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM refunds r JOIN payment_attempts p ON p.id = r.payment_attempt_id WHERE p.purpose = 'event_activation'"
      )
    ).toBe(0)
    await expect(
      f.db.prepare("UPDATE simulated_payouts SET amount_minor = 0").run()
    ).rejects.toThrow(/payout_immutable/)
    await expect(
      f.db
        .prepare("UPDATE simulated_payout_items SET contribution_minor = 0")
        .run()
    ).rejects.toThrow(/payout_item_immutable/)
    await expect(
      f.db
        .prepare("UPDATE simulated_payout_adjustments SET amount_minor = 0")
        .run()
    ).rejects.toThrow(/payout_adjustment_immutable/)
  })

  it("protects financial history with current event analytics permission and bounded cursors", async () => {
    for (const actor of ["buyer", "unknown"])
      await expect(
        readEventPayouts(f.db, actor, "event")
      ).rejects.toMatchObject({ status: 404 })
    await f.db
      .prepare(
        "INSERT INTO event_permissions (event_id, user_id, permission, granted_at) VALUES ('event', 'buyer', 'analytics:read', ?)"
      )
      .bind(f.now)
      .run()
    await run()
    await anotherPaidOrder()
    await run(due + 1)
    const first = await readEventPayouts(f.db, "buyer", "event", { limit: 1 })
    const next = await readEventPayouts(f.db, "buyer", "event", {
      limit: 1,
      before: first.nextCursor,
    })
    expect(first.nextCursor).not.toBeNull()
    expect(next.payouts[0]!.id).not.toBe(first.payouts[0]!.id)
    expect(next.nextCursor).toBeNull()
    await expect(
      readEventPayouts(f.db, "buyer", "event", { limit: 51 })
    ).rejects.toThrow()
    await expect(
      readEventPayouts(f.db, "buyer", "event", { before: "not-a-cursor" })
    ).rejects.toThrow()
    await f.db
      .prepare(
        "UPDATE event_permissions SET revoked_at = ? WHERE user_id = 'buyer'"
      )
      .bind(f.now)
      .run()
    await expect(
      readEventPayouts(f.db, "buyer", "event", { before: first.nextCursor })
    ).rejects.toMatchObject({ status: 404 })
  })
})
