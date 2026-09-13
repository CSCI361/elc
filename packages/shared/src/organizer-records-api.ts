import { z } from "zod"
import { entityIdSchema, utcTimestampSchema } from "./common"
import { historyRetentionSchema } from "./history-api"
import {
  orderStateSchema,
  refundStateSchema,
  ticketStateSchema,
} from "./states"
import { seatSnapshotSchema } from "./ticketing"

export const organizerRecordsQuerySchema = z.strictObject({
  kind: z.enum(["orders", "tickets", "checkins"]).default("tickets"),
  q: z.string().trim().max(200).default(""),
  orderId: entityIdSchema.optional(),
  ticketId: entityIdSchema.optional(),
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
const page = {
  event: z.strictObject({
    id: entityIdSchema,
    title: z.string(),
    timeZone: z.string(),
  }),
  retention: historyRetentionSchema,
  capabilities: z.strictObject({
    manage: z.boolean(),
    history: z.boolean(),
    analytics: z.boolean(),
    support: z.boolean(),
    refund: z.boolean(),
  }),
  nextCursor: z.string().nullable(),
  generatedAt: utcTimestampSchema,
}
const order = z.strictObject({
  id: entityIdSchema,
  state: orderStateSchema,
  revision: z.int().nonnegative(),
  createdAt: utcTimestampSchema,
  completedAt: utcTimestampSchema.nullable(),
  quantity: z.int().nonnegative(),
  subtotalMinor: z.int().nonnegative(),
  discountMinor: z.int().nonnegative(),
  totalMinor: z.int().nonnegative(),
  processingFeeMinor: z.int().nonnegative(),
  currency: z.literal("KZT"),
  campaignId: entityIdSchema.nullable(),
  campaignName: z.string().nullable(),
  admissionBlocked: z.boolean(),
  refundState: refundStateSchema.nullable(),
  refundAmountMinor: z.int().nonnegative().nullable(),
  ticketCount: z.int().nonnegative(),
})
const ticket = z.strictObject({
  id: entityIdSchema,
  orderId: entityIdSchema,
  attendeeName: z.string(),
  ticketTypeName: z.string(),
  state: ticketStateSchema,
  createdAt: utcTimestampSchema,
  seat: seatSnapshotSchema.nullable(),
  admissionBlocked: z.boolean(),
  activeCheckinId: entityIdSchema.nullable(),
  activeCheckinAt: utcTimestampSchema.nullable(),
  unresolvedOfflineAdmission: z.boolean(),
})
const checkin = z.strictObject({
  id: entityIdSchema,
  ticketId: entityIdSchema,
  orderId: entityIdSchema,
  attendeeName: z.string(),
  seat: seatSnapshotSchema.nullable(),
  capturedAt: utcTimestampSchema,
  committedAt: utcTimestampSchema,
  reversedAt: utcTimestampSchema.nullable(),
  reversedBy: z.string().nullable(),
  reversalReason: z.string().nullable(),
})
export const organizerRecordsResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...page,
    kind: z.literal("orders"),
    items: z.array(order).max(50),
  }),
  z.strictObject({
    ...page,
    kind: z.literal("tickets"),
    items: z.array(ticket).max(50),
  }),
  z.strictObject({
    ...page,
    kind: z.literal("checkins"),
    items: z.array(checkin).max(50),
  }),
])
export type OrganizerRecordsQuery = z.infer<typeof organizerRecordsQuerySchema>
export type OrganizerRecordsResponse = z.infer<
  typeof organizerRecordsResponseSchema
>
export type OrganizerRecordsKind = OrganizerRecordsResponse["kind"]
