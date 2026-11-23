import { PolarClientError, PolarRateLimitError } from "@polar-sh/sdk"
import { createPolarCore, webhooks, type models } from "@polar-sh/sdk/2026-04"
import { createCheckoutsService } from "@polar-sh/sdk/2026-04/services/checkouts"
import { createOrdersService } from "@polar-sh/sdk/2026-04/services/orders"
import { createRefundsService } from "@polar-sh/sdk/2026-04/services/refunds"
import { z } from "zod"
import {
  paymentBindingSchema,
  paymentCheckoutRequestSchema,
  paymentLookupRequestSchema,
  providerCheckoutSchema,
  providerPaymentStatusSchema,
  providerRefundRequestSchema,
  providerRefundStatusSchema,
  ProviderOperationError,
  verifiedProviderEventSchema,
  type PaymentAdapter,
  type PaymentBinding,
  type PaymentCheckoutRequest,
  type PaymentLookupRequest,
  type ProviderErrorCode,
  type ProviderRefundRequest,
  type VerifiedProviderEvent,
} from "@elc/shared"
import type { Bindings } from "../env"

export const POLAR_API_VERSION = "2026-04"
export const POLAR_MINIMUM_KZT_MINOR = 30_000
const MAX_RECOVERY_PAGES = 20
// Polar rejects special-use domains (RFC 6761), such as the `.test` demo accounts.
const SPECIAL_USE_EMAIL_TLDS = new Set([
  "arpa",
  "invalid",
  "local",
  "localhost",
  "onion",
  "test",
])

/** Prefill only addresses Polar accepts; otherwise the buyer types one at checkout. */
export function checkoutEmailPrefill(email: string) {
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase()
  const tld = domain.replace(/\.$/, "").split(".").at(-1) ?? ""
  return SPECIAL_USE_EMAIL_TLDS.has(tld) ? {} : { customer_email: email }
}

function sandboxTransport(accessToken: string): PolarTransport {
  const core = createPolarCore({
    accessToken,
    environment: "sandbox",
    timeout: 15,
  })
  const send = core.sendRequest.bind(core)
  core.sendRequest = (request, options) => {
    const [url, init] = request
    if (new URL(url).origin !== "https://sandbox-api.polar.sh") {
      fail(
        "INVALID_REQUEST",
        "This adapter accepts sandbox requests only.",
        "definite_failure"
      )
    }
    const headers = new Headers(init.headers)
    headers.set("User-Agent", "elc-sandbox-acceptance/1.0")
    return send([url, { ...init, headers }], options)
  }
  return {
    checkouts: createCheckoutsService(core),
    orders: createOrdersService(core),
    refunds: createRefundsService(core),
  }
}

type PolarEnvironment = Pick<
  Bindings,
  | "POLAR_ACCESS_TOKEN"
  | "POLAR_WEBHOOK_SECRET"
  | "POLAR_PRODUCT_ID"
  | "POLAR_ORGANIZATION_ID"
  | "APP_ORIGIN"
  | "ENVIRONMENT"
>

/** The production implementation uses the SDK. Tests replace only its I/O. */
export interface PolarTransport {
  checkouts: {
    create(body: models.CheckoutCreate): Promise<unknown>
    get(id: string): Promise<unknown>
    list(query: {
      product_id: string
      external_customer_id: string
      page: number
      limit: number
    }): Promise<unknown>
  }
  orders: {
    get(id: string): Promise<unknown>
    list(query: {
      checkout_id: string
      page: number
      limit: number
    }): Promise<unknown>
  }
  refunds: {
    create(body: models.RefundCreate): Promise<unknown>
    list(query: {
      order_id: string
      page: number
      limit: number
    }): Promise<unknown>
  }
}

