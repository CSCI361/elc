import { z } from "zod"

import {
  currencySchema,
  entityIdSchema,
  minorAmountSchema,
  requestIdSchema,
  timeZoneSchema,
  utcTimestampSchema,
} from "./common"
import { discountSchema } from "./money"
import { policy } from "./policy"
import {
  eventVisibilitySchema,
  orderStateSchema,
  paidSalesStateSchema,
  paymentStateSchema,
  publicationStateSchema,
  refundStateSchema,
  reservationStateSchema,
  ticketStateSchema,
} from "./states"

export const seatingModeSchema = z.enum(["general_admission", "assigned"])

const eventDefinitionSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(20_000),
  category: z.string().trim().min(1).max(80),
  venueName: z.string().trim().min(1).max(200),
  venueAddress: z.string().trim().min(1).max(500),
  startsAt: utcTimestampSchema,
  endsAt: utcTimestampSchema,
  timeZone: timeZoneSchema.default(policy.defaultTimeZone),
  visibility: eventVisibilitySchema.default("public"),
  seatingMode: seatingModeSchema.default("general_admission"),
  venueLayoutId: entityIdSchema.optional(),
  capacity: z.int().positive(),
  registrationOpensAt: utcTimestampSchema,
  registrationClosesAt: utcTimestampSchema,
  maxTicketsPerOrder: z.int().positive().default(policy.defaultTicketsPerOrder),
})

function validateEvent(
  event: z.infer<typeof eventDefinitionSchema>,
  context: z.RefinementCtx
) {
  if (Date.parse(event.endsAt) <= Date.parse(event.startsAt)) {
    context.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "Event end must follow its start",
    })
  }
  if (
    Date.parse(event.registrationClosesAt) <=
    Date.parse(event.registrationOpensAt)
  ) {
    context.addIssue({
      code: "custom",
      path: ["registrationClosesAt"],
      message: "Registration close must follow its opening",
    })
  }
  if (event.maxTicketsPerOrder > event.capacity) {
    context.addIssue({
      code: "custom",
      path: ["maxTicketsPerOrder"],
      message: "The order limit cannot exceed event capacity",
    })
  }
  if (event.seatingMode === "assigned" && !event.venueLayoutId) {
    context.addIssue({
      code: "custom",
      path: ["venueLayoutId"],
      message: "Assigned seating requires a venue layout",
    })
  }
  if (event.seatingMode === "general_admission" && event.venueLayoutId) {
    context.addIssue({
      code: "custom",
      path: ["venueLayoutId"],
      message: "General admission does not use assigned-seat inventory",
    })
  }
}

export const createEventSchema =
  eventDefinitionSchema.superRefine(validateEvent)

export const eventSchema = eventDefinitionSchema
  .extend({
    id: entityIdSchema,
    organizerId: entityIdSchema,
    publicationState: publicationStateSchema,
    paidSalesState: paidSalesStateSchema,
    suspendedAt: utcTimestampSchema.nullable(),
    cancelledAt: utcTimestampSchema.nullable(),
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
  })
  .superRefine(validateEvent)

export const createTicketTypeSchema = z
  .strictObject({
    eventId: entityIdSchema,
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(2_000).default(""),
    kind: z.enum(["free", "paid"]),
    priceMinor: minorAmountSchema,
    currency: currencySchema.default(policy.currency),
    quantity: z.int().positive(),
    salesStartAt: utcTimestampSchema,
    salesEndAt: utcTimestampSchema,
    hidden: z.boolean().default(false),
  })
  .superRefine((ticket, context) => {
    if (
      (ticket.kind === "free" && ticket.priceMinor !== 0) ||
      (ticket.kind === "paid" && ticket.priceMinor === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["priceMinor"],
        message:
          "Free tickets cost zero; paid tickets require a positive price",
      })
    }
    if (Date.parse(ticket.salesEndAt) <= Date.parse(ticket.salesStartAt)) {
      context.addIssue({
        code: "custom",
        path: ["salesEndAt"],
        message: "Ticket sales end must follow their start",
      })
    }
  })

