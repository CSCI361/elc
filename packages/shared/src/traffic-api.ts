import { z } from "zod"
import { calendarDateSchema } from "./analytics-api"
import { reportingIdSchema } from "./operations"

const counts = z.strictObject({
  pageViews: z.int().nonnegative(),
  eventViews: z.int().nonnegative(),
  campaignVisits: z.int().nonnegative(),
  checkoutStarts: z.int().nonnegative(),
})
export const ga4AvailableSchema = z.strictObject({
  status: z.literal("available"),
  source: z.literal("ga4"),
  eventReportingId: reportingIdSchema,
  period: z.strictObject({
    range: z.enum(["7", "30", "custom"]),
    start: calendarDateSchema,
    end: calendarDateSchema,
    dayCount: z.int().min(1).max(180),
  }),
  timeZone: z.literal("Asia/Almaty"),
  currency: z.literal("KZT"),
  currencyVerified: z.boolean(),
  fetchedAt: z.iso.datetime(),
  dataAsOf: z.null(),
  processingDelayPossible: z.literal(true),
  quality: z.strictObject({
    subjectToThresholding: z.boolean(),
    sampled: z.boolean(),
    dataLossFromOtherRow: z.boolean(),
  }),
  totals: counts,
  daily: z.array(counts.extend({ date: calendarDateSchema })).max(180),
  campaigns: z
    .array(counts.extend({ campaignReportingId: reportingIdSchema }))
    .max(50),
})
export const ga4UnavailableSchema = z.strictObject({
  status: z.literal("unavailable"),
  source: z.literal("ga4"),
  reason: z.enum([
    "not_configured",
    "invalid_configuration",
    "invalid_request",
    "clock_error",
    "authorization_failed",
    "rate_limited",
    "provider_unavailable",
    "timeout",
    "redirect_blocked",
    "invalid_response",
    "property_mismatch",
    "data_unavailable",
  ]),
  retryable: z.boolean(),
  retryAfterSeconds: z.int().nonnegative().nullable(),
  checkedAt: z.iso.datetime().nullable(),
})
export const trafficResponseSchema = z.strictObject({
  eventId: z.string(),
  eventTimeZone: z.string(),
  scope: z.literal("event_all_ticket_types"),
  cache: z.enum(["fresh", "cached", "unavailable"]),
  result: z.discriminatedUnion("status", [
    ga4AvailableSchema,
    ga4UnavailableSchema,
  ]),
})
export type TrafficResponse = z.infer<typeof trafficResponseSchema>
