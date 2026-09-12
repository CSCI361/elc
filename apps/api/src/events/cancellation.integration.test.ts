import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { startCheckout } from "../orders/checkout"
import { consumePaymentOutbox } from "../payments/outbox"
import { processPayment } from "../payments/reconcile"
import {
  ensureEventCancellationRefund,
  prepareEventCancellationRefunds,
  processRefund,
} from "../payments/refunds"
import { loadPayment } from "../payments/store"
import { createPaymentFixture } from "../payments/test-fixture"
import { recoverTicketCredential } from "../tickets/credentials"
import { completeZeroTotalOrder } from "../tickets/issue"
import { scanOnline } from "../tickets/scan"
import { cancelEvent } from "./cancellation"

describe("D1 event cancellation", () => {
  let f: Awaited<ReturnType<typeof createPaymentFixture>>
  beforeEach(async () => {
    f = await createPaymentFixture()
  })
  afterEach(async () => {
    await f?.runtime.dispose()
  })
  const context = (actorId = "owner") => ({
    db: f.db,
    actorId,
    correlationId: "cancel-correlation",
    appOrigin: f.env.APP_ORIGIN,
    now: f.now,
  })
  const input = async (requestId = "cancel") => ({
    requestId,
    expectedRevision: (await f.db
      .prepare("SELECT revision FROM events WHERE id = 'event'")
      .first<number>("revision"))!,
    reason: "The venue is unavailable.",
  })
  async function completePaid() {
    f.provider.state = "succeeded"
    expect(
      await processPayment(f.env, f.provider, f.paymentId, { now: () => f.now })
    ).toBe(true)
    return (await f.db
      .prepare(
        "SELECT id, credential_ciphertext FROM tickets WHERE order_id = ?"
      )
      .bind(f.checkout.order.id)
      .first<{ id: string; credential_ciphertext: string }>())!
  }
  async function assignScanner() {
    await f.db
      .prepare(
        "INSERT INTO event_permissions (event_id, user_id, permission, granted_at) VALUES ('event', 'owner', 'ticket:scan', ?)"
      )
      .bind(f.now)
      .run()
  }
  async function promoBasket() {
    await f.db.batch([
      f.db
        .prepare(
          "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('second', 'Second', 'second@example.test', 1, ?, ?)"
        )
        .bind(f.now, f.now),
      f.db
        .prepare(
          "INSERT INTO campaigns (id, event_id, name, code, token_hash, reporting_id, discount_kind, discount_value, starts_at, ends_at, max_redemptions, enabled, updated_at) VALUES ('promo', 'event', 'Full discount', 'FREE', 'promo-hash', 'promo-report', 'percentage', 10000, ?, ?, 2, 1, ?)"
        )
        .bind(f.now - 1, f.now + 3600000, f.now),
      f.db.prepare(
        "INSERT INTO campaign_ticket_types (campaign_id, ticket_type_id) VALUES ('promo', 'type')"
      ),
    ])
    return startCheckout(
      f.db,
      "second",
      {
        requestId: "zero-basket",
        eventId: "event",
        promoCode: "FREE",
        items: [
          { ticketTypeId: "type", quantity: 1, attendeeNames: ["Second"] },
        ],
      },
      { now: () => f.now }
    )
  }

  it("blocks admission in the cancellation commit and refunds paid orders asynchronously, retaining activation and sold inventory", async () => {
    const ticket = await completePaid()
    await assignScanner()
    const credential = await recoverTicketCredential(
      ticket.id,
      ticket.credential_ciphertext,
      f.env.TICKET_ENCRYPTION_KEY
    )
    expect(
      (
        await scanOnline(f.db, "owner", {
          eventId: "event",
          operationId: "before",
          credential,
        })
      ).result
    ).toBe("checked_in")
    // Automatic cancellation also applies after the voluntary cutoff and after admission.
    await f.db
      .prepare("UPDATE events SET starts_at = ? WHERE id = 'event'")
      .bind(f.now - 1)
      .run()
    const frozen = await f.db
      .prepare(
        "SELECT total_minor, processing_fee_minor, refund_policy_json FROM orders WHERE id = ?"
      )
      .bind(f.checkout.order.id)
      .first()
    const request = await input()
    const result = await cancelEvent(context(), "event", request)
    expect(result.revision).toBe(request.expectedRevision + 1)
    expect(await cancelEvent(context(), "event", request)).toEqual(result)
    expect(f.provider.refunds).toHaveLength(0)
    expect(
      (
        await scanOnline(f.db, "owner", {
          eventId: "event",
          operationId: "after",
          credential,
        })
      ).result
    ).toBe("cancelled")
    expect(
      await f.scalar(
        "SELECT count(*) n FROM checkins WHERE reversed_at IS NULL"
      )
    ).toBe(1)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM orders WHERE state = 'completed' AND admission_blocked_at IS NOT NULL"
      )
    ).toBe(1)
    expect(
      await f.scalar(
        "SELECT calendar_sequence n FROM events WHERE id = 'event'"
      )
    ).toBe(1)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM audit_entries WHERE action = 'event.cancelled'"
      )
    ).toBe(1)
    expect(
      await consumePaymentOutbox(f.env, f.provider, "event-cancel:event")
    ).toBe(true)
    const refundId = (await f.db
      .prepare("SELECT id FROM refunds WHERE payment_attempt_id = ?")
      .bind(f.paymentId)
      .first<string>("id"))!
    expect(f.provider.refunds).toHaveLength(0)
    await consumePaymentOutbox(
      f.env,
      f.provider,
      `refund-reconcile:${refundId}`
    )
    await consumePaymentOutbox(f.env, f.provider, "event-cancel:event")
    await consumePaymentOutbox(
      f.env,
      f.provider,
      `refund-reconcile:${refundId}`
    )
    expect(f.provider.refunds).toHaveLength(1)
    expect(f.provider.refunds[0]).toMatchObject({
      reason: "event_cancelled",
      amountMinor: 1000000,
    })
    expect(
      await f.scalar("SELECT count(*) n FROM tickets WHERE state = 'refunded'")
    ).toBe(1)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM inventory WHERE order_id IS NOT NULL"
      )
    ).toBe(1)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM refunds r JOIN payment_attempts p ON p.id = r.payment_attempt_id WHERE p.purpose = 'event_activation'"
      )
    ).toBe(0)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM event_activations WHERE activated_at IS NOT NULL AND successful_payment_attempt_id IS NOT NULL"
      )
    ).toBe(1)
    expect(
      await f.db
        .prepare(
          "SELECT total_minor, processing_fee_minor, refund_policy_json FROM orders WHERE id = ?"
        )
        .bind(f.checkout.order.id)
        .first()
    ).toEqual(frozen)
  })

  it("cancels zero-total tickets immediately and retains their consumed promo and unavailable allocation", async () => {
    const zero = await promoBasket()
    await completeZeroTotalOrder(
      f.env,
      "second",
      zero.order.id,
      { requestId: "zero-complete", expectedRevision: zero.revision },
      { now: () => f.now }
    )
    await cancelEvent(context(), "event", await input())
    expect(
      await f.scalar(
        "SELECT count(*) n FROM tickets WHERE order_id = ? AND state = 'cancelled'",
        zero.order.id
      )
    ).toBe(1)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM orders WHERE id = ? AND state = 'cancelled' AND admission_blocked_at IS NOT NULL",
        zero.order.id
      )
    ).toBe(1)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM inventory WHERE order_id = ?",
        zero.order.id
      )
    ).toBe(1)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM promo_allocations WHERE committed_at IS NOT NULL AND released_at IS NULL"
      )
    ).toBe(1)
    expect(await prepareEventCancellationRefunds(f.db, "event", f.now)).toBe(
      true
    )
    expect(await f.scalar("SELECT count(*) n FROM refunds")).toBe(0)
    await consumePaymentOutbox(
      f.env,
      () => {
        throw new Error("Payments are unconfigured")
      },
      "event-cancel:event"
    )
    expect(
      await f.scalar(
        "SELECT count(*) n FROM outbox WHERE id = 'event-cancel:event' AND completed_at IS NOT NULL"
      )
    ).toBe(1)
  })

  it("releases incomplete holds and promos, then compensates a late payment without tickets or inventory reclamation", async () => {
    await promoBasket()
    await f.db
      .prepare("UPDATE outbox SET completed_at = ? WHERE id = ?")
      .bind(f.now, f.paymentOutboxId)
      .run()
    await cancelEvent(context(), "event", await input())
    expect(
      await f.scalar(
        "SELECT count(*) n FROM inventory WHERE reservation_id IS NOT NULL"
      )
    ).toBe(0)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM reservations WHERE state = 'active'"
      )
    ).toBe(0)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM promo_allocations WHERE released_at IS NOT NULL AND committed_at IS NULL"
      )
    ).toBe(1)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM outbox WHERE id = ? AND completed_at IS NULL",
        f.paymentOutboxId
      )
    ).toBe(1)
    expect(await prepareEventCancellationRefunds(f.db, "event", f.now)).toBe(
      true
    )
    f.provider.state = "succeeded"
    expect(
      await processPayment(f.env, f.provider, f.paymentId, { now: () => f.now })
    ).toBe(true)
    expect(f.provider.refunds).toHaveLength(1)
    expect(f.provider.refunds[0]?.reason).toBe("technical_compensation")
    expect(await f.scalar("SELECT count(*) n FROM tickets")).toBe(0)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM inventory WHERE order_id IS NOT NULL OR reservation_id IS NOT NULL"
      )
    ).toBe(0)
    expect(
      await f.scalar("SELECT count(*) n FROM refunds WHERE state = 'succeeded'")
    ).toBe(1)
  })

  it("a cancellation between payment lookup and issuance prevents fulfillment and compensates", async () => {
    const request = await input()
    f.provider.state = "succeeded"
    let cancelled = false
    expect(
      await processPayment(f.env, f.provider, f.paymentId, {
        now: () => f.now,
        beforeCommit: async () => {
          if (!cancelled) {
            cancelled = true
            await cancelEvent(context(), "event", request)
          }
        },
      })
    ).toBe(true)
    expect(await f.scalar("SELECT count(*) n FROM tickets")).toBe(0)
    expect(f.provider.refunds).toHaveLength(1)
  })

  it("rejects unauthorized and revoked staff without partial cancellation", async () => {
    const request = await input()
    await expect(
      cancelEvent(context("buyer"), "event", request)
    ).rejects.toMatchObject({ status: 403 })
    await f.db
      .prepare(
        "INSERT INTO event_permissions (event_id, user_id, permission, granted_at) VALUES ('event', 'buyer', 'event:manage', ?)"
      )
      .bind(f.now)
      .run()
    await expect(
      cancelEvent(context("buyer"), "event", request, {
        beforeCommit: async () => {
          await f.db
            .prepare(
              "UPDATE event_permissions SET revoked_at = ? WHERE user_id = 'buyer'"
            )
            .bind(f.now)
            .run()
        },
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(
      await f.scalar(
        "SELECT count(*) n FROM events WHERE cancelled_at IS NOT NULL"
      )
    ).toBe(0)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM inventory WHERE reservation_id IS NOT NULL"
      )
    ).toBe(1)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM outbox WHERE kind = 'event.cancellation'"
      )
    ).toBe(0)
  })

  it("rolls back all effects for a stale event revision or broken inventory invariant", async () => {
    const request = await input()
    await expect(
      cancelEvent(context(), "event", {
        ...request,
        expectedRevision: request.expectedRevision + 1,
      })
    ).rejects.toMatchObject({ status: 409 })
    await f.db.prepare("DELETE FROM inventory WHERE id = 'slot-3'").run()
    await expect(
      cancelEvent(context(), "event", request)
    ).rejects.toMatchObject({ status: 409 })
    expect(
      await f.scalar(
        "SELECT count(*) n FROM events WHERE cancelled_at IS NOT NULL"
      )
    ).toBe(0)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM orders WHERE state = 'pending' AND admission_blocked_at IS NULL"
      )
    ).toBe(1)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM request_receipts WHERE request_id = 'cancel'"
      )
    ).toBe(0)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM audit_entries WHERE action = 'event.cancelled'"
      )
    ).toBe(0)
  })

  it("concurrent cancellation requests create one transition and one asynchronous refund", async () => {
    await completePaid()
    const request = await input()
    const results = await Promise.all([
      cancelEvent(context(), "event", request),
      cancelEvent(context(), "event", request),
    ])
    expect(results[0]).toEqual(results[1])
    await Promise.all([
      prepareEventCancellationRefunds(f.db, "event", f.now),
      prepareEventCancellationRefunds(f.db, "event", f.now),
    ])
    expect(await f.scalar("SELECT count(*) n FROM refunds")).toBe(1)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM outbox WHERE kind = 'event.cancellation'"
      )
    ).toBe(1)
    const refund = (await f.db
      .prepare("SELECT id FROM refunds")
      .first<string>("id"))!
    f.provider.refundOutcome = "uncertain"
    f.provider.refundVisible = false
    await processRefund(f.db, f.provider, refund, f.now)
    await processRefund(f.db, f.provider, refund, f.now)
    expect(f.provider.refunds).toHaveLength(1)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM orders WHERE admission_blocked_at IS NOT NULL"
      )
    ).toBe(1)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM refunds WHERE state = 'pending' AND dispatch_state = 'uncertain'"
      )
    ).toBe(1)
    f.provider.refundVisible = true
    await processRefund(f.db, f.provider, refund, f.now)
    expect(f.provider.refunds).toHaveLength(1)
    expect(
      await f.scalar("SELECT count(*) n FROM refunds WHERE state = 'succeeded'")
    ).toBe(1)
  })

  it("cannot prepare an event refund before cancellation or use activation as an attendee payment", async () => {
    await completePaid()
    await expect(
      ensureEventCancellationRefund(
        f.db,
        await loadPayment(f.db, f.paymentId),
        f.now
      )
    ).rejects.toMatchObject({ status: 409 })
    const activation = (await f.db
      .prepare(
        "SELECT successful_payment_attempt_id id FROM event_activations WHERE event_id = 'event'"
      )
      .first<string>("id"))!
    await cancelEvent(context(), "event", await input())
    await expect(
      ensureEventCancellationRefund(
        f.db,
        await loadPayment(f.db, activation),
        f.now
      )
    ).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" })
    expect(await f.scalar("SELECT count(*) n FROM refunds")).toBe(0)
  })
})
