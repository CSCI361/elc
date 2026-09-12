import {
  ProviderOperationError,
  type PaymentAdapter,
  type PaymentBinding,
  type PaymentCheckoutRequest,
  type PaymentLookupRequest,
  type ProviderCheckout,
  type ProviderPaymentStatus,
  type ProviderRefundRequest,
  type ProviderRefundStatus,
} from "@elc/shared"
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { createAuthTestDatabase } from "../auth/test-database"
import { startCheckout, replaceCheckout } from "../orders/checkout"
import {
  abandonCheckout,
  expireReservations,
  readCheckout,
} from "../orders/lifecycle"
import { startOrderPayment } from "./checkout"
import { processPayment, recordPaymentStatus } from "./reconcile"
import { applyRefundStatus, ensureCompensation, processRefund } from "./refunds"
import { loadPayment } from "./store"

/** Captures financial calls while every application transition uses real D1. */
class RecordedProvider implements PaymentAdapter {
  creates: PaymentCheckoutRequest[] = []
  recoveries: PaymentCheckoutRequest[] = []
  lookups: PaymentLookupRequest[] = []
  refunds: ProviderRefundRequest[] = []
  refundLookups: ProviderRefundRequest[] = []
  createOutcome: "success" | "uncertain" | "definite_failure" = "success"
  refundOutcome: "success" | "uncertain" | "definite_failure" = "success"
  recoverVisible = true
  refundVisible = true
  state: ProviderPaymentStatus["state"] = "pending"
  refundedAmount = 0
  overrideStatus: Partial<ProviderPaymentStatus> = {}
  onCreate?: (request: PaymentCheckoutRequest) => Promise<void>
  private checkouts = new Map<string, ProviderCheckout>()
  private refundResults = new Map<string, ProviderRefundStatus>()

  async createCheckout(request: PaymentCheckoutRequest) {
    this.creates.push(structuredClone(request))
    await this.onCreate?.(request)
    if (this.createOutcome === "definite_failure")
      throw new ProviderOperationError(
        "PROVIDER_REJECTED",
        "definite_failure",
        "Synthetic rejection"
      )
    const result = {
      providerPaymentId: `checkout-${request.paymentAttemptId}`,
      checkoutUrl: `https://sandbox.example.test/checkout/${request.paymentAttemptId}`,
    }
    this.checkouts.set(request.paymentAttemptId, result)
    if (this.createOutcome === "uncertain")
      throw new ProviderOperationError(
        "PROVIDER_UNAVAILABLE",
        "uncertain",
        "Synthetic lost create response"
      )
    return result
  }

  async recoverCheckout(request: PaymentCheckoutRequest) {
    this.recoveries.push(structuredClone(request))
    return this.recoverVisible
      ? (this.checkouts.get(request.paymentAttemptId) ?? null)
      : null
  }

  status(expected: PaymentBinding): ProviderPaymentStatus {
    return {
      ...expected,
      providerPaymentId: `checkout-${expected.paymentAttemptId}`,
      providerOrderId:
        this.state === "succeeded"
          ? `order-${expected.paymentAttemptId}`
          : null,
      state: this.state,
      refundedAmountMinor: this.refundedAmount,
      ...this.overrideStatus,
    }
  }

  async lookupPayment(request: PaymentLookupRequest) {
    this.lookups.push(structuredClone(request))
    const status = this.status(request.expected)
    return {
      ...status,
      providerOrderId: request.providerOrderId ?? status.providerOrderId,
    }
  }

  async refund(request: ProviderRefundRequest) {
    this.refunds.push(structuredClone(request))
    if (this.refundOutcome === "definite_failure")
      throw new ProviderOperationError(
        "PROVIDER_REJECTED",
        "definite_failure",
        "Synthetic refund rejection"
      )
    const result: ProviderRefundStatus = {
      ...request.expected,
      providerPaymentId: request.providerPaymentId,
      providerOrderId: request.providerOrderId,
      refundId: request.refundId,
      providerRefundId: `refund-${request.refundId}`,
      state: "succeeded",
    }
    this.refundResults.set(request.refundId, result)
    this.refundedAmount = request.amountMinor
    if (this.refundOutcome === "uncertain")
      throw new ProviderOperationError(
        "PROVIDER_UNAVAILABLE",
        "uncertain",
        "Synthetic lost refund response"
      )
    return result
  }

