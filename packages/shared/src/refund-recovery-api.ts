import { z } from "zod"
import { entityIdSchema, requestIdSchema, utcTimestampSchema } from "./common"

export const refundRecoveryActionSchema = z.enum([
  "reconcile",
  "retry_rejected",
])
export const requestRefundRecoverySchema = z.strictObject({
  requestId: requestIdSchema,
  expectedUpdatedAt: utcTimestampSchema,
  action: refundRecoveryActionSchema,
  reason: z.string().trim().min(3).max(500),
})
export const refundRecoveryResponseSchema = z.strictObject({
  refundId: entityIdSchema,
  recoveryId: entityIdSchema,
  action: refundRecoveryActionSchema,
  state: z.literal("queued"),
})
export const refundRecoveryViewSchema = z.strictObject({
  refundId: entityIdSchema,
  eventId: entityIdSchema,
  state: z.enum(["pending", "succeeded", "failed"]),
  updatedAt: utcTimestampSchema,
  canRetryRejected: z.boolean(),
  canReconcile: z.boolean(),
  recoveryPending: z.boolean(),
})
