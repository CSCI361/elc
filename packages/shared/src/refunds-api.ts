import { z } from "zod"
import { entityIdSchema, requestIdSchema, utcTimestampSchema } from "./common"
import { refundPolicySnapshotSchema } from "./checkout-api"
import { orderStateSchema } from "./states"
import { refundSchema } from "./ticketing"

export const cancelRegistrationSchema = z.strictObject({
  requestId: requestIdSchema,
  expectedRevision: z.int().nonnegative(),
  reason: z.string().trim().min(3).max(500),
})
export const approveOrderRefundSchema = cancelRegistrationSchema.extend({
  caseId: entityIdSchema,
})
export const orderCancellationResponseSchema = z.strictObject({
  orderId: entityIdSchema,
  revision: z.int().nonnegative(),
  state: z.literal("cancelled"),
})
export const refundApprovalResponseSchema = z.strictObject({
  orderId: entityIdSchema,
  refundId: entityIdSchema,
  revision: z.int().nonnegative(),
  state: z.literal("pending"),
})
export const orderRefundResponseSchema = z.strictObject({
  orderId: entityIdSchema,
  eventId: entityIdSchema,
  revision: z.int().nonnegative(),
  orderState: orderStateSchema,
  admissionBlocked: z.boolean(),
  canApprove: z.boolean(),
  voluntaryEligible: z.boolean(),
  totalMinor: z.int().nonnegative(),
  originalProcessingFeeMinor: z.int().nonnegative(),
  remainingProcessingFeeMinor: z.int().nonnegative(),
  estimatedPayoutContributionMinor: z.int().nonnegative(),
  payoutHeld: z.boolean(),
  refundPolicy: refundPolicySnapshotSchema,
  refund: refundSchema
    .omit({ idempotencyKey: true })
    .extend({
      requestedBy: entityIdSchema.nullable(),
      supportCaseId: entityIdSchema.nullable(),
      authorizationReason: z.string().nullable(),
      updatedAt: utcTimestampSchema,
      reconciliationRequired: z.boolean(),
    })
    .nullable(),
})
export type RefundApprovalResponse = z.infer<
  typeof refundApprovalResponseSchema
>
export type OrderCancellationResponse = z.infer<
  typeof orderCancellationResponseSchema
>
export type OrderRefundResponse = z.infer<typeof orderRefundResponseSchema>
