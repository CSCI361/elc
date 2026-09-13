import { z } from "zod"
import {
  calendarDateSchema,
  eventAnalyticsResponseSchema,
  salesMetricsSchema,
} from "./analytics-api"
import { entityIdSchema } from "./common"

export const organizerAnalyticsOverviewQuerySchema = z
  .strictObject({
    range: z.enum(["7", "30", "custom"]).default("30"),
    start: calendarDateSchema.optional(),
    end: calendarDateSchema.optional(),
    q: z.string().trim().max(200).optional(),
    cursor: z.string().max(2048).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .superRefine((input, context) => {
    if (
      input.range === "custom"
        ? !input.start || !input.end
        : input.start || input.end
    )
      context.addIssue({
        code: "custom",
        message: "Custom reports require both dates; presets use today's date.",
      })
  })
const count = z.int().nonnegative()
const otherPayments = z.strictObject({
  activationFeesMinor: count,
  activationRefundsMinor: count,
  unfulfilledCompensationMinor: count,
  attendeeProcessingChargesMinor: z.literal(0),
  refundedAttendeeChargesMinor: z.literal(0),
})
const payouts = z.strictObject({
  completedCount: count,
  completedMinor: count,
  adjustmentCount: count,
  adjustmentMinor: z.int().nonpositive(),
  netMinor: z.int(),
})
const measures = { summary: salesMetricsSchema, otherPayments, payouts }
export const organizerAnalyticsOverviewResponseSchema = z.strictObject({
  timeZone: z.literal("Asia/Almaty"),
  currency: z.literal("KZT"),
  simulation: z.literal(true),
  generatedAt: z.iso.datetime(),
  scope: z.strictObject({
    eventCount: count,
    q: z.string(),
    basis: z.literal("all_currently_authorized_matching_events"),
  }),
  period: z.strictObject({
    start: calendarDateSchema,
    end: calendarDateSchema,
    dayCount: z.int().min(1).max(180),
    startAt: z.iso.datetime(),
    endExclusiveAt: z.iso.datetime(),
    refundBasis: z.literal("confirmation_date"),
    feeBasis: z.literal("frozen_order_fee"),
    payoutBasis: z.literal("recorded_date"),
  }),
  ...measures,
  current: eventAnalyticsResponseSchema.shape.current,
  daily: z
    .array(z.strictObject({ date: calendarDateSchema, ...measures }))
    .max(180),
  events: z
    .array(
      z.strictObject({
        id: entityIdSchema,
        title: z.string(),
        timeZone: z.string(),
        reportingId: z.string(),
        startsAt: z.iso.datetime(),
        endsAt: z.iso.datetime(),
        reportHref: z.string(),
        ...measures,
        current: eventAnalyticsResponseSchema.shape.current,
      })
    )
    .max(50),
  nextCursor: z.string().nullable(),
})
export type OrganizerAnalyticsOverviewQuery = z.infer<
  typeof organizerAnalyticsOverviewQuerySchema
>
export type OrganizerAnalyticsOverviewResponse = z.infer<
  typeof organizerAnalyticsOverviewResponseSchema
>
