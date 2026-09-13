import { z } from "zod"
import { entityIdSchema, requestIdSchema, utcTimestampSchema } from "./common"

export const deliveryIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/)
export const deliveryEmailStateSchema = z.enum([
  "pending",
  "accepted",
  "delivered",
  "bounced",
  "failed",
  "suppressed",
  "review_needed",
])
export const deliveryPdfStateSchema = z.enum([
  "not_required",
  "pending",
  "ready",
  "failed",
])
export const deliveryRecoveryModeSchema = z.enum([
  "retry_preparation",
  "retry_same_request",
  "reconcile",
])
const kindSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_.-]*$/)
export const deliveryListQuerySchema = z.strictObject({
  after: deliveryIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  emailState: deliveryEmailStateSchema.optional(),
  pdfState: deliveryPdfStateSchema.optional(),
  kind: kindSchema.optional(),
  eventId: entityIdSchema.optional(),
})
export const deliveryInspectionSchema = z.strictObject({
  id: deliveryIdSchema,
  sourceId: z.string().min(1).max(256),
  kind: kindSchema,
  entityId: z.string().min(1).max(256),
  eventId: entityIdSchema.nullable(),
  recipientId: entityIdSchema,
  pdfState: deliveryPdfStateSchema,
  emailState: deliveryEmailStateSchema,
  providerId: z.string().min(1).max(256).nullable(),
  providerStatus: z
    .enum([
      "accepted",
      "local",
      "bounced",
      "canceled",
      "clicked",
      "complained",
      "delivered",
      "delivery_delayed",
      "failed",
      "opened",
      "queued",
      "scheduled",
      "sent",
      "suppressed",
    ])
    .nullable(),
  firstAttemptAt: utcTimestampSchema.nullable(),
  lastAttemptAt: utcTimestampSchema.nullable(),
  attempts: z.int().nonnegative(),
  failures: z.int().nonnegative(),
  lastError: z
    .string()
    .regex(/^[A-Z0-9_]{1,100}$/)
    .nullable(),
  createdAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema,
  completedAt: utcTimestampSchema.nullable(),
  nextAttemptAt: utcTimestampSchema,
  busyUntil: utcTimestampSchema.nullable(),
  allowedRecoveryModes: z.array(deliveryRecoveryModeSchema).max(3),
})
export const deliveryListResponseSchema = z.strictObject({
  items: z.array(deliveryInspectionSchema).max(50),
  nextCursor: deliveryIdSchema.nullable(),
})
export const deliveryDetailResponseSchema = z.strictObject({
  delivery: deliveryInspectionSchema,
})
export const requestDeliveryRecoverySchema = z.strictObject({
  requestId: requestIdSchema,
  reason: z.string().trim().min(3).max(500),
  expectedUpdatedAt: utcTimestampSchema,
  mode: deliveryRecoveryModeSchema,
})
export const deliveryRecoveryResponseSchema = z.strictObject({
  deliveryId: deliveryIdSchema,
  requestId: requestIdSchema,
  mode: deliveryRecoveryModeSchema,
  state: z.literal("queued"),
  updatedAt: utcTimestampSchema,
})
export type DeliveryInspection = z.infer<typeof deliveryInspectionSchema>
export type DeliveryListQuery = z.infer<typeof deliveryListQuerySchema>
export type DeliveryRecoveryMode = z.infer<typeof deliveryRecoveryModeSchema>
export type DeliveryRecoveryRequest = z.infer<
  typeof requestDeliveryRecoverySchema
>
export type DeliveryRecoveryResponse = z.infer<
  typeof deliveryRecoveryResponseSchema
>
