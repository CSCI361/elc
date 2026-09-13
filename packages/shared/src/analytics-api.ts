import { z } from "zod"
import { entityIdSchema } from "./common"

export const calendarDateSchema = z.iso.date().refine((date) => {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  )
}, "Use a valid calendar date.")

export const eventAnalyticsQuerySchema = z
  .object({
    range: z.enum(["7", "30", "custom"]).default("30"),
    start: calendarDateSchema.optional(),
    end: calendarDateSchema.optional(),
    ticketTypeId: entityIdSchema.optional(),
    typeAfter: entityIdSchema.optional(),
    campaignAfter: entityIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .superRefine((input, ctx) => {
    if (
      input.range === "custom"
        ? !input.start || !input.end
        : input.start || input.end
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Custom reports require a start and end date; presets use today's date.",
      })
  })

const count = z.int().nonnegative()
export const salesMetricsSchema = z.object({
  completedOrders: count,
  ticketsIssued: count,
  grossMinor: count,
  discountMinor: count,
  refundedTickets: count,
  ticketRefundMinor: count,
  netTicketRevenueMinor: z.int(),
  processingFeeMinor: count,
  processingFeeReversalMinor: count,
  estimatedPayoutMinor: z.int(),
  committedRedemptions: count,
})

export const eventAnalyticsResponseSchema = z.object({
  eventId: z.string(),
  eventTitle: z.string(),
  reportingId: z.string(),
  timeZone: z.string(),
  currency: z.literal("KZT"),
  simulation: z.literal(true),
  generatedAt: z.iso.datetime(),
  period: z.object({
    start: calendarDateSchema,
    end: calendarDateSchema,
    startAt: z.iso.datetime(),
    endExclusiveAt: z.iso.datetime(),
    dayCount: z.int().min(1).max(180),
    ticketTypeId: z.string().nullable(),
    refundBasis: z.literal("confirmation_date"),
    feeAllocation: z.literal("frozen_rate_largest_remainder"),
  }),
  current: z.object({
    asOf: z.iso.datetime(),
    capacity: count,
    enabledInventory: count,
    remainingInventory: count,
    reservedInventory: count,
    issuedTickets: count,
    nonCancelledNonRefundedTickets: count,
    cancelledTickets: count,
    refundedTickets: count,
    soldPercent: z.number().nonnegative(),
    eligibleAttendance: count,
    confirmedAttendance: count,
    absent: count,
    attendancePercent: z.number().min(0).max(100),
    unresolvedOfflineReports: count,
    unsynchronizedOfflineCount: z.null(),
  }),
  summary: salesMetricsSchema,
  otherPayments: z.object({
    scope: z.literal("event_all_ticket_types"),
    activationFeesMinor: count,
    activationRefundsMinor: count,
    unfulfilledCompensationMinor: count,
    attendeeProcessingChargesMinor: z.literal(0),
    refundedAttendeeChargesMinor: z.literal(0),
  }),
  daily: z
    .array(salesMetricsSchema.extend({ date: calendarDateSchema }))
    .max(180),
  ticketTypes: z
    .array(salesMetricsSchema.extend({ id: z.string(), name: z.string() }))
    .max(50),
  campaigns: z
    .array(
      salesMetricsSchema.extend({
        id: z.string(),
        name: z.string(),
        reportingId: z.string(),
      })
    )
    .max(50),
  nextTypeCursor: z.string().nullable(),
  nextCampaignCursor: z.string().nullable(),
})

export type EventAnalyticsQuery = z.infer<typeof eventAnalyticsQuerySchema>
export type SalesMetrics = z.infer<typeof salesMetricsSchema>
export type EventAnalyticsResponse = z.infer<
  typeof eventAnalyticsResponseSchema
>

export const analyticsEventsQuerySchema = z.object({
  after: entityIdSchema.optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
export const analyticsEventsResponseSchema = z.object({
  items: z
    .array(
      z.object({
        id: entityIdSchema,
        title: z.string(),
        timeZone: z.string(),
        reportingId: z.string(),
        startsAt: z.iso.datetime(),
        endsAt: z.iso.datetime(),
      })
    )
    .max(50),
  nextCursor: z.string().nullable(),
})
