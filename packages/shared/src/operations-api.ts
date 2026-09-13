import { z } from "zod"
import { entityIdSchema, utcTimestampSchema } from "./common"
import { historyRetentionSchema } from "./history-api"
import {
  orderStateSchema,
  paymentStateSchema,
  refundStateSchema,
} from "./states"

export const operationsQuerySchema = z.strictObject({
  kind: z.enum(["orders", "payments", "audit"]).default("orders"),
  q: z.string().trim().max(200).default(""),
  eventId: entityIdSchema.optional(),
  accountId: entityIdSchema.optional(),
  after: entityIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
const record = {
  id: entityIdSchema,
  createdAt: utcTimestampSchema,
  retention: historyRetentionSchema,
}
const order = z.strictObject({
  ...record,
  eventId: entityIdSchema,
  accountId: entityIdSchema,
  state: orderStateSchema,
  totalMinor: z.int().nonnegative(),
  discountMinor: z.int().nonnegative(),
  processingFeeMinor: z.int().nonnegative(),
  currency: z.literal("KZT"),
})
const payment = z.strictObject({
  ...record,
  eventId: entityIdSchema,
  actorId: entityIdSchema.nullable(),
  subjectId: entityIdSchema,
  purpose: z.enum(["ticket_order", "event_activation"]),
  state: paymentStateSchema,
  dispatchState: z.enum(["prepared", "dispatched", "uncertain", "reconciled"]),
  providerPaymentId: z.string().nullable(),
  providerOrderId: z.string().nullable(),
  amountMinor: z.int().positive(),
  currency: z.literal("KZT"),
  refundState: refundStateSchema.nullable(),
  refundAmountMinor: z.int().nonnegative().nullable(),
})
const audit = z.strictObject({
  ...record,
  eventId: entityIdSchema.nullable(),
  actorId: z.string().nullable(),
  scope: z.enum(["event", "account", "platform"]),
  action: z.string(),
  entityId: z.string(),
  description: z.string(),
  correlationId: z.string(),
})
const page = {
  nextCursor: entityIdSchema.nullable(),
  generatedAt: utcTimestampSchema,
}
export const operationsResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...page,
    kind: z.literal("orders"),
    items: z.array(order).max(50),
  }),
  z.strictObject({
    ...page,
    kind: z.literal("payments"),
    items: z.array(payment).max(50),
  }),
  z.strictObject({
    ...page,
    kind: z.literal("audit"),
    items: z.array(audit).max(50),
  }),
])
export type OperationsResponse = z.infer<typeof operationsResponseSchema>
export type OperationsKind = OperationsResponse["kind"]
