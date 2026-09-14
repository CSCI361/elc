import { z } from "zod"
import { entityIdSchema, requestIdSchema, utcTimestampSchema } from "./common"

export const eventReportCategorySchema = z.enum([
  "misleading",
  "prohibited",
  "fraud",
  "safety",
  "other",
])
export const eventReportStateSchema = z.enum(["open", "dismissed", "actioned"])
export const eventReportResolutionKindSchema = z.enum(["dismissed", "actioned"])

export const submitEventReportRequestSchema = z.strictObject({
  requestId: requestIdSchema,
  category: eventReportCategorySchema,
  details: z.string().trim().min(1).max(1_000),
})

export const eventReportReceiptSchema = z.strictObject({
  reportId: entityIdSchema,
  eventId: entityIdSchema,
  category: eventReportCategorySchema,
  state: eventReportStateSchema,
  revision: z.int().positive(),
  updatedAt: utcTimestampSchema,
})

export const eventReportQueueQuerySchema = z.strictObject({
  state: z.enum(["open", "dismissed", "actioned", "all"]).default("open"),
  eventId: entityIdSchema.optional(),
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export const eventReportQueueResponseSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: entityIdSchema,
        eventId: entityIdSchema,
        eventTitle: z.string(),
        organizerId: entityIdSchema,
        eventSuspended: z.boolean(),
        eventRevision: z.int().nonnegative(),
        reporterId: entityIdSchema,
        category: eventReportCategorySchema,
        details: z.string(),
        state: eventReportStateSchema,
        openReportsForEvent: z.int().nonnegative(),
        revision: z.int().positive(),
        createdAt: utcTimestampSchema,
        updatedAt: utcTimestampSchema,
        resolvedAt: utcTimestampSchema.nullable(),
        resolutionReason: z.string().nullable(),
      })
    )
    .max(50),
  nextCursor: z.string().max(2048).nullable(),
  generatedAt: utcTimestampSchema,
})

export const resolveEventReportRequestSchema = z.strictObject({
  requestId: requestIdSchema,
  expectedRevision: z.int().positive(),
  resolution: eventReportResolutionKindSchema,
  reason: z.string().trim().min(1).max(500),
})

export const eventReportResolutionSchema = z.strictObject({
  reportId: entityIdSchema,
  eventId: entityIdSchema,
  state: eventReportResolutionKindSchema,
  revision: z.int().positive(),
  resolvedAt: utcTimestampSchema,
})

export type EventReportCategory = z.infer<typeof eventReportCategorySchema>
export type EventReportReceipt = z.infer<typeof eventReportReceiptSchema>
export type EventReportQueueQuery = z.infer<typeof eventReportQueueQuerySchema>
export type EventReportQueueResponse = z.infer<
  typeof eventReportQueueResponseSchema
>
export type EventReportResolution = z.infer<typeof eventReportResolutionSchema>
