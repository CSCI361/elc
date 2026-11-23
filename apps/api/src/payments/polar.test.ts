import {
  PolarClientError,
  PolarNetworkError,
  PolarRateLimitError,
  PolarServerError,
} from "@polar-sh/sdk"
import { afterEach, describe, expect, it, vi } from "vite-plus/test"
import {
  type PaymentBinding,
  type PaymentCheckoutRequest,
  type ProviderRefundRequest,
} from "@elc/shared"
import {
  checkoutEmailPrefill,
  createPolarSandboxAdapter,
  type PolarTransport,
} from "./polar"

const checkoutId = "00000000-0000-4000-8000-000000000001"
const orderId = "00000000-0000-4000-8000-000000000002"
const refundId = "00000000-0000-4000-8000-000000000003"
const productId = "66720b47-54e1-453f-91a1-58f6a35cbd30"
const organizationId = "00000000-0000-4000-8000-000000000004"
const secret = `whsec_${Buffer.from("test-webhook-secret-with-32-bytes!").toString("base64")}`
const env = {
  POLAR_ACCESS_TOKEN: "test-only-token",
  POLAR_PRODUCT_ID: productId,
  POLAR_ORGANIZATION_ID: organizationId,
  POLAR_WEBHOOK_SECRET: secret,
  APP_ORIGIN: "https://app.example.test",
  ENVIRONMENT: "preview" as const,
}
const binding: PaymentBinding = {
  paymentAttemptId: "attempt-1",
  purpose: "ticket_order",
  subjectId: "elc-order-1",
  accountId: "account-1",
  requestHash: "a".repeat(64),
  amountMinor: 900_000,
  currency: "KZT",
}
const request: PaymentCheckoutRequest = {
  ...binding,
  idempotencyKey: "attempt-1",
  customerEmail: "buyer@example.test",
  successUrl: `${env.APP_ORIGIN}/payments/return?checkout_id={CHECKOUT_ID}`,
  returnUrl: `${env.APP_ORIGIN}/orders/elc-order-1`,
}
const refundRequest: ProviderRefundRequest = {
  refundId: "elc-refund-1",
  providerPaymentId: checkoutId,
  providerOrderId: orderId,
  idempotencyKey: "elc-refund-1",
  expected: binding,
  amountMinor: 900_000,
  currency: "KZT",
  reason: "voluntary",
}
const metadata = {
  elc_attempt_id: binding.paymentAttemptId,
  elc_purpose: binding.purpose,
  elc_subject_id: binding.subjectId,
  elc_account_id: binding.accountId,
  elc_request_hash: binding.requestHash,
  elc_amount_minor: binding.amountMinor,
  elc_currency: binding.currency,
  elc_environment: env.ENVIRONMENT,
}
const checkout = {
  id: checkoutId,
  url: `https://sandbox.polar.sh/checkout/test-token`,
  status: "open",
  organization_id: organizationId,
  product_id: productId,
  currency: "kzt",
  total_amount: 900_000,
  discount_amount: 0,
  tax_behavior: "inclusive",
  external_customer_id: binding.accountId,
  metadata,
}
const order = {
  id: orderId,
  checkout_id: checkoutId,
  product_id: productId,
  product: { id: productId, organization_id: organizationId },
  customer: { external_id: binding.accountId },
  status: "paid",
  paid: true,
  currency: "kzt",
  total_amount: 900_000,
  net_amount: 750_000,
  tax_amount: 150_000,
  discount_amount: 0,
  applied_balance_amount: 0,
  due_amount: 900_000,
  refunded_amount: 0,
  refunded_tax_amount: 0,
  refundable_amount: 750_000,
  refundable_tax_amount: 150_000,
  metadata,
}
const refund = {
  id: refundId,
  order_id: orderId,
  organization_id: organizationId,
  status: "pending",
  currency: "kzt",
  amount: 750_000,
  tax_amount: 150_000,
  metadata: {
    ...metadata,
    elc_refund_id: refundRequest.refundId,
    elc_checkout_id: checkoutId,
    elc_order_id: orderId,
  },
}
const page = (items: unknown[], maxPage = 1, totalCount = items.length) => ({
  items,
  pagination: { max_page: maxPage, total_count: totalCount },
})