const providerId = z.string().uuid()
const money = z.int().nonnegative()
const metadata = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()])
)
const checkoutSchema = z.object({
  id: providerId,
  url: z.url(),
  status: z.enum(["open", "expired", "confirmed", "succeeded", "failed"]),
  organization_id: providerId,
  product_id: providerId,
  currency: z.string(),
  total_amount: money,
  discount_amount: money,
  tax_behavior: z.enum(["inclusive", "exclusive"]).nullable(),
  external_customer_id: z.string().nullable(),
  metadata,
})
const orderSchema = z.object({
  id: providerId,
  checkout_id: providerId.nullable(),
  product_id: providerId.nullable(),
  product: z.object({ id: providerId, organization_id: providerId }).nullable(),
  customer: z.object({ external_id: z.string().nullable() }),
  status: z.enum([
    "draft",
    "pending",
    "paid",
    "refunded",
    "partially_refunded",
    "void",
  ]),
  paid: z.boolean(),
  currency: z.string(),
  total_amount: money,
  net_amount: money,
  tax_amount: money,
  discount_amount: money,
  applied_balance_amount: z.int(),
  due_amount: money,
  refunded_amount: money,
  refunded_tax_amount: money,
  refundable_amount: money,
  refundable_tax_amount: money,
  metadata,
})
const refundSchema = z.object({
  id: providerId,
  order_id: providerId,
  organization_id: providerId,
  status: z.enum(["pending", "succeeded", "failed", "canceled"]),
  currency: z.string(),
  amount: money,
  tax_amount: money,
  metadata,
})
const pageSchema = z.object({
  items: z.array(z.unknown()).max(100),
  pagination: z.object({
    max_page: z.int().nonnegative(),
    total_count: z.int().nonnegative(),
  }),
})

type Checkout = z.infer<typeof checkoutSchema>
type Order = z.infer<typeof orderSchema>
type Refund = z.infer<typeof refundSchema>

function fail(
  code: ProviderErrorCode,
  message: string,
  outcome: "definite_failure" | "uncertain" = "uncertain"
): never {
  throw new ProviderOperationError(code, outcome, message)
}

function parse<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  input = false
): z.output<Schema> {
  const result = schema.safeParse(value)
  if (!result.success)
    fail(
      input ? "INVALID_REQUEST" : "INVALID_RESPONSE",
      input
        ? "The payment adapter request is invalid."
        : "The provider response could not be validated.",
      input ? "definite_failure" : "uncertain"
    )
  return result.data
}

function bindingFromMetadata(value: z.infer<typeof metadata>): PaymentBinding {
  return parse(paymentBindingSchema, {
    paymentAttemptId: value.elc_attempt_id,
    purpose: value.elc_purpose,
    subjectId: value.elc_subject_id,
    accountId: value.elc_account_id,
    requestHash: value.elc_request_hash,
    amountMinor: value.elc_amount_minor,
    currency: value.elc_currency,
  })
}

function sameBinding(actual: PaymentBinding, expected: PaymentBinding) {
  return (
    Object.keys(paymentBindingSchema.shape) as (keyof PaymentBinding)[]
  ).every((key) => actual[key] === expected[key])
}

/** Error text deliberately excludes provider response bodies, customer data, and tokens. */
async function callProvider<T>(
  operation: "read" | "checkout" | "refund",
  callback: () => Promise<T>
): Promise<T> {
  try {
    return await callback()
  } catch (error) {
    if (error instanceof ProviderOperationError) throw error
    if (error instanceof PolarClientError) {
      const status = error.statusCode
      const uncertain =
        status === 408 ||
        status === 409 ||
        (operation === "refund" && status === 403)
      throw new ProviderOperationError(
        uncertain ? "RECONCILIATION_REQUIRED" : "PROVIDER_REJECTED",
        uncertain ? "uncertain" : "definite_failure",
        uncertain
          ? "Reconcile the existing provider operation before retrying."
          : "The provider rejected this request.",
        status,
        error instanceof PolarRateLimitError
          ? (error.retryAfter ?? undefined)
          : undefined
      )
    }
    throw new ProviderOperationError(
      "PROVIDER_UNAVAILABLE",
      operation === "read" ? "definite_failure" : "uncertain",
      operation === "read"
        ? "The provider could not be read. No financial request was sent by this read."
        : "The provider response is uncertain. Reconcile before sending another request."
    )
  }
}

