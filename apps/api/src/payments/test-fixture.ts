import {
  ProviderOperationError,
  verifiedProviderEventSchema,
  type PaymentAdapter,
  type PaymentBinding,
  type PaymentCheckoutRequest,
  type PaymentLookupRequest,
  type ProviderCheckout,
  type ProviderPaymentStatus,
  type ProviderRefundRequest,
  type ProviderRefundStatus,
} from "@elc/shared"
import { createAuthTestDatabase } from "../auth/test-database"
import { startCheckout } from "../orders/checkout"
import { startOrderPayment } from "./checkout"
import { loadPayment, paymentBinding } from "./store"

/** Captures financial calls while every application transition uses real D1. */
export class RecordedProvider implements PaymentAdapter {
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

  async verifyWebhook(body: string, headers: Readonly<Record<string, string>>) {
    if (headers["fixture-signature"] !== "verified")
      throw new ProviderOperationError(
        "INVALID_WEBHOOK",
        "definite_failure",
        "Synthetic signature rejection"
      )
    if (body === "ignored") return null
    return verifiedProviderEventSchema.parse(JSON.parse(body))
  }
}

export async function createPaymentFixture() {
  const fixture = await createAuthTestDatabase()
  const db = fixture.DB
  const provider = new RecordedProvider()
  const now = Date.now()
  const env = {
    DB: db,
    APP_ORIGIN: "http://localhost:5173",
    TICKET_ENCRYPTION_KEY: "A".repeat(43),
  }
  try {
    for (const id of ["owner", "buyer"])
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
      VALUES ('event', 'owner', 'Webhook fixture', 'Description', 'Music', 'Hall', 'Address', ?, ?, ?, ?, 4, 4, 'published', 'active', 'calendar', 'report', ?, ?)`)
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
    const checkout = await startCheckout(
      db,
      "buyer",
      {
        requestId: "basket",
        eventId: "event",
        items: [
          { ticketTypeId: "type", quantity: 1, attendeeNames: ["Guest"] },
        ],
      },
      { now: () => now }
    )
    const response = await startOrderPayment(
      env,
      provider,
      "buyer",
      checkout.order.id,
      { requestId: "payment", expectedRevision: 0 },
      { now: () => now }
    )
    const payment = await loadPayment(db, response.payment.id)
    return {
      ...fixture,
      db,
      env,
      provider,
      now,
      checkout,
      paymentId: payment.id,
      binding: paymentBinding(payment),
      paymentOutboxId: `payment-reconcile:${payment.id}`,
      scalar: (sql: string, ...values: unknown[]) =>
        db
          .prepare(sql)
          .bind(...values)
          .first<number>("n"),
    }
  } catch (error) {
    await fixture.runtime.dispose()
    throw error
  }
}