function harness() {
  const calls = {
    createCheckout: vi.fn<PolarTransport["checkouts"]["create"]>(async () =>
      structuredClone(checkout)
    ),
    getCheckout: vi.fn<PolarTransport["checkouts"]["get"]>(async () =>
      structuredClone(checkout)
    ),
    listCheckouts: vi.fn<PolarTransport["checkouts"]["list"]>(async () =>
      page([])
    ),
    getOrder: vi.fn<PolarTransport["orders"]["get"]>(async () =>
      structuredClone(order)
    ),
    listOrders: vi.fn<PolarTransport["orders"]["list"]>(async () =>
      page([structuredClone(order)])
    ),
    createRefund: vi.fn<PolarTransport["refunds"]["create"]>(async () =>
      structuredClone(refund)
    ),
    listRefunds: vi.fn<PolarTransport["refunds"]["list"]>(async () => page([])),
  }
  const transport: PolarTransport = {
    checkouts: {
      create: calls.createCheckout,
      get: calls.getCheckout,
      list: calls.listCheckouts,
    },
    orders: { get: calls.getOrder, list: calls.listOrders },
    refunds: { create: calls.createRefund, list: calls.listRefunds },
  }
  return {
    calls,
    transport,
    adapter: createPolarSandboxAdapter(env, { transport }),
  }
}

