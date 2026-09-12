import { z } from "zod"
import { currencySchema, entityIdSchema, requestIdSchema } from "./common"
import { paymentStateSchema, refundStateSchema } from "./states"

export const startPaymentSchema = z.strictObject({
  requestId: requestIdSchema,
  expectedRevision: z.int().nonnegative(),
})

export const paymentResponseSchema = z.strictObject({
  payment: z.strictObject({
    id: entityIdSchema,
    purpose: z.enum(["ticket_order", "event_activation"]),
    subjectId: entityIdSchema,
    state: paymentStateSchema,
    dispatchState: z.enum([
      "prepared",
      "dispatched",
      "uncertain",
      "reconciled",
    ]),
    amountMinor: z.int().positive(),
    currency: currencySchema,
    checkoutUrl: z.url().nullable(),
    refundState: refundStateSchema.nullable(),
  }),
})

export type StartPayment = z.infer<typeof startPaymentSchema>
export type PaymentResponse = z.infer<typeof paymentResponseSchema>