export const createCampaignSchema = z
  .strictObject({
    eventId: entityIdSchema,
    name: z.string().trim().min(1).max(100),
    discount: discountSchema.default({
      kind: "percentage",
      basisPoints: 1_000,
    }),
    startsAt: utcTimestampSchema,
    endsAt: utcTimestampSchema,
    maxRedemptions: z
      .int()
      .positive()
      .default(policy.defaultCampaignRedemptionLimit),
    applicableTicketTypeIds: z.array(entityIdSchema).min(1),
    enabled: z.literal(false).default(false),
  })
  .superRefine((campaign, context) => {
    if (Date.parse(campaign.endsAt) <= Date.parse(campaign.startsAt)) {
      context.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "Campaign end must follow its start",
      })
    }
    if (
      new Set(campaign.applicableTicketTypeIds).size !==
      campaign.applicableTicketTypeIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["applicableTicketTypeIds"],
        message: "Each applicable ticket type must be listed once",
      })
    }
  })

export const checkoutItemSchema = z
  .strictObject({
    ticketTypeId: entityIdSchema,
    quantity: z.int().positive(),
    seatIds: z.array(entityIdSchema).min(1).optional(),
    attendeeNames: z.array(z.string().trim().min(1).max(200)).min(1),
  })
  .superRefine((item, context) => {
    if (item.attendeeNames.length !== item.quantity) {
      context.addIssue({
        code: "custom",
        path: ["attendeeNames"],
        message: "Provide one attendee name for each ticket",
      })
    }
    if (item.seatIds && item.seatIds.length !== item.quantity) {
      context.addIssue({
        code: "custom",
        path: ["seatIds"],
        message: "Provide one selected seat for each assigned ticket",
      })
    }
  })

/** Prices and discounts are resolved by the server, never supplied in this input. */
export const startCheckoutSchema = z
  .strictObject({
    requestId: requestIdSchema,
    eventId: entityIdSchema,
    items: z.array(checkoutItemSchema).min(1).max(100),
    promoCode: z.string().trim().min(1).max(128).optional(),
  })
  .superRefine((checkout, context) => {
    const ticketTypeIds = checkout.items.map((item) => item.ticketTypeId)
    if (new Set(ticketTypeIds).size !== ticketTypeIds.length) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Combine quantities for the same ticket type",
      })
    }
    const seatIds = checkout.items.flatMap((item) => item.seatIds ?? [])
    if (new Set(seatIds).size !== seatIds.length) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "A seat can occur only once in a checkout",
      })
    }
  })

export const seatSnapshotSchema = z.strictObject({
  seatId: entityIdSchema,
  section: z.string().min(1),
  row: z.string().min(1),
  number: z.string().min(1),
  accessible: z.boolean(),
})

export const orderItemSchema = z
  .strictObject({
    id: entityIdSchema,
    ticketTypeId: entityIdSchema,
    ticketTypeName: z.string().min(1),
    quantity: z.int().positive(),
    unitPriceMinor: minorAmountSchema,
    subtotalMinor: minorAmountSchema,
    discountMinor: minorAmountSchema,
    totalMinor: minorAmountSchema,
    currency: currencySchema,
    seats: z.array(seatSnapshotSchema),
  })
  .superRefine((item, context) => {
    if (
      BigInt(item.unitPriceMinor) * BigInt(item.quantity) !==
      BigInt(item.subtotalMinor)
    ) {
      context.addIssue({
        code: "custom",
        path: ["subtotalMinor"],
        message: "Subtotal must equal the snapshotted price times quantity",
      })
    }
    if (
      item.discountMinor > item.subtotalMinor ||
      item.totalMinor !== item.subtotalMinor - item.discountMinor
    ) {
      context.addIssue({
        code: "custom",
        path: ["totalMinor"],
        message: "Total must equal subtotal minus discount",
      })
    }
    if (
      item.seats.length > 0 &&
      (item.seats.length !== item.quantity ||
        new Set(item.seats.map((seat) => seat.seatId)).size !==
          item.seats.length)
    ) {
      context.addIssue({
        code: "custom",
        path: ["seats"],
        message: "Assigned tickets require one distinct seat each",
      })
    }
  })

export const reservationSchema = z
  .strictObject({
    id: entityIdSchema,
    accountId: entityIdSchema,
    eventId: entityIdSchema,
    state: reservationStateSchema,
    createdAt: utcTimestampSchema,
    expiresAt: utcTimestampSchema,
    paymentAttemptId: entityIdSchema.nullable(),
  })
  .refine(
    (reservation) =>
      Date.parse(reservation.expiresAt) - Date.parse(reservation.createdAt) ===
      policy.reservationDurationMs,
    {
      path: ["expiresAt"],
      message: "The reservation deadline is ten minutes after creation",
    }
  )