async function signed(
  value: unknown,
  options: { encoding?: "legacy" | "standard"; timestamp?: number } = {}
) {
  const body = JSON.stringify(value)
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000)
  const id = "delivery-1"
  const keyBytes =
    options.encoding === "standard"
      ? Buffer.from(secret.slice(6), "base64")
      : Buffer.from(secret)
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`)
  )
  return {
    body,
    headers: {
      "webhook-id": id,
      "webhook-timestamp": String(timestamp),
      "webhook-signature": `v1,${Buffer.from(signature).toString("base64")}`,
    },
  }
}
const envelope = (type: string, data: unknown) => ({
  type,
  data,
  api_version: "2026-04",
  timestamp: new Date().toISOString(),
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Polar sandbox checkout adapter", () => {
  it("uses a single inclusive-tax ad-hoc KZT price with immutable server correlation", async () => {
    const { adapter, calls } = harness()
    expect(await adapter.createCheckout(request)).toEqual({
      providerPaymentId: checkoutId,
      checkoutUrl: checkout.url,
    })
    expect(calls.createCheckout).toHaveBeenCalledExactlyOnceWith({
      products: [productId],
      prices: {
        [productId]: [
          {
            amount_type: "fixed",
            price_currency: "kzt",
            price_amount: 900_000,
            tax_behavior: "inclusive",
          },
        ],
      },
      currency: "kzt",
      allow_discount_codes: false,
      allow_trial: false,
      external_customer_id: binding.accountId,
      metadata,
      success_url: request.successUrl,
      return_url: request.returnUrl,
    })
    const body = calls.createCheckout.mock.calls[0]?.[0]
    expect(body).not.toHaveProperty("amount")
    // Polar rejects the reserved `.test` domain, so the buyer enters an email at checkout.
    expect(body).not.toHaveProperty("customer_email")
  })

  it("prefills a deliverable buyer email at checkout", async () => {
    const { adapter, calls } = harness()
    await adapter.createCheckout({
      ...request,
      customerEmail: "buyer@nu.edu.kz",
    })
    expect(calls.createCheckout.mock.calls[0]?.[0]).toMatchObject({
      customer_email: "buyer@nu.edu.kz",
    })
  })

  it.each([
    "buyer@example.test",
    "buyer@EXAMPLE.TEST",
    "buyer@example.test.",
    "buyer@host.invalid",
    "buyer@localhost",
    "buyer@printer.local",
    "buyer@site.onion",
    "buyer@in-addr.arpa",
  ])("omits the special-use address %s from the checkout", (email) => {
    expect(checkoutEmailPrefill(email)).toEqual({})
  })

  it("keeps ordinary domains that only contain a reserved word", () => {
    expect(checkoutEmailPrefill("qa@test.kz")).toEqual({
      customer_email: "qa@test.kz",
    })
    expect(checkoutEmailPrefill("dev@localhost.example.com")).toEqual({
      customer_email: "dev@localhost.example.com",
    })
  })

  it("uses the actual versioned SDK against the sandbox origin without POST retries", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(checkout), { status: 201 })
    )
    vi.stubGlobal("fetch", fetcher)
    const adapter = createPolarSandboxAdapter(env)
    await adapter.createCheckout(request)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, options] = fetcher.mock.calls[0]!
    expect(url).toBe("https://sandbox-api.polar.sh/v1/checkouts/")
    expect(new Headers(options?.headers).get("Polar-Version")).toBe("2026-04")
    expect(new Headers(options?.headers).get("User-Agent")).toBe(
      "elc-sandbox-acceptance/1.0"
    )
    expect(options?.method).toBe("POST")
  })

  it("rejects unconfigured sandbox identifiers, unsupported totals, and foreign return URLs before I/O", async () => {
    const { adapter, calls } = harness()
    expect(() =>
      createPolarSandboxAdapter({ ...env, POLAR_ORGANIZATION_ID: undefined })
    ).toThrow("Configure the sandbox")
    await expect(
      adapter.createCheckout({ ...request, amountMinor: 29_999 })
    ).rejects.toMatchObject({
      code: "AMOUNT_UNSUPPORTED",
      outcome: "definite_failure",
    })
    await expect(
      adapter.createCheckout({ ...request, amountMinor: 0 })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      outcome: "definite_failure",
    })
    await expect(
      adapter.createCheckout({
        ...request,
        successUrl: "https://foreign.example.test",
      })
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" })
    expect(calls.createCheckout).not.toHaveBeenCalled()
  })

  it.each([
    { total_amount: 900_001 },
    { currency: "usd" },
    { discount_amount: 1 },
    { tax_behavior: "exclusive" },
    { external_customer_id: "other-account" },
    { organization_id: checkoutId },
    { metadata: { ...metadata, elc_request_hash: "b".repeat(64) } },
    { metadata: { ...metadata, elc_purpose: "event_activation" } },
    { metadata: { ...metadata, elc_subject_id: "other-order" } },
    { url: "https://polar.sh/checkout/live-checkout" },
  ])(
    "fails closed after a created checkout mismatches the frozen request: %j",
    async (changes) => {
      const { adapter, calls } = harness()
      calls.createCheckout.mockResolvedValue({ ...checkout, ...changes })
      await expect(adapter.createCheckout(request)).rejects.toMatchObject({
        code: "PAYMENT_MISMATCH",
        outcome: "uncertain",
      })
      expect(calls.createCheckout).toHaveBeenCalledTimes(1)
    }
  )

  it("marks nullable or malformed provider metadata uncertain without exposing it", async () => {
    const { adapter, calls } = harness()
    calls.createCheckout.mockResolvedValue({
      ...checkout,
      metadata: null,
      customer_email: "private@example.test",
    })
    try {
      await adapter.createCheckout(request)
      throw new Error("Expected rejection")
    } catch (error) {
      expect(error).toMatchObject({
        code: "INVALID_RESPONSE",
        outcome: "uncertain",
      })
      expect(String(error)).not.toContain("private@example.test")
    }
  })

  it.each(["open", "confirmed", "succeeded"])(
    "requires an authoritative paid order even when checkout status is %s",
    async (status) => {
      const { adapter, calls } = harness()
      calls.getCheckout.mockResolvedValue({ ...checkout, status })
      calls.listOrders.mockResolvedValue(page([]))
      expect(
        await adapter.lookupPayment({
          providerPaymentId: checkoutId,
          expected: binding,
        })
      ).toMatchObject({ state: "pending", providerOrderId: null })
    }
  )

  it("normalizes paid order linkage and refunded gross amounts without changing checkout identity", async () => {
    const { adapter, calls } = harness()
    expect(
      await adapter.lookupPayment({
        providerPaymentId: checkoutId,
        expected: binding,
      })
    ).toEqual({
      ...binding,
      providerPaymentId: checkoutId,
      providerOrderId: orderId,
      state: "succeeded",
      refundedAmountMinor: 0,
    })
    expect(calls.listOrders).toHaveBeenCalledWith({
      checkout_id: checkoutId,
      limit: 2,
      page: 1,
    })
    calls.getOrder.mockResolvedValue({
      ...order,
      status: "refunded",
      refunded_amount: 750_000,
      refunded_tax_amount: 150_000,
      refundable_amount: 0,
      refundable_tax_amount: 0,
    })
    expect(
      await adapter.lookupPayment({
        providerPaymentId: checkoutId,
        providerOrderId: orderId,
        expected: binding,
      })
    ).toMatchObject({
      state: "succeeded",
      refundedAmountMinor: 900_000,
      providerPaymentId: checkoutId,
    })
  })

  it.each([
    { checkout_id: refundId },
    { total_amount: 900_001 },
    { net_amount: 749_999 },
    { applied_balance_amount: -100, due_amount: 899_900 },
    { metadata: { ...metadata, elc_account_id: "other-account" } },
    { paid: false },
    { refunded_amount: 900_001 },
  ])(
    "rejects order linkage, payment, and exact charge mismatches: %j",
    async (changes) => {
      const { adapter, calls } = harness()
      calls.listOrders.mockResolvedValue(page([{ ...order, ...changes }]))
      await expect(
        adapter.lookupPayment({
          providerPaymentId: checkoutId,
          expected: binding,
        })
      ).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" })
    }
  )

  it.each([
    { customer: { external_id: "organizer-account" } },
    { customer: { external_id: null } },
  ])(
    "accepts an order Polar attached to an existing customer record: %j",
    async (changes) => {
      // Polar keys customers by email, so a buyer reusing an email gets that
      // customer's external ID. Checkout and metadata still bind the account.
      const { adapter, calls } = harness()
      calls.listOrders.mockResolvedValue(page([{ ...order, ...changes }]))
      expect(
        await adapter.lookupPayment({
          providerPaymentId: checkoutId,
          expected: binding,
        })
      ).toMatchObject({ state: "succeeded", providerOrderId: orderId })
    }
  )

  it("rejects multiple orders attached to an aggregate checkout", async () => {
    const { adapter, calls } = harness()
    calls.listOrders.mockResolvedValue(
      page([order, { ...order, id: refundId }])
    )
    await expect(
      adapter.lookupPayment({
        providerPaymentId: checkoutId,
        expected: binding,
      })
    ).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" })
  })

  it("recovers a checkout by customer/product pages and metadata, without another POST", async () => {
    const { adapter, calls } = harness()
    calls.listCheckouts
      .mockResolvedValueOnce(
        page(
          [
            {
              ...checkout,
              id: orderId,
              metadata: { ...metadata, elc_attempt_id: "other-attempt" },
            },
          ],
          2,
          2
        )
      )
      .mockResolvedValueOnce(page([checkout], 2, 2))
    expect(await adapter.recoverCheckout(request)).toEqual({
      providerPaymentId: checkoutId,
      checkoutUrl: checkout.url,
    })
    expect(calls.listCheckouts).toHaveBeenNthCalledWith(2, {
      product_id: productId,
      external_customer_id: binding.accountId,
      page: 2,
      limit: 100,
    })
    expect(calls.createCheckout).not.toHaveBeenCalled()
    calls.listCheckouts.mockResolvedValue(page([]))
    expect(await adapter.recoverCheckout(request)).toBeNull()
  })

  it("requires reconciliation for duplicate checkout matches or an incomplete recovery scan", async () => {
    const { adapter, calls } = harness()
    calls.listCheckouts.mockResolvedValue(
      page([checkout, { ...checkout, id: orderId }])
    )
    await expect(adapter.recoverCheckout(request)).rejects.toMatchObject({
      code: "RECONCILIATION_REQUIRED",
    })
    calls.listCheckouts.mockResolvedValue(page([], 21, 2100))
    await expect(adapter.recoverCheckout(request)).rejects.toMatchObject({
      code: "RECONCILIATION_REQUIRED",
    })
    expect(calls.createCheckout).not.toHaveBeenCalled()
  })

  it.each([
    new PolarNetworkError("private provider detail"),
    new PolarServerError(502, "private provider detail"),
    new SyntaxError("private provider detail"),
  ])(
    "preserves uncertainty after network/server/unparseable POST failure",
    async (error) => {
      const { adapter, calls } = harness()
      calls.createCheckout.mockRejectedValue(error)
      await expect(adapter.createCheckout(request)).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        outcome: "uncertain",
      })
      expect(calls.createCheckout).toHaveBeenCalledTimes(1)
    }
  )

  it("distinguishes an explicit rejection and rate limit from an uncertain financial POST", async () => {
    const { adapter, calls } = harness()
    calls.createCheckout.mockRejectedValue(
      new PolarClientError(422, { detail: "private provider detail" })
    )
    await expect(adapter.createCheckout(request)).rejects.toMatchObject({
      code: "PROVIDER_REJECTED",
      outcome: "definite_failure",
      httpStatus: 422,
    })
    calls.createCheckout.mockRejectedValue(new PolarRateLimitError(429, 8))
    await expect(adapter.createCheckout(request)).rejects.toMatchObject({
      code: "PROVIDER_REJECTED",
      outcome: "definite_failure",
      retryAfterSeconds: 8,
    })
  })
})

describe("Polar full refunds", () => {
  it("sends net refund amount and validates the gross result, keyed by the internal refund ID", async () => {
    const { adapter, calls } = harness()
    expect(await adapter.refund(refundRequest)).toEqual({
      ...binding,
      providerPaymentId: checkoutId,
      providerOrderId: orderId,
      providerRefundId: refundId,
      refundId: refundRequest.refundId,
      state: "pending",
    })
    expect(calls.createRefund).toHaveBeenCalledExactlyOnceWith({
      order_id: orderId,
      amount: 750_000,
      reason: "customer_request",
      revoke_benefits: false,
      metadata: refund.metadata,
    })
  })

  it("recovers an existing refund without resubmission and uses the current provider status", async () => {
    const { adapter, calls } = harness()
    calls.listRefunds.mockResolvedValue(
      page([{ ...refund, status: "succeeded" }])
    )
    expect(await adapter.refund(refundRequest)).toMatchObject({
      providerRefundId: refundId,
      state: "succeeded",
    })
    expect(await adapter.lookupRefund(refundRequest)).toMatchObject({
      amountMinor: 900_000,
      state: "succeeded",
    })
    expect(calls.createRefund).not.toHaveBeenCalled()
    calls.listRefunds.mockResolvedValue(
      page([{ ...refund, status: "canceled" }])
    )
    expect(await adapter.lookupRefund(refundRequest)).toMatchObject({
      state: "failed",
    })
  })

  it("rejects partial or mismatched remaining refunds before a financial POST", async () => {
    const { adapter, calls } = harness()
    await expect(
      adapter.refund({ ...refundRequest, amountMinor: 100 })
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" })
    calls.getOrder.mockResolvedValue({ ...order, refundable_amount: 700_000 })
    await expect(adapter.refund(refundRequest)).rejects.toMatchObject({
      code: "REFUND_MISMATCH",
    })
    expect(calls.createRefund).not.toHaveBeenCalled()
  })

  it("does not treat another operation's refund as this refund or send a replacement", async () => {
    const { adapter, calls } = harness()
    calls.listRefunds.mockResolvedValue(
      page([
        {
          ...refund,
          metadata: { ...refund.metadata, elc_refund_id: "other-refund" },
        },
      ])
    )
    await expect(adapter.refund(refundRequest)).rejects.toMatchObject({
      code: "RECONCILIATION_REQUIRED",
    })
    expect(calls.createRefund).not.toHaveBeenCalled()
  })

  it.each([
    { tax_amount: 149_999 },
    { order_id: checkoutId },
    { currency: "usd" },
    { metadata: { ...refund.metadata, elc_refund_id: "other-refund" } },
    { metadata: { ...refund.metadata, elc_checkout_id: orderId } },
  ])(
    "rejects an uncertain refund response with mismatched totals or identities: %j",
    async (changes) => {
      const { adapter, calls } = harness()
      calls.createRefund.mockResolvedValue({ ...refund, ...changes })
      await expect(adapter.refund(refundRequest)).rejects.toMatchObject({
        code: "REFUND_MISMATCH",
        outcome: "uncertain",
      })
      expect(calls.createRefund).toHaveBeenCalledTimes(1)
    }
  )

  it("makes no second refund POST after an ambiguous response, and a later lookup can recover it", async () => {
    const { adapter, calls } = harness()
    calls.createRefund.mockRejectedValue(
      new PolarNetworkError("connection closed")
    )
    await expect(adapter.refund(refundRequest)).rejects.toMatchObject({
      outcome: "uncertain",
    })
    calls.listRefunds.mockResolvedValue(
      page([{ ...refund, status: "succeeded" }])
    )
    expect(await adapter.lookupRefund(refundRequest)).toMatchObject({
      providerRefundId: refundId,
      state: "succeeded",
    })
    expect(calls.createRefund).toHaveBeenCalledTimes(1)
  })
})

describe("Polar webhook signature and payload validation", () => {
  it.each(["legacy", "standard"] as const)(
    "verifies %s secret encoding and normalizes the signed paid order without provider I/O",
    async (encoding) => {
      const { adapter, calls } = harness()
      const { body, headers } = await signed(envelope("order.paid", order), {
        encoding,
      })
      expect(await adapter.verifyWebhook(body, headers)).toEqual({
        ...binding,
        kind: "payment",
        providerEventId: "delivery-1",
        providerPaymentId: checkoutId,
        providerOrderId: orderId,
        state: "succeeded",
        refundedAmountMinor: 0,
      })
      for (const call of Object.values(calls))
        expect(call).not.toHaveBeenCalled()
    }
  )

  it("rejects tampering, missing signatures, old timestamps, and future timestamps before provider I/O", async () => {
    const { adapter, calls } = harness()
    const valid = await signed(envelope("order.paid", order))
    await expect(
      adapter.verifyWebhook(valid.body + " ", valid.headers)
    ).rejects.toMatchObject({ code: "INVALID_WEBHOOK" })
    await expect(adapter.verifyWebhook(valid.body, {})).rejects.toMatchObject({
      code: "INVALID_WEBHOOK",
    })
    for (const offset of [-301, 301]) {
      const value = await signed(envelope("order.paid", order), {
        timestamp: Math.floor(Date.now() / 1000) + offset,
      })
      await expect(
        adapter.verifyWebhook(value.body, value.headers)
      ).rejects.toMatchObject({ code: "INVALID_WEBHOOK" })
    }
    expect(calls.getCheckout).not.toHaveBeenCalled()
  })

  it("validates the signed payload instead of relying on SDK TypeScript types", async () => {
    const { adapter, calls } = harness()
    for (const value of [
      envelope("order.paid", { ...order, metadata: null }),
      envelope("order.paid", { ...order, total_amount: "900000" }),
      { ...envelope("order.paid", order), api_version: "2026-10" },
    ]) {
      const signature = await signed(value)
      await expect(
        adapter.verifyWebhook(signature.body, signature.headers)
      ).rejects.toMatchObject({ code: "INVALID_RESPONSE" })
    }
    expect(calls.getCheckout).not.toHaveBeenCalled()
  })

  it("rejects validly signed but mismatched payment metadata or amounts", async () => {
    const { adapter, calls } = harness()
    const badAmount = await signed(
      envelope("order.paid", { ...order, total_amount: 1 })
    )
    await expect(
      adapter.verifyWebhook(badAmount.body, badAmount.headers)
    ).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" })
    const badMetadata = await signed(
      envelope("order.paid", {
        ...order,
        metadata: { ...metadata, elc_amount_minor: 1 },
      })
    )
    await expect(
      adapter.verifyWebhook(badMetadata.body, badMetadata.headers)
    ).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" })
    for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled()
  })

  it("preserves the signed binding for comparison with the frozen database binding", async () => {
    const { adapter, calls } = harness()
    const signature = await signed(
      envelope("order.paid", {
        ...order,
        metadata: { ...metadata, elc_subject_id: "other-subject" },
      })
    )
    expect(
      await adapter.verifyWebhook(signature.body, signature.headers)
    ).toMatchObject({
      kind: "payment",
      subjectId: "other-subject",
      requestHash: binding.requestHash,
    })
    for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled()
  })

  it("normalizes signed refund updates without reading later provider state", async () => {
    const { adapter, calls } = harness()
    calls.listRefunds.mockResolvedValue(
      page([{ ...refund, status: "succeeded" }])
    )
    const signature = await signed(envelope("refund.updated", refund), {
      encoding: "standard",
    })
    expect(
      await adapter.verifyWebhook(signature.body, signature.headers)
    ).toEqual({
      ...binding,
      kind: "refund",
      providerEventId: "delivery-1",
      providerPaymentId: checkoutId,
      providerOrderId: orderId,
      providerRefundId: refundId,
      refundId: refundRequest.refundId,
      state: "pending",
    })
    for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled()
  })

  it.each(["open", "confirmed", "succeeded", "expired", "failed"])(
    "normalizes a signed %s checkout without inferring payment or making provider requests",
    async (status) => {
      const { adapter, calls } = harness()
      const signature = await signed(
        envelope("checkout.updated", { ...checkout, status })
      )
      expect(
        await adapter.verifyWebhook(signature.body, signature.headers)
      ).toMatchObject({
        kind: "payment",
        providerPaymentId: checkoutId,
        providerOrderId: null,
        state:
          status === "expired"
            ? "cancelled"
            : status === "failed"
              ? "failed"
              : "pending",
        refundedAmountMinor: 0,
      })
      for (const call of Object.values(calls))
        expect(call).not.toHaveBeenCalled()
    }
  )

  it("preserves signed refunded gross totals without provider requests", async () => {
    const { adapter, calls } = harness()
    const signature = await signed(
      envelope("order.refunded", {
        ...order,
        status: "refunded",
        refunded_amount: 750_000,
        refunded_tax_amount: 150_000,
        refundable_amount: 0,
        refundable_tax_amount: 0,
      })
    )
    expect(
      await adapter.verifyWebhook(signature.body, signature.headers)
    ).toMatchObject({
      kind: "payment",
      state: "succeeded",
      refundedAmountMinor: 900_000,
    })
    for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled()
  })

  it("returns null for irrelevant verified events and events belonging to another environment", async () => {
    const { adapter, calls } = harness()
    for (const value of [
      envelope("customer.created", {}),
      envelope("future.event", {}),
      envelope("order.paid", {
        ...order,
        metadata: { ...metadata, elc_environment: "demo" },
      }),
    ]) {
      const signature = await signed(value)
      expect(
        await adapter.verifyWebhook(signature.body, signature.headers)
      ).toBeNull()
    }
    expect(calls.getCheckout).not.toHaveBeenCalled()
  })
})
import { Buffer } from "node:buffer"
