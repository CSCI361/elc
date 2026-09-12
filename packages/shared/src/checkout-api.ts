import { z } from "zod"
import { entityIdSchema, requestIdSchema } from "./common"
import {
  orderSchema,
  reservationSchema,
  startCheckoutSchema,
} from "./ticketing"

export const replaceCheckoutSchema = startCheckoutSchema.safeExtend({
  expectedRevision: z.int().nonnegative(),
})

export const abandonCheckoutSchema = z.strictObject({
  requestId: requestIdSchema,
  expectedRevision: z.int().nonnegative(),
})

export const refundPolicySnapshotSchema = z.strictObject({
  version: z.literal("academic-v1"),
  instructions: z.string(),
  fullRefundOnly: z.literal(true),
  voluntaryBeforeEventStart: z.literal(true),
  requiresNoAdmission: z.literal(true),
  automaticEventCancellation: z.literal(true),
  technicalCompensation: z.literal(true),
})

export const checkoutResponseSchema = z.strictObject({
  order: orderSchema,
  revision: z.int().nonnegative(),
  refundPolicy: refundPolicySnapshotSchema,
  reservation: reservationSchema,
  attendees: z.array(
    z.strictObject({
      orderItemId: entityIdSchema,
      names: z.array(z.string().min(1).max(200)).min(1),
    })
  ),
})

export type ReplaceCheckout = z.infer<typeof replaceCheckoutSchema>
export type AbandonCheckout = z.infer<typeof abandonCheckoutSchema>
export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>
export type RefundPolicySnapshot = z.infer<typeof refundPolicySnapshotSchema>