export const orderSchema = z
  .strictObject({
    id: entityIdSchema,
    accountId: entityIdSchema,
    eventId: entityIdSchema,
    state: orderStateSchema,
    currency: currencySchema,
    items: z.array(orderItemSchema).min(1),
    subtotalMinor: minorAmountSchema,
    discountMinor: minorAmountSchema,
    totalMinor: minorAmountSchema,
    processingFeeBasisPoints: z.int().min(0).max(10_000),
    processingFeeMinor: minorAmountSchema,
    campaignId: entityIdSchema.nullable(),
    refundPolicyVersion: z.string().min(1),
    createdAt: utcTimestampSchema,
    completedAt: utcTimestampSchema.nullable(),
  })
  .superRefine((order, context) => {
    for (const field of [
      "subtotalMinor",
      "discountMinor",
      "totalMinor",
    ] as const) {
      if (
        order.items.reduce((sum, item) => sum + BigInt(item[field]), 0n) !==
        BigInt(order[field])
      ) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Order totals must equal the sum of their item snapshots",
        })
      }
    }
    if (order.processingFeeMinor > order.totalMinor) {
      context.addIssue({
        code: "custom",
        path: ["processingFeeMinor"],
        message: "The processing fee cannot exceed the amount paid",
      })
    }
    if (
      (order.state === "completed" || order.state === "refunded") &&
      order.completedAt === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Completed orders retain their completion time",
      })
    }
  })

export const paymentAttemptSchema = z.strictObject({
  id: entityIdSchema,
  purpose: z.enum(["ticket_order", "event_activation"]),
  subjectId: entityIdSchema,
  state: paymentStateSchema,
  provider: z.enum(["polar_sandbox", "simulation"]),
  providerPaymentId: entityIdSchema.nullable(),
  idempotencyKey: requestIdSchema,
  amountMinor: z.int().positive(),
  currency: currencySchema,
  createdAt: utcTimestampSchema,
})

export const refundSchema = z.strictObject({
  id: entityIdSchema,
  paymentAttemptId: entityIdSchema,
  state: refundStateSchema,
  reason: z.enum([
    "voluntary",
    "event_cancelled",
    "technical_compensation",
    "activation_failed",
  ]),
  amountMinor: z.int().positive(),
  currency: currencySchema,
  idempotencyKey: requestIdSchema,
  createdAt: utcTimestampSchema,
  confirmedAt: utcTimestampSchema.nullable(),
})

/** The opaque admission credential is delivered separately from ticket summaries. */
export const ticketSchema = z.strictObject({
  id: entityIdSchema,
  orderId: entityIdSchema,
  eventId: entityIdSchema,
  ticketTypeId: entityIdSchema,
  attendeeName: z.string().min(1).max(200),
  state: ticketStateSchema,
  admissionBlocked: z.boolean(),
  seat: seatSnapshotSchema.nullable(),
})

export type CreateEvent = z.infer<typeof createEventSchema>
export type Event = z.infer<typeof eventSchema>
export type CreateTicketType = z.infer<typeof createTicketTypeSchema>
export type CreateCampaign = z.infer<typeof createCampaignSchema>
export type StartCheckout = z.infer<typeof startCheckoutSchema>
export type Order = z.infer<typeof orderSchema>
export type Ticket = z.infer<typeof ticketSchema>
export type PaymentAttempt = z.infer<typeof paymentAttemptSchema>
export type Refund = z.infer<typeof refundSchema>

export const paymentBindingSchema = z.strictObject({
  paymentAttemptId: entityIdSchema,
  purpose: z.enum(["ticket_order", "event_activation"]),
  subjectId: entityIdSchema,
  accountId: entityIdSchema,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  amountMinor: z.int().positive(),
  currency: currencySchema,
})

export const paymentCheckoutRequestSchema = paymentBindingSchema.extend({
  idempotencyKey: requestIdSchema,
  customerEmail: z.email(),
  successUrl: z.url(),
  returnUrl: z.url(),
})

export const providerCheckoutSchema = z.strictObject({
  /** Polar's checkout ID, consistently distinct from its order ID. */
  providerPaymentId: entityIdSchema,
  checkoutUrl: z.url(),
})

