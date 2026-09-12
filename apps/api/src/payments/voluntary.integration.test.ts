import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { startCheckout } from "../orders/checkout"
import { abandonCheckout } from "../orders/lifecycle"
import { createSupportCase, changeSupportStatus } from "../support/service"
import { readSupportCase } from "../support/read"
import { recoverTicketCredential } from "../tickets/credentials"
import { completeZeroTotalOrder } from "../tickets/issue"
import { reverseCheckIn, scanOnline } from "../tickets/scan"
import { readOrderRefund } from "./refund-read"
import { processPayment } from "./reconcile"
import { processRefund } from "./refunds"
import { createPaymentFixture } from "./test-fixture"
import { approveOrderRefund, cancelFreeRegistration } from "./voluntary"

describe("D1 voluntary full refunds and registration cancellation", () => {
  let f: Awaited<ReturnType<typeof createPaymentFixture>>
  let caseId: string
  beforeEach(async () => {
    f = await createPaymentFixture()
    const opened = await createSupportCase(
      f.db,
      "buyer",
      {
        requestId: "refund-case",
        audience: "attendee",
        category: "refund",
        subject: "Refund request",
        orderId: f.checkout.order.id,
        body: "Please refund my order.",
      },
      { now: () => f.now }
    )
    caseId = opened.case.id
  })
  afterEach(async () => {
    await f?.runtime.dispose()
  })
  const input = async (orderId = f.checkout.order.id) => ({
    requestId: "approve",
    caseId,
    reason: "Approved at the purchaser's request.",
    expectedRevision: (await f.db
      .prepare("SELECT revision FROM orders WHERE id = ?")
      .bind(orderId)
      .first<number>("revision"))!,
  })
  async function paid() {
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
  async function grant(actorId: string, permission: string) {
    await f.db.batch([
      f.db
        .prepare(
          "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(id) DO NOTHING"
        )
        .bind(actorId, actorId, `${actorId}@example.test`, f.now, f.now),
      f.db
        .prepare(
          "INSERT INTO event_permissions (event_id, user_id, permission, granted_at) VALUES ('event', ?, ?, ?) ON CONFLICT(event_id, user_id, permission) DO UPDATE SET revoked_at = NULL"
        )
        .bind(actorId, permission, f.now),
    ])
  }
  async function zero() {
    await abandonCheckout(
      f.db,
      "buyer",
      f.checkout.order.id,
      { requestId: "abandon-paid", expectedRevision: f.checkout.revision },
      f.now
    )
    await f.db.batch([
      f.db
        .prepare(
          "INSERT INTO campaigns (id, event_id, name, code, token_hash, reporting_id, discount_kind, discount_value, starts_at, ends_at, max_redemptions, enabled, updated_at) VALUES ('promo', 'event', 'Full discount', 'FREE', 'promo-hash', 'promo-report', 'percentage', 10000, ?, ?, 2, 1, ?)"
        )
        .bind(f.now - 1, f.now + 3600000, f.now),
      f.db.prepare(
        "INSERT INTO campaign_ticket_types (campaign_id, ticket_type_id) VALUES ('promo', 'type')"
      ),
    ])
    const checkout = await startCheckout(
      f.db,
      "buyer",
      {
        requestId: "free-basket",
        eventId: "event",
        promoCode: "FREE",
        items: [
          {
            ticketTypeId: "type",
            quantity: 2,
            attendeeNames: ["First", "Second"],
          },
        ],
      },
      { now: () => f.now }
    )
    await completeZeroTotalOrder(
      f.env,
      "buyer",
      checkout.order.id,
      { requestId: "free-complete", expectedRevision: checkout.revision },
      { now: () => f.now }
    )
    return checkout.order.id
  }

  it("records approval and blocks admission before financial I/O, then returns the full amount and reverses the fee", async () => {
    const ticket = await paid()
    await grant("scanner", "ticket:scan")
    const credential = await recoverTicketCredential(
      ticket.id,
      ticket.credential_ciphertext,
      f.env.TICKET_ENCRYPTION_KEY
    )
    const request = await input()
    const approved = await approveOrderRefund(
      f.db,
      "owner",
      f.checkout.order.id,
      request
    )
    expect(
      await approveOrderRefund(f.db, "owner", f.checkout.order.id, request)
    ).toEqual(approved)
    expect(f.provider.refunds).toHaveLength(0)
    expect(
      (
        await scanOnline(f.db, "scanner", {
          eventId: "event",
          operationId: "pending-refund-scan",
          credential,
        })
      ).result
    ).toBe("admission_blocked")
    expect(
      await f.scalar(
        "SELECT count(*) n FROM inventory WHERE order_id = ?",
        f.checkout.order.id
      )
    ).toBe(1)
    expect(
      (await readOrderRefund(f.db, "owner", f.checkout.order.id)).refund
    ).toMatchObject({
      state: "pending",
      supportCaseId: caseId,
      requestedBy: "owner",
    })
    await processRefund(f.db, f.provider, approved.refundId)
    const result = await readOrderRefund(f.db, "buyer", f.checkout.order.id)
    expect(f.provider.refunds).toHaveLength(1)
    expect(f.provider.refunds[0]).toMatchObject({
      reason: "voluntary",
      amountMinor: 1000000,
      currency: "KZT",
    })
    expect(result).toMatchObject({
      orderState: "refunded",
      originalProcessingFeeMinor: 30000,
      remainingProcessingFeeMinor: 0,
      estimatedPayoutContributionMinor: 0,
    })
    expect(
      await f.scalar(
        "SELECT count(*) n FROM inventory WHERE order_id = ?",
        f.checkout.order.id
      )
    ).toBe(0)
    expect(await f.scalar("SELECT count(*) n FROM transition_guards")).toBe(0)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM audit_entries WHERE action = 'refund.approved'"
      )
    ).toBe(1)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM refunds r JOIN payment_attempts p ON p.id = r.payment_attempt_id WHERE p.purpose = 'event_activation'"
      )
    ).toBe(0)
    // Replayed success cannot reissue tickets after the refund.
    await processPayment(f.env, f.provider, f.paymentId)
    expect(
      await f.scalar("SELECT count(*) n FROM tickets WHERE state = 'refunded'")
    ).toBe(1)
  })

  it("refund permission is independent of support, scanning and event editing", async () => {
    await paid()
    const request = await input()
    await grant("support", "support:manage")
    await grant("scanner", "ticket:scan")
    await grant("editor", "event:manage")
    await grant("refunder", "refund:initiate")
    for (const actor of ["buyer", "support", "scanner", "editor"])
      await expect(
        approveOrderRefund(f.db, actor, f.checkout.order.id, request)
      ).rejects.toMatchObject({ status: 403 })
    await expect(
      readSupportCase(f.db, "refunder", caseId)
    ).rejects.toMatchObject({ status: 404 })
    const result = await approveOrderRefund(
      f.db,
      "refunder",
      f.checkout.order.id,
      request
    )
    expect(result.state).toBe("pending")
    await expect(
      readOrderRefund(f.db, "scanner", f.checkout.order.id)
    ).rejects.toMatchObject({ status: 404 })
  })

  it("rejects a resolved or mismatched case and rechecks resolution in the commit", async () => {
    await paid()
    const request = await input()
    await expect(
      approveOrderRefund(f.db, "owner", f.checkout.order.id, {
        ...request,
        caseId: "unknown-case",
      })
    ).rejects.toMatchObject({ code: "REFUND_INELIGIBLE" })
    await expect(
      approveOrderRefund(f.db, "owner", f.checkout.order.id, request, {
        beforeCommit: async () => {
          await changeSupportStatus(
            f.db,
            "owner",
            caseId,
            { requestId: "resolve", expectedRevision: 1, status: "resolved" },
            { now: () => f.now }
          )
        },
      })
    ).rejects.toMatchObject({ code: "REFUND_INELIGIBLE" })
    expect(await f.scalar("SELECT count(*) n FROM refunds")).toBe(0)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM orders WHERE admission_blocked_at IS NOT NULL"
      )
    ).toBe(0)
  })

  it.each(["permission", "event_start", "scan"] as const)(
    "rechecks %s changes before approving and leaves no partial refund",
    async (change) => {
      const ticket = await paid()
      await grant("refunder", "refund:initiate")
      await grant("scanner", "ticket:scan")
      const credential = await recoverTicketCredential(
        ticket.id,
        ticket.credential_ciphertext,
        f.env.TICKET_ENCRYPTION_KEY
      )
      const request = await input()
      await expect(
        approveOrderRefund(f.db, "refunder", f.checkout.order.id, request, {
          beforeCommit: async () => {
            if (change === "permission")
              await f.db
                .prepare(
                  "UPDATE event_permissions SET revoked_at = ? WHERE user_id = 'refunder'"
                )
                .bind(Date.now())
                .run()
            if (change === "event_start")
              await f.db
                .prepare("UPDATE events SET starts_at = ? WHERE id = 'event'")
                .bind(Date.now() - 1)
                .run()
            if (change === "scan")
              expect(
                (
                  await scanOnline(f.db, "scanner", {
                    eventId: "event",
                    operationId: "wins",
                    credential,
                  })
                ).result
              ).toBe("checked_in")
          },
        })
      ).rejects.toMatchObject({ status: change === "permission" ? 403 : 409 })
      expect(await f.scalar("SELECT count(*) n FROM refunds")).toBe(0)
      expect(
        await f.scalar(
          "SELECT count(*) n FROM outbox WHERE kind = 'refund.requested'"
        )
      ).toBe(0)
      expect(
        await f.scalar(
          "SELECT count(*) n FROM request_receipts WHERE request_id = 'approve'"
        )
      ).toBe(0)
    }
  )

  it("an authorized reversal removes the voluntary admission block without deleting history", async () => {
    const ticket = await paid()
    await grant("scanner", "ticket:scan")
    await grant("scanner", "checkin:reverse")
    const credential = await recoverTicketCredential(
      ticket.id,
      ticket.credential_ciphertext,
      f.env.TICKET_ENCRYPTION_KEY
    )
    const scanned = await scanOnline(f.db, "scanner", {
      eventId: "event",
      operationId: "scan",
      credential,
    })
    await expect(
      approveOrderRefund(f.db, "owner", f.checkout.order.id, await input())
    ).rejects.toMatchObject({ code: "REFUND_INELIGIBLE" })
    await reverseCheckIn(f.db, "scanner", "event", scanned.checkInId!, {
      requestId: "reverse",
      reason: "Accidental scan before the event",
    })
    expect(
      (
        await approveOrderRefund(
          f.db,
          "owner",
          f.checkout.order.id,
          await input()
        )
      ).state
    ).toBe("pending")
    expect(
      await f.scalar(
        "SELECT count(*) n FROM checkins WHERE reversed_at IS NOT NULL"
      )
    ).toBe(1)
  })

  it("competing approvals create one durable refund and keep its authorization immutable", async () => {
    await paid()
    const request = await input()
    const results = await Promise.allSettled([
      approveOrderRefund(f.db, "owner", f.checkout.order.id, request),
      approveOrderRefund(f.db, "owner", f.checkout.order.id, {
        ...request,
        requestId: "second-approval",
      }),
    ])
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(await f.scalar("SELECT count(*) n FROM refunds")).toBe(1)
    await expect(
      f.db.prepare("UPDATE refunds SET requested_by = 'buyer'").run()
    ).rejects.toThrow(/refund_authorization_immutable/)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM audit_entries WHERE action = 'refund.approved'"
      )
    ).toBe(1)
  })

  it.each([
    "UPDATE events SET publication_state = 'unpublished' WHERE id = 'event'",
    "UPDATE events SET paid_sales_state = 'suspended' WHERE id = 'event'",
    "UPDATE event_activations SET identity_check = 'failed', revision = revision + 1 WHERE event_id = 'event'",
    "INSERT INTO profiles (user_id, suspended_at, updated_at) VALUES ('owner', 1, 1)",
    "UPDATE ticket_types SET hidden = 1 WHERE id = 'type'",
    "UPDATE ticket_types SET sales_start_at = 0, sales_end_at = 1 WHERE id = 'type'",
    "UPDATE inventory SET enabled = 0 WHERE order_id IS NOT NULL",
  ])(
    "retains refunded inventory after sales eligibility changes: %s",
    async (sql) => {
      await paid()
      const result = await approveOrderRefund(
        f.db,
        "owner",
        f.checkout.order.id,
        await input()
      )
      await f.db.prepare(sql).run()
      await processRefund(f.db, f.provider, result.refundId)
      expect(
        await f.scalar(
          "SELECT count(*) n FROM refunds WHERE state = 'succeeded'"
        )
      ).toBe(1)
      expect(
        await f.scalar(
          "SELECT count(*) n FROM inventory WHERE order_id = ?",
          f.checkout.order.id
        )
      ).toBe(1)
      expect(await f.scalar("SELECT count(*) n FROM transition_guards")).toBe(0)
    }
  )

  it("a provider rejection keeps the failed refund, approval history, tickets blocked and inventory reserved", async () => {
    await paid()
    const result = await approveOrderRefund(
      f.db,
      "owner",
      f.checkout.order.id,
      await input()
    )
    f.provider.refundOutcome = "definite_failure"
    await processRefund(f.db, f.provider, result.refundId)
    await processRefund(f.db, f.provider, result.refundId)
    expect(f.provider.refunds).toHaveLength(1)
    const current = await readOrderRefund(f.db, "buyer", f.checkout.order.id)
    expect(current).toMatchObject({
      admissionBlocked: true,
      payoutHeld: true,
      refund: { state: "failed", reconciliationRequired: true },
    })
    expect(
      await f.scalar(
        "SELECT count(*) n FROM inventory WHERE order_id = ?",
        f.checkout.order.id
      )
    ).toBe(1)
    await expect(
      approveOrderRefund(f.db, "owner", f.checkout.order.id, {
        ...(await input()),
        requestId: "retry-as-new",
      })
    ).rejects.toMatchObject({ code: "REFUND_INELIGIBLE" })
  })

  it("cancels zero-total registration without provider I/O while retaining consumed promo attribution", async () => {
    const orderId = await zero()
    const { caseId: _case, ...request } = await input(orderId)
    const response = await cancelFreeRegistration(
      f.db,
      "owner",
      orderId,
      request
    )
    expect(
      await cancelFreeRegistration(f.db, "owner", orderId, request)
    ).toEqual(response)
    expect(f.provider.refunds).toHaveLength(0)
    expect(await f.scalar("SELECT count(*) n FROM refunds")).toBe(0)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM tickets WHERE order_id = ? AND state = 'cancelled'",
        orderId
      )
    ).toBe(2)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM inventory WHERE order_id = ?",
        orderId
      )
    ).toBe(0)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM promo_allocations WHERE order_id = ? AND committed_at IS NOT NULL AND released_at IS NULL",
        orderId
      )
    ).toBe(1)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM audit_entries WHERE action = 'registration.cancelled'"
      )
    ).toBe(1)
  })

  it("free cancellation has the same cutoff and admission rule and cannot cancel a paid order", async () => {
    await paid()
    const { caseId: _case, ...request } = await input()
    await expect(
      cancelFreeRegistration(f.db, "owner", f.checkout.order.id, request)
    ).rejects.toMatchObject({ code: "REFUND_INELIGIBLE" })
  })

  it.each(["event_start", "admission", "activation"] as const)(
    "free registration handles current %s changes",
    async (change) => {
      const orderId = await zero()
      const { caseId: _case, ...request } = await input(orderId)
      if (change === "event_start")
        await f.db
          .prepare("UPDATE events SET starts_at = ? WHERE id = 'event'")
          .bind(Date.now() - 1)
          .run()
      if (change === "admission") {
        await grant("scanner", "ticket:scan")
        const ticket = (await f.db
          .prepare(
            "SELECT id, credential_ciphertext FROM tickets WHERE order_id = ? LIMIT 1"
          )
          .bind(orderId)
          .first<{ id: string; credential_ciphertext: string }>())!
        const credential = await recoverTicketCredential(
          ticket.id,
          ticket.credential_ciphertext,
          f.env.TICKET_ENCRYPTION_KEY
        )
        await scanOnline(f.db, "scanner", {
          eventId: "event",
          operationId: "free-scan",
          credential,
        })
      }
      if (change === "activation") {
        await f.db
          .prepare(
            "UPDATE event_activations SET identity_check = 'failed', revision = revision + 1 WHERE event_id = 'event'"
          )
          .run()
        expect(
          (await cancelFreeRegistration(f.db, "owner", orderId, request)).state
        ).toBe("cancelled")
      } else {
        await expect(
          cancelFreeRegistration(f.db, "owner", orderId, request)
        ).rejects.toMatchObject({ code: "REFUND_INELIGIBLE" })
        expect(
          await f.scalar(
            "SELECT count(*) n FROM orders WHERE id = ? AND state = 'completed' AND admission_blocked_at IS NULL",
            orderId
          )
        ).toBe(1)
      }
      expect(
        await f.scalar(
          "SELECT count(*) n FROM inventory WHERE order_id = ?",
          orderId
        )
      ).toBe(2)
    }
  )
})
