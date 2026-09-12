import { z } from "zod"
import { entityIdSchema, paginatedSchema, requestIdSchema } from "./common"
import { admissionPayloadSchema, scanResultSchema } from "./operations"
import { ticketSchema } from "./ticketing"

export const completeOrderSchema = z.strictObject({
  requestId: requestIdSchema,
  expectedRevision: z.int().nonnegative(),
})

export const completedOrderResponseSchema = z.strictObject({
  orderId: entityIdSchema,
  state: z.literal("completed"),
  ticketIds: z.array(entityIdSchema).min(1),
})

export const ticketDetailResponseSchema = z.strictObject({
  ticket: ticketSchema,
})
export const orderTicketsResponseSchema = paginatedSchema(ticketSchema)
export const ticketCredentialResponseSchema = z.strictObject({
  ticket: ticketSchema,
  credential: admissionPayloadSchema,
})

export const scanResponseSchema = z.strictObject({
  operationId: requestIdSchema,
  result: scanResultSchema,
  checkInId: entityIdSchema.nullable(),
})

export const reverseCheckInSchema = z.strictObject({
  requestId: requestIdSchema,
  reason: z.string().trim().min(1).max(1000),
})

export type CompleteOrder = z.infer<typeof completeOrderSchema>
export type CompletedOrderResponse = z.infer<
  typeof completedOrderResponseSchema
>
export type ScanResponse = z.infer<typeof scanResponseSchema>