export const paymentLookupRequestSchema = z.strictObject({
  providerPaymentId: entityIdSchema,
  providerOrderId: entityIdSchema.optional(),
  expected: paymentBindingSchema,
})

export const providerPaymentStatusSchema = paymentBindingSchema.extend({
  providerPaymentId: entityIdSchema,
  providerOrderId: entityIdSchema.nullable(),
  state: paymentStateSchema,
  refundedAmountMinor: z.int().nonnegative(),
})

export const providerRefundRequestSchema = z.strictObject({
  refundId: entityIdSchema,
  providerPaymentId: entityIdSchema,
  providerOrderId: entityIdSchema,
  idempotencyKey: requestIdSchema,
  expected: paymentBindingSchema,
  amountMinor: z.int().positive(),
  currency: currencySchema,
  reason: refundSchema.shape.reason,
})

export const providerRefundStatusSchema = paymentBindingSchema.extend({
  providerPaymentId: entityIdSchema,
  providerOrderId: entityIdSchema,
  providerRefundId: entityIdSchema,
  refundId: entityIdSchema,
  state: refundStateSchema,
})

export const verifiedPaymentEventSchema = providerPaymentStatusSchema.extend({
  kind: z.literal("payment"),
  providerEventId: entityIdSchema,
})

export const verifiedRefundEventSchema = providerRefundStatusSchema.extend({
  kind: z.literal("refund"),
  providerEventId: entityIdSchema,
})

export const verifiedProviderEventSchema = z.discriminatedUnion("kind", [
  verifiedPaymentEventSchema,
  verifiedRefundEventSchema,
])

export type ProviderPaymentStatus = z.infer<typeof providerPaymentStatusSchema>
export type PaymentBinding = z.infer<typeof paymentBindingSchema>
export type PaymentCheckoutRequest = z.infer<
  typeof paymentCheckoutRequestSchema
>
export type ProviderCheckout = z.infer<typeof providerCheckoutSchema>
export type PaymentLookupRequest = z.infer<typeof paymentLookupRequestSchema>
export type ProviderRefundRequest = z.infer<typeof providerRefundRequestSchema>
export type ProviderRefundStatus = z.infer<typeof providerRefundStatusSchema>
export type VerifiedPaymentEvent = z.infer<typeof verifiedPaymentEventSchema>
export type VerifiedRefundEvent = z.infer<typeof verifiedRefundEventSchema>
export type VerifiedProviderEvent = z.infer<typeof verifiedProviderEventSchema>

export type ProviderErrorCode =
  | "INVALID_REQUEST"
  | "NOT_CONFIGURED"
  | "AMOUNT_UNSUPPORTED"
  | "PROVIDER_REJECTED"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "PAYMENT_MISMATCH"
  | "REFUND_MISMATCH"
  | "INVALID_WEBHOOK"
  | "RECONCILIATION_REQUIRED"

/** An uncertain outcome must be reconciled before another financial request. */
export class ProviderOperationError extends Error {
  readonly code: ProviderErrorCode
  readonly outcome: "definite_failure" | "uncertain"
  readonly httpStatus?: number
  readonly retryAfterSeconds?: number
  constructor(
    code: ProviderErrorCode,
    outcome: "definite_failure" | "uncertain",
    message: string,
    httpStatus?: number,
    retryAfterSeconds?: number
  ) {
    super(message)
    this.name = "ProviderOperationError"
    this.code = code
    this.outcome = outcome
    this.httpStatus = httpStatus
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/** Providers report payment facts; only the API commits orders and ticket issuance. */
export interface PaymentAdapter {
  createCheckout(request: PaymentCheckoutRequest): Promise<ProviderCheckout>
  /** A null result is not proof that a previous POST did not reach the provider. */
  recoverCheckout(
    request: PaymentCheckoutRequest
  ): Promise<ProviderCheckout | null>
  lookupPayment(request: PaymentLookupRequest): Promise<ProviderPaymentStatus>
  refund(request: ProviderRefundRequest): Promise<ProviderRefundStatus>
  lookupRefund(
    request: ProviderRefundRequest
  ): Promise<ProviderRefundStatus | null>
  /** Verify and normalize signed facts without network I/O; the API compares its frozen binding. */
  verifyWebhook(
    body: string,
    headers: Readonly<Record<string, string>>
  ): Promise<VerifiedProviderEvent | null>
}