export function createPolarSandboxAdapter(
  env: PolarEnvironment,
  dependencies: { transport?: PolarTransport } = {}
): PaymentAdapter {
  if (
    !env.POLAR_ACCESS_TOKEN ||
    !env.POLAR_PRODUCT_ID ||
    !env.POLAR_ORGANIZATION_ID ||
    !providerId.safeParse(env.POLAR_PRODUCT_ID).success ||
    !providerId.safeParse(env.POLAR_ORGANIZATION_ID).success
  ) {
    fail(
      "NOT_CONFIGURED",
      "Configure the sandbox token, product, and organization before accepting payments.",
      "definite_failure"
    )
  }
  const productId = env.POLAR_PRODUCT_ID
  const organizationId = env.POLAR_ORGANIZATION_ID
  if (!z.url({ protocol: /^https?$/ }).safeParse(env.APP_ORIGIN).success) {
    fail(
      "NOT_CONFIGURED",
      "Configure a valid application origin before accepting payments.",
      "definite_failure"
    )
  }
  const appOrigin = new URL(env.APP_ORIGIN).origin
  const client: PolarTransport =
    dependencies.transport ?? sandboxTransport(env.POLAR_ACCESS_TOKEN)

  function bindingMetadata(binding: PaymentBinding) {
    return {
      elc_attempt_id: binding.paymentAttemptId,
      elc_purpose: binding.purpose,
      elc_subject_id: binding.subjectId,
      elc_account_id: binding.accountId,
      elc_request_hash: binding.requestHash,
      elc_amount_minor: binding.amountMinor,
      elc_currency: binding.currency,
      elc_environment: env.ENVIRONMENT,
    }
  }

  function checkMetadata(
    value: z.infer<typeof metadata>,
    expected: PaymentBinding
  ) {
    if (
      value.elc_environment !== env.ENVIRONMENT ||
      !sameBinding(bindingFromMetadata(value), expected)
    ) {
      fail(
        "PAYMENT_MISMATCH",
        "Provider metadata does not match the frozen payment attempt."
      )
    }
  }

  function validateCheckout(
    value: unknown,
    expected: PaymentBinding,
    id?: string
  ): Checkout {
    const checkout = parse(checkoutSchema, value)
    checkMetadata(checkout.metadata, expected)
    if (
      (id && checkout.id !== id) ||
      checkout.product_id !== productId ||
      checkout.organization_id !== organizationId ||
      checkout.external_customer_id !== expected.accountId ||
      checkout.currency !== "kzt" ||
      checkout.total_amount !== expected.amountMinor ||
      checkout.discount_amount !== 0 ||
      checkout.tax_behavior === "exclusive"
    ) {
      fail(
        "PAYMENT_MISMATCH",
        "The provider checkout does not match the frozen payment attempt."
      )
    }
    return checkout
  }

  function checkoutResult(checkout: Checkout) {
    const url = new URL(checkout.url)
    if (
      url.origin !== "https://sandbox.polar.sh" ||
      !url.pathname.startsWith("/checkout/")
    ) {
      fail(
        "PAYMENT_MISMATCH",
        "The provider returned an unexpected checkout destination."
      )
    }
    return parse(providerCheckoutSchema, {
      providerPaymentId: checkout.id,
      checkoutUrl: checkout.url,
    })
  }

  function validateOrder(
    value: unknown,
    expected: PaymentBinding,
    checkoutId: string,
    orderId?: string
  ): Order {
    const order = parse(orderSchema, value)
    checkMetadata(order.metadata, expected)
    const refunded = order.refunded_amount + order.refunded_tax_amount
    if (
      (orderId && order.id !== orderId) ||
      order.checkout_id !== checkoutId ||
      order.product_id !== productId ||
      order.product?.id !== productId ||
      order.product.organization_id !== organizationId ||
      order.customer.external_id !== expected.accountId ||
      order.currency !== "kzt" ||
      order.total_amount !== expected.amountMinor ||
      order.net_amount + order.tax_amount !== order.total_amount ||
      order.applied_balance_amount !== 0 ||
      order.due_amount !== expected.amountMinor ||
      order.discount_amount !== 0 ||
      !Number.isSafeInteger(refunded) ||
      refunded > expected.amountMinor ||
      ["paid", "refunded", "partially_refunded"].includes(order.status) !==
        order.paid
    ) {
      fail(
        "PAYMENT_MISMATCH",
        "The provider order does not match the frozen amount and ownership."
      )
    }
    return order
  }

  async function readOrder(
    request: PaymentLookupRequest
  ): Promise<Order | null> {
    if (request.providerOrderId) {
      return validateOrder(
        await callProvider("read", () =>
          client.orders.get(request.providerOrderId!)
        ),
        request.expected,
        request.providerPaymentId,
        request.providerOrderId
      )
    }
    const page = parse(
      pageSchema,
      await callProvider("read", () =>
        client.orders.list({
          checkout_id: request.providerPaymentId,
          page: 1,
          limit: 2,
        })
      )
    )
    if (
      page.items.length > 1 ||
      page.pagination.total_count > 1 ||
      page.pagination.max_page > 1
    ) {
      fail(
        "PAYMENT_MISMATCH",
        "The checkout is linked to an unexpected number of orders."
      )
    }
    return page.items.length
      ? validateOrder(
          page.items[0],
          request.expected,
          request.providerPaymentId
        )
      : null
  }

  async function lookupPayment(input: PaymentLookupRequest) {
    const request = parse(paymentLookupRequestSchema, input, true)
    const checkout = validateCheckout(
      await callProvider("read", () =>
        client.checkouts.get(request.providerPaymentId)
      ),
      request.expected,
      request.providerPaymentId
    )
    const order = await readOrder(request)
    const state = order?.paid
      ? "succeeded"
      : order?.status === "void" || checkout.status === "expired"
        ? "cancelled"
        : checkout.status === "failed"
          ? "failed"
          : "pending"
    return parse(providerPaymentStatusSchema, {
      ...request.expected,
      providerPaymentId: checkout.id,
      providerOrderId: order?.id ?? null,
      state,
      refundedAmountMinor: order
        ? order.refunded_amount + order.refunded_tax_amount
        : 0,
    })
  }

  function checkoutRequest(input: PaymentCheckoutRequest) {
    const request = parse(paymentCheckoutRequestSchema, input, true)
    if (request.amountMinor < POLAR_MINIMUM_KZT_MINOR)
      fail(
        "AMOUNT_UNSUPPORTED",
        "Polar sandbox requires at least KZT 300 for a positive checkout.",
        "definite_failure"
      )
    if (
      [request.successUrl, request.returnUrl].some(
        (value) => new URL(value).origin !== appOrigin
      )
    ) {
      fail(
        "INVALID_REQUEST",
        "Checkout return URLs must belong to the application origin.",
        "definite_failure"
      )
    }
    return request
  }

  async function createCheckout(input: PaymentCheckoutRequest) {
    const request = checkoutRequest(input)
    const response = await callProvider("checkout", () =>
      client.checkouts.create({
        products: [productId],
        prices: {
          [productId]: [
            {
              amount_type: "fixed",
              price_currency: "kzt",
              price_amount: request.amountMinor,
              tax_behavior: "inclusive",
            },
          ],
        },
        currency: "kzt",
        allow_discount_codes: false,
        allow_trial: false,
        external_customer_id: request.accountId,
        ...checkoutEmailPrefill(request.customerEmail),
        metadata: bindingMetadata(request),
        success_url: request.successUrl,
        return_url: request.returnUrl,
      })
    )
    return checkoutResult(validateCheckout(response, request))
  }

  async function recoverCheckout(input: PaymentCheckoutRequest) {
    const request = checkoutRequest(input)
    const found: Checkout[] = []
    for (let pageNumber = 1; pageNumber <= MAX_RECOVERY_PAGES; pageNumber++) {
      const page = parse(
        pageSchema,
        await callProvider("read", () =>
          client.checkouts.list({
            product_id: productId,
            external_customer_id: request.accountId,
            page: pageNumber,
            limit: 100,
          })
        )
      )
      for (const value of page.items) {
        const checkout = parse(checkoutSchema, value)
        if (checkout.metadata.elc_attempt_id === request.paymentAttemptId)
          found.push(validateCheckout(checkout, request))
      }
      if (found.length > 1)
        fail(
          "RECONCILIATION_REQUIRED",
          "Multiple provider checkouts match this payment attempt."
        )
      if (pageNumber >= page.pagination.max_page)
        return found[0] ? checkoutResult(found[0]) : null
    }
    fail(
      "RECONCILIATION_REQUIRED",
      "Checkout recovery reached its page limit. Continue reconciliation before retrying."
    )
  }

  function refundRequest(input: ProviderRefundRequest) {
    const request = parse(providerRefundRequestSchema, input, true)
    if (request.amountMinor !== request.expected.amountMinor)
      fail(
        "INVALID_REQUEST",
        "Only the complete frozen payment amount can be refunded.",
        "definite_failure"
      )
    return request
  }

  function validateRefund(
    value: unknown,
    request: ProviderRefundRequest
  ): Refund {
    const refund = parse(refundSchema, value)
    checkMetadata(refund.metadata, request.expected)
    if (
      refund.order_id !== request.providerOrderId ||
      refund.organization_id !== organizationId ||
      refund.currency !== "kzt" ||
      refund.metadata.elc_refund_id !== request.refundId ||
      refund.metadata.elc_checkout_id !== request.providerPaymentId ||
      refund.metadata.elc_order_id !== request.providerOrderId ||
      refund.amount + refund.tax_amount !== request.amountMinor
    ) {
      fail(
        "REFUND_MISMATCH",
        "The provider refund does not match the requested full refund."
      )
    }
    return refund
  }

  function refundResult(refund: Refund, request: ProviderRefundRequest) {
    return parse(providerRefundStatusSchema, {
      ...request.expected,
      refundId: request.refundId,
      providerPaymentId: request.providerPaymentId,
      providerOrderId: request.providerOrderId,
      providerRefundId: refund.id,
      state: refund.status === "canceled" ? "failed" : refund.status,
    })
  }

  async function findRefund(request: ProviderRefundRequest) {
    const found: Refund[] = []
    for (let pageNumber = 1; pageNumber <= MAX_RECOVERY_PAGES; pageNumber++) {
      const page = parse(
        pageSchema,
        await callProvider("read", () =>
          client.refunds.list({
            order_id: request.providerOrderId,
            page: pageNumber,
            limit: 100,
          })
        )
      )
      for (const value of page.items) {
        const refund = parse(refundSchema, value)
        if (refund.metadata.elc_refund_id === request.refundId)
          found.push(validateRefund(refund, request))
        else if (
          refund.order_id === request.providerOrderId &&
          ["pending", "succeeded"].includes(refund.status)
        ) {
          fail(
            "RECONCILIATION_REQUIRED",
            "Another provider refund exists for this order. Reconcile it before continuing."
          )
        }
      }
      if (found.length > 1)
        fail(
          "RECONCILIATION_REQUIRED",
          "Multiple provider refunds match the internal refund."
        )
      if (pageNumber >= page.pagination.max_page) return found[0] ?? null
    }
    fail(
      "RECONCILIATION_REQUIRED",
      "Refund recovery reached its page limit. Continue reconciliation before retrying."
    )
  }

  async function lookupRefund(input: ProviderRefundRequest) {
    const request = refundRequest(input)
    await lookupPayment({
      providerPaymentId: request.providerPaymentId,
      providerOrderId: request.providerOrderId,
      expected: request.expected,
    })
    const found = await findRefund(request)
    return found ? refundResult(found, request) : null
  }

  async function refund(input: ProviderRefundRequest) {
    const request = refundRequest(input)
    const payment = await lookupPayment({
      providerPaymentId: request.providerPaymentId,
      providerOrderId: request.providerOrderId,
      expected: request.expected,
    })
    const existing = await findRefund(request)
    if (existing) return refundResult(existing, request)
    if (payment.state !== "succeeded" || payment.refundedAmountMinor !== 0)
      fail(
        "RECONCILIATION_REQUIRED",
        "Reconcile the paid order before issuing a full refund."
      )
    const order = await readOrder({
      providerPaymentId: request.providerPaymentId,
      providerOrderId: request.providerOrderId,
      expected: request.expected,
    })
    if (
      !order ||
      order.refundable_amount < 1 ||
      order.refundable_amount + order.refundable_tax_amount !==
        request.amountMinor
    ) {
      fail(
        "REFUND_MISMATCH",
        "The provider's remaining refundable amount differs from the full refund."
      )
    }
    const reason: models.RefundCreate["reason"] =
      request.reason === "voluntary"
        ? "customer_request"
        : request.reason === "event_cancelled"
          ? "service_disruption"
          : "other"
    const response = await callProvider("refund", () =>
      client.refunds.create({
        order_id: request.providerOrderId,
        amount: order.refundable_amount,
        reason,
        revoke_benefits: false,
        metadata: {
          ...bindingMetadata(request.expected),
          elc_refund_id: request.refundId,
          elc_checkout_id: request.providerPaymentId,
          elc_order_id: request.providerOrderId,
        },
      })
    )
    return refundResult(validateRefund(response, request), request)
  }

  async function verifyWebhook(
    body: string,
    headers: Readonly<Record<string, string>>
  ): Promise<VerifiedProviderEvent | null> {
    if (!env.POLAR_WEBHOOK_SECRET)
      fail(
        "NOT_CONFIGURED",
        "The sandbox webhook secret is not configured.",
        "definite_failure"
      )
    let payload: unknown
    try {
      payload = await webhooks.validateEvent(
        body,
        { ...headers },
        env.POLAR_WEBHOOK_SECRET
      )
    } catch (error) {
      if (error instanceof webhooks.PolarWebhookUnknownTypeError) return null
      fail(
        "INVALID_WEBHOOK",
        "The webhook signature or payload is invalid.",
        "definite_failure"
      )
    }
    const envelope = parse(
      z.object({
        type: z.string(),
        api_version: z.literal(POLAR_API_VERSION),
        data: z.unknown(),
      }),
      payload
    )
    const eventId = Object.entries(headers).find(
      ([key]) => key.toLowerCase() === "webhook-id"
    )?.[1]
    if (!eventId)
      fail(
        "INVALID_WEBHOOK",
        "The webhook delivery identifier is missing.",
        "definite_failure"
      )
    if (
      ["checkout.created", "checkout.updated", "checkout.expired"].includes(
        envelope.type
      )
    ) {
      const checkout = parse(checkoutSchema, envelope.data)
      if (
        checkout.organization_id !== organizationId ||
        checkout.product_id !== productId ||
        checkout.metadata.elc_environment !== env.ENVIRONMENT
      )
        return null
      const expected = bindingFromMetadata(checkout.metadata)
      validateCheckout(checkout, expected)
      return parse(verifiedProviderEventSchema, {
        ...expected,
        kind: "payment",
        providerEventId: eventId,
        providerPaymentId: checkout.id,
        providerOrderId: null,
        state:
          checkout.status === "expired"
            ? "cancelled"
            : checkout.status === "failed"
              ? "failed"
              : "pending",
        refundedAmountMinor: 0,
      })
    }
    if (
      [
        "order.created",
        "order.updated",
        "order.paid",
        "order.refunded",
      ].includes(envelope.type)
    ) {
      const order = parse(orderSchema, envelope.data)
      if (
        order.product_id !== productId ||
        order.product?.organization_id !== organizationId ||
        order.metadata.elc_environment !== env.ENVIRONMENT
      )
        return null
      const expected = bindingFromMetadata(order.metadata)
      if (!order.checkout_id)
        fail(
          "PAYMENT_MISMATCH",
          "The provider order is missing its checkout link."
        )
      validateOrder(order, expected, order.checkout_id, order.id)
      return parse(verifiedProviderEventSchema, {
        ...expected,
        kind: "payment",
        providerEventId: eventId,
        providerPaymentId: order.checkout_id,
        providerOrderId: order.id,
        state: order.paid
          ? "succeeded"
          : order.status === "void"
            ? "cancelled"
            : "pending",
        refundedAmountMinor: order.refunded_amount + order.refunded_tax_amount,
      })
    }
    if (["refund.created", "refund.updated"].includes(envelope.type)) {
      const value = parse(refundSchema, envelope.data)
      if (
        value.organization_id !== organizationId ||
        value.metadata.elc_environment !== env.ENVIRONMENT
      )
        return null
      const expected = bindingFromMetadata(value.metadata)
      const request = refundRequest({
        expected,
        refundId: parse(
          z.string().min(1).max(128),
          value.metadata.elc_refund_id
        ),
        providerPaymentId: parse(providerId, value.metadata.elc_checkout_id),
        providerOrderId: value.order_id,
        idempotencyKey: parse(
          z.string().min(1).max(128),
          value.metadata.elc_refund_id
        ),
        amountMinor: expected.amountMinor,
        currency: "KZT",
        reason: "technical_compensation",
      })
      validateRefund(value, request)
      return parse(verifiedProviderEventSchema, {
        kind: "refund",
        providerEventId: eventId,
        ...refundResult(value, request),
      })
    }
    return null
  }

  return {
    createCheckout,
    recoverCheckout,
    lookupPayment,
    refund,
    lookupRefund,
    verifyWebhook,
  }
}
