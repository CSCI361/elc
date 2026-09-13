import { z } from "zod"
import { entityIdSchema, requestIdSchema, utcTimestampSchema } from "./common"
import { eventApiSchema, eventMutationResponseSchema } from "./events-api"
import { calendarDateSchema } from "./analytics-api"

const page = {
  cursor: z.string().max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}
export const historyActivityTypeSchema = z.enum([
  "event",
  "ticket_type",
  "campaign",
  "permission",
  "activation",
  "moderation",
  "payment",
  "refund",
  "checkin",
  "support",
  "payout",
  "offline",
  "other",
])
export const organizerHistoryQuerySchema = z
  .strictObject({
    ...page,
    phase: z.enum(["completed", "cancelled"]).optional(),
    q: z.string().trim().max(200).optional(),
    start: calendarDateSchema.optional(),
    end: calendarDateSchema.optional(),
  })
  .superRefine((input, ctx) => {
    if (Boolean(input.start) !== Boolean(input.end))
      ctx.addIssue({ code: "custom", message: "Provide both history dates." })
  })
export const eventHistoryQuerySchema = z
  .strictObject({
    ...page,
    range: z.enum(["7", "30", "custom"]).default("30"),
    start: calendarDateSchema.optional(),
    end: calendarDateSchema.optional(),
    activityType: historyActivityTypeSchema.optional(),
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
          "Custom history requires both dates; presets use the latest event activity.",
      })
  })
export const historyRetentionSchema = z.strictObject({
  expiresAt: utcTimestampSchema,
  held: z.boolean(),
  holdReasons: z.array(
    z.enum([
      "refund",
      "payment_reconciliation",
      "financial_case",
      "reported_admission",
    ])
  ),
})
export const organizerHistoryResponseSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      event: eventApiSchema,
      retention: historyRetentionSchema,
      canDuplicate: z.boolean(),
    })
  ),
  timeZone: z.string(),
  nextCursor: z.string().nullable(),
})
export const eventHistoryResponseSchema = z.strictObject({
  event: eventApiSchema,
  retention: historyRetentionSchema,
  canDuplicate: z.boolean(),
  timeZone: z.string(),
  period: z.strictObject({
    start: calendarDateSchema,
    end: calendarDateSchema,
  }),
  items: z.array(
    z.strictObject({
      id: entityIdSchema,
      createdAt: utcTimestampSchema,
      actorId: z.string().nullable(),
      actorName: z.string().nullable(),
      actorType: z.enum(["user", "system", "unknown"]),
      action: z.string(),
      activityType: historyActivityTypeSchema,
      entityId: z.string(),
      description: z.string(),
      correlationId: z.string(),
    })
  ),
  nextCursor: z.string().nullable(),
})
export const duplicatePastEventSchema = z
  .strictObject({
    requestId: requestIdSchema,
    expectedRevision: z.int().nonnegative(),
    startsAt: utcTimestampSchema,
    endsAt: utcTimestampSchema,
    registrationOpensAt: utcTimestampSchema,
    registrationClosesAt: utcTimestampSchema,
  })
  .superRefine((input, ctx) => {
    const start = Date.parse(input.startsAt),
      end = Date.parse(input.endsAt),
      open = Date.parse(input.registrationOpensAt),
      close = Date.parse(input.registrationClosesAt)
    if (!(end > start && close > open && close <= start))
      ctx.addIssue({
        code: "custom",
        message:
          "End must follow start; registration must close after opening and no later than the event starts.",
      })
  })
export const duplicatePastEventResponseSchema =
  eventMutationResponseSchema.extend({ sourceEventId: entityIdSchema })
export type OrganizerHistoryQuery = z.infer<typeof organizerHistoryQuerySchema>
export type EventHistoryQuery = z.infer<typeof eventHistoryQuerySchema>
export type DuplicatePastEvent = z.infer<typeof duplicatePastEventSchema>

export type HistoryActivityType = z.infer<typeof historyActivityTypeSchema>