  async lookupRefund(request: ProviderRefundRequest) {
    this.refundLookups.push(structuredClone(request))
    return this.refundVisible
      ? (this.refundResults.get(request.refundId) ?? null)
      : null
  }

  async verifyWebhook() {
    return null
  }
}

describe("D1 payment orchestration and compensation", () => {
  let fixture: Awaited<ReturnType<typeof createAuthTestDatabase>>
  let db: D1Database
  let provider: RecordedProvider
  let now: number
  const clock = () => now
  const dependencies = { now: clock }
  const env = () => ({
    DB: db,
    APP_ORIGIN: "http://localhost:5173",
    TICKET_ENCRYPTION_KEY: "A".repeat(43),
  })
  const basket = (requestId = "basket", quantity = 1) => ({
    requestId,
    eventId: "event",
    items: [
      {
        ticketTypeId: "type",
        quantity,
        attendeeNames: Array.from(
          { length: quantity },
          (_, i) => `Guest ${i + 1}`
        ),
      },
    ],
  })
  const paymentInput = { requestId: "payment", expectedRevision: 0 }
  const scalar = (sql: string, ...values: unknown[]) =>
    db
      .prepare(sql)
      .bind(...values)
      .first<number>("n")

  beforeEach(async () => {
    fixture = await createAuthTestDatabase()
    db = fixture.DB
    provider = new RecordedProvider()
    now = Date.now()
    for (const id of ["owner", "buyer", "other"])
      await db
        .prepare(
          "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
        )
        .bind(id, id, `${id}@example.test`, now, now)
        .run()
    await db
      .prepare(`INSERT INTO events (id, organizer_id, title, description, category, venue_name, venue_address,
      starts_at, ends_at, registration_opens_at, registration_closes_at, capacity, max_tickets_per_order,
      publication_state, paid_sales_state, calendar_uid, reporting_id, created_at, updated_at)
      VALUES ('event', 'owner', 'Payment fixture', 'Description', 'Music', 'Hall', 'Address', ?, ?, ?, ?, 4, 4, 'published', 'active', 'calendar', 'report', ?, ?)`)
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
        "INSERT INTO ticket_types (id, event_id, name, kind, price_minor, quantity, sales_start_at, sales_end_at, updated_at) VALUES ('type', 'event', 'Admission', 'paid', 1000000, 4, ?, ?, ?)"
      )
      .bind(now - 3600000, now + 3600000, now)
      .run()
    for (let index = 0; index < 4; index++)
      await db
        .prepare(
          "INSERT INTO inventory (id, event_id, ticket_type_id) VALUES (?, 'event', 'type')"
        )
        .bind(`slot-${index}`)
        .run()
  })

  afterEach(async () => {
    await fixture?.runtime.dispose()
  })

  async function start() {
    const checkout = await startCheckout(db, "buyer", basket(), dependencies)
    const response = await startOrderPayment(
      env(),
      provider,
      "buyer",
      checkout.order.id,
      paymentInput,
      dependencies
    )
    return { checkout, paymentId: response.payment.id, response }
  }

  function binding() {
    const request = provider.creates[0]
    if (!request) throw new Error("Missing synthetic provider request")
    const {
      paymentAttemptId,
      purpose,
      subjectId,
      accountId,
      requestHash,
      amountMinor,
      currency,
    } = request
    return {
      paymentAttemptId,
      purpose,
      subjectId,
      accountId,
      requestHash,
      amountMinor,
      currency,
    }
  }

  it("creates one provider checkout for simultaneous repeated requests, freezes its basket and completes one canonical paid order", async () => {
    const checkout = await startCheckout(db, "buyer", basket(), dependencies)
    const responses = await Promise.all(
      [1, 2, 3].map(() =>
        startOrderPayment(
          env(),
          provider,
          "buyer",
          checkout.order.id,
          paymentInput,
          dependencies
        )
      )
    )
    expect(new Set(responses.map((result) => result.payment.id)).size).toBe(1)
    expect(provider.creates).toHaveLength(1)
    const paymentId = responses[0]!.payment.id
    expect(await scalar("SELECT count(*) AS n FROM payment_attempts")).toBe(1)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM audit_entries WHERE action = 'payment.prepared'"
      )
    ).toBe(1)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM outbox WHERE kind = 'payment.reconcile'"
      )
    ).toBe(1)
    await expect(
      replaceCheckout(
        db,
        "buyer",
        checkout.order.id,
        { ...basket("replace", 2), expectedRevision: 0 },
        dependencies
      )
    ).rejects.toMatchObject({ code: "CHECKOUT_FROZEN" })
    await expect(
      startOrderPayment(
        env(),
        provider,
        "buyer",
        checkout.order.id,
        { requestId: "different", expectedRevision: 0 },
        dependencies
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
    provider.state = "succeeded"
    expect(
      await Promise.all(
        [1, 2].map(() =>
          processPayment(env(), provider, paymentId, dependencies)
        )
      )
    ).toEqual([true, true])
    const current = await readCheckout(db, "buyer", checkout.order.id, now)
    expect(current.order.state).toBe("completed")
    expect(current.order.processingFeeMinor).toBe(30000)
    expect(await scalar("SELECT count(*) AS n FROM tickets")).toBe(1)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM outbox WHERE kind = 'order.completed'"
      )
    ).toBe(1)
    expect(provider.refunds).toHaveLength(0)
    expect(await scalar("SELECT count(*) AS n FROM transition_guards")).toBe(0)
  })

  it("rolls payment preparation, audit, receipt and outbox back when eligibility changes before commit", async () => {
    const checkout = await startCheckout(db, "buyer", basket(), dependencies)
    await expect(
      startOrderPayment(
        env(),
        provider,
        "buyer",
        checkout.order.id,
        paymentInput,
        {
          now: clock,
          beforeCommit: async () => {
            await db
              .prepare(
                "UPDATE events SET publication_state = 'unpublished' WHERE id = 'event'"
              )
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(provider.creates).toHaveLength(0)
    expect(await scalar("SELECT count(*) AS n FROM payment_attempts")).toBe(0)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM outbox WHERE kind = 'payment.reconcile'"
      )
    ).toBe(0)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM audit_entries WHERE action = 'payment.prepared'"
      )
    ).toBe(0)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM request_receipts WHERE request_id = 'payment'"
      )
    ).toBe(0)
    expect(
      await db
        .prepare("SELECT payment_attempt_id FROM reservations WHERE id = ?")
        .bind(checkout.reservation.id)
        .first("payment_attempt_id")
    ).toBeNull()
  })

  it("recovers an uncertain checkout by GET and never repeats the financial POST", async () => {
    provider.createOutcome = "uncertain"
    provider.recoverVisible = false
    const { paymentId, response } = await start()
    expect(response.payment.dispatchState).toBe("uncertain")
    expect(await processPayment(env(), provider, paymentId, dependencies)).toBe(
      false
    )
    expect(provider.creates).toHaveLength(1)
    expect(provider.recoveries).toHaveLength(1)
    provider.recoverVisible = true
    expect(await processPayment(env(), provider, paymentId, dependencies)).toBe(
      false
    )
    provider.state = "succeeded"
    expect(await processPayment(env(), provider, paymentId, dependencies)).toBe(
      true
    )
    expect(provider.creates).toHaveLength(1)
    expect(provider.recoveries).toHaveLength(2)
    expect(await scalar("SELECT count(*) AS n FROM tickets")).toBe(1)
  })

  it("records a definite provider rejection once and does not retry its POST", async () => {
    provider.createOutcome = "definite_failure"
    const { paymentId, response } = await start()
    expect(response.payment.state).toBe("failed")
    expect(await processPayment(env(), provider, paymentId, dependencies)).toBe(
      true
    )
    expect(provider.creates).toHaveLength(1)
    expect(provider.recoveries).toHaveLength(0)
    expect(await scalar("SELECT count(*) AS n FROM tickets")).toBe(0)
  })

  it.each(["expired", "abandoned", "cancelled"])(
    "records late success after %s, refunds it fully and leaves a readable unfulfilled order",
    async (reason) => {
      const { checkout, paymentId } = await start()
      if (reason === "expired") {
        now += 600001
        await expireReservations(db, "event", now)
      } else if (reason === "abandoned")
        await abandonCheckout(
          db,
          "buyer",
          checkout.order.id,
          { requestId: "abandon", expectedRevision: 0 },
          now
        )
      else
        await db
          .prepare("UPDATE events SET cancelled_at = ? WHERE id = 'event'")
          .bind(now)
          .run()
      provider.state = "succeeded"
      expect(
        await processPayment(env(), provider, paymentId, dependencies)
      ).toBe(true)
      expect((await loadPayment(db, paymentId)).state).toBe("succeeded")
      expect(provider.refunds).toHaveLength(1)
      expect(provider.refunds[0]?.amountMinor).toBe(checkout.order.totalMinor)
      expect(await scalar("SELECT count(*) AS n FROM tickets")).toBe(0)
      expect(
        await scalar(
          "SELECT count(*) AS n FROM inventory WHERE reservation_id IS NOT NULL OR order_id IS NOT NULL"
        )
      ).toBe(0)
      const current = await readCheckout(db, "buyer", checkout.order.id, now)
      expect(current.order.completedAt).toBeNull()
      expect(["expired", "abandoned", "cancelled"]).toContain(
        current.order.state
      )
      expect(
        await scalar(
          "SELECT count(*) AS n FROM refunds WHERE state = 'succeeded'"
        )
      ).toBe(1)
      expect(
        await scalar(
          "SELECT count(*) AS n FROM outbox WHERE kind = 'refund.reconcile'"
        )
      ).toBe(1)
      expect(
        await processPayment(env(), provider, paymentId, dependencies)
      ).toBe(true)
      expect(provider.refunds).toHaveLength(1)
    }
  )

  it("recovers an uncertain refund by lookup without issuing another refund POST", async () => {
    const { checkout, paymentId } = await start()
    await abandonCheckout(
      db,
      "buyer",
      checkout.order.id,
      { requestId: "abandon", expectedRevision: 0 },
      now
    )
    provider.state = "succeeded"
    provider.refundOutcome = "uncertain"
    provider.refundVisible = false
    expect(await processPayment(env(), provider, paymentId, dependencies)).toBe(
      false
    )
    expect(provider.refunds).toHaveLength(1)
    expect(await processPayment(env(), provider, paymentId, dependencies)).toBe(
      false
    )
    expect(provider.refundLookups).toHaveLength(1)
    provider.refundVisible = true
    expect(await processPayment(env(), provider, paymentId, dependencies)).toBe(
      true
    )
    expect(provider.refunds).toHaveLength(1)
    expect(provider.refundLookups).toHaveLength(2)
    expect((await loadPayment(db, paymentId)).state).toBe("succeeded")
    expect(await scalar("SELECT count(*) AS n FROM tickets")).toBe(0)
  })

  it.each([
    "amountMinor",
    "subjectId",
    "accountId",
    "requestHash",
    "providerPaymentId",
  ])(
    "fails closed on mismatched %s without recording success or issuing tickets",
    async (field) => {
      const { paymentId } = await start()
      provider.state = "succeeded"
      const invalid = {
        ...provider.status(binding()),
        [field]:
          field === "amountMinor"
            ? 1000001
            : field === "requestHash"
              ? "f".repeat(64)
              : "wrong",
      }
      await expect(recordPaymentStatus(db, invalid, now)).rejects.toMatchObject(
        { code: "PAYMENT_MISMATCH" }
      )
      expect((await loadPayment(db, paymentId)).state).toBe("pending")
      expect(await scalar("SELECT count(*) AS n FROM tickets")).toBe(0)
      expect(
        await scalar(
          "SELECT count(*) AS n FROM audit_entries WHERE action = 'payment.succeeded'"
        )
      ).toBe(0)
      expect(
        await scalar(
          "SELECT count(*) AS n FROM request_receipts WHERE actor_id = 'system:payment-fact'"
        )
      ).toBe(1)
    }
  )

  it("deduplicates and reorders financial facts without reopening a completed or refunded order", async () => {
    const { checkout, paymentId } = await start()
    provider.state = "succeeded"
    await processPayment(env(), provider, paymentId, dependencies)
    const payment = await loadPayment(db, paymentId)
    const success = provider.status(binding())
    await Promise.all([
      recordPaymentStatus(db, success, now),
      recordPaymentStatus(db, success, now),
    ])
    await recordPaymentStatus(db, { ...success, state: "failed" }, now + 1)
    expect((await loadPayment(db, paymentId)).succeeded_at).toBe(
      payment.succeeded_at
    )
    expect((await loadPayment(db, paymentId)).state).toBe("succeeded")
    expect(
      await scalar(
        "SELECT count(*) AS n FROM audit_entries WHERE action = 'payment.succeeded'"
      )
    ).toBe(1)
    expect(await scalar("SELECT count(*) AS n FROM tickets")).toBe(1)
    const refundId = crypto.randomUUID()
    await db
      .prepare(
        "INSERT INTO refunds (id, payment_attempt_id, reason, amount_minor, created_at) VALUES (?, ?, 'event_cancelled', ?, ?)"
      )
      .bind(refundId, paymentId, payment.amount_minor, now)
      .run()
    const refundStatus: ProviderRefundStatus = {
      ...binding(),
      providerPaymentId: success.providerPaymentId,
      providerOrderId: success.providerOrderId!,
      providerRefundId: `refund-${refundId}`,
      refundId,
      state: "succeeded",
    }
    await applyRefundStatus(db, refundStatus, now)
    await applyRefundStatus(db, { ...refundStatus, state: "pending" }, now + 1)
    await recordPaymentStatus(db, success, now + 1)
    await processPayment(env(), provider, paymentId, dependencies)
    expect(
      (await readCheckout(db, "buyer", checkout.order.id, now)).order.state
    ).toBe("refunded")
    expect(
      await scalar("SELECT count(*) AS n FROM tickets WHERE state = 'valid'")
    ).toBe(0)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM outbox WHERE kind = 'order.completed'"
      )
    ).toBe(1)
    expect(provider.refunds).toHaveLength(0)
  })

  it("blocks fulfillment on provider-reported refunded funds without blindly creating a new refund", async () => {
    const { checkout, paymentId } = await start()
    provider.state = "succeeded"
    provider.refundedAmount = checkout.order.totalMinor
    expect(await processPayment(env(), provider, paymentId, dependencies)).toBe(
      false
    )
    expect((await loadPayment(db, paymentId)).state).toBe("succeeded")
    expect(provider.refunds).toHaveLength(0)
    expect(await scalar("SELECT count(*) AS n FROM tickets")).toBe(0)
    expect(
      await db
        .prepare("SELECT admission_blocked_at FROM orders WHERE id = ?")
        .bind(checkout.order.id)
        .first("admission_blocked_at")
    ).not.toBeNull()
  })

  it("never creates technical compensation after a competing finalizer has already fulfilled the order", async () => {
    const { paymentId } = await start()
    provider.state = "succeeded"
    await processPayment(env(), provider, paymentId, dependencies)
    await expect(
      ensureCompensation(db, await loadPayment(db, paymentId), now)
    ).rejects.toMatchObject({ status: 409 })
    expect(await scalar("SELECT count(*) AS n FROM refunds")).toBe(0)
    expect(
      await scalar("SELECT count(*) AS n FROM tickets WHERE state = 'valid'")
    ).toBe(1)
  })

  it("uses the supplied reconciliation clock when recording a recovered refund", async () => {
    const { checkout, paymentId } = await start()
    await abandonCheckout(
      db,
      "buyer",
      checkout.order.id,
      { requestId: "abandon", expectedRevision: 0 },
      now
    )
    provider.state = "succeeded"
    await recordPaymentStatus(db, provider.status(binding()), now)
    const refundId = await ensureCompensation(
      db,
      await loadPayment(db, paymentId),
      now
    )
    const expectedTime = now + 123456
    await processRefund(db, provider, refundId, expectedTime)
    expect(
      await db
        .prepare("SELECT confirmed_at FROM refunds WHERE id = ?")
        .bind(refundId)
        .first("confirmed_at")
    ).toBe(expectedTime)
  })
})
