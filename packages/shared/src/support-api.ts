import { z } from "zod"
import {
  entityIdSchema,
  paginationQuerySchema,
  requestIdSchema,
  utcTimestampSchema,
} from "./common"

export const supportAudienceSchema = z.enum(["attendee", "organizer_platform"])
export const supportStatusSchema = z.enum([
  "open",
  "in_progress",
  "waiting_for_customer",
  "resolved",
])
export const supportIssueCategorySchema = z.enum([
  "ticket_delivery",
  "payment",
  "refund",
  "seating",
  "event_information",
  "check_in",
  "account",
  "activation",
  "technical",
  "dispute",
  "compensation",
])
const sequence = z.int().min(1).max(Number.MAX_SAFE_INTEGER)
const body = z.string().trim().min(1).max(8000)
export const openSupportCaseSchema = z.strictObject({
  requestId: requestIdSchema,
  audience: supportAudienceSchema,
  category: supportIssueCategorySchema,
  subject: z.string().trim().min(1).max(160),
  eventId: entityIdSchema.optional(),
  orderId: entityIdSchema.optional(),
  ticketId: entityIdSchema.optional(),
  body,
})
export const supportRevisionSchema = z.strictObject({
  requestId: requestIdSchema,
  expectedRevision: sequence,
})
export const addSupportMessageSchema = supportRevisionSchema.extend({ body })
export const assignSupportCaseSchema = supportRevisionSchema.extend({
  assigneeId: entityIdSchema.nullable(),
})
export const changeSupportStatusSchema = supportRevisionSchema.extend({
  status: supportStatusSchema,
})
export const supportCaseApiSchema = z.strictObject({
  id: entityIdSchema,
  requesterId: entityIdSchema,
  audience: supportAudienceSchema,
  category: supportIssueCategorySchema,
  subject: z.string(),
  eventId: entityIdSchema.nullable(),
  orderId: entityIdSchema.nullable(),
  ticketId: entityIdSchema.nullable(),
  assigneeId: entityIdSchema.nullable(),
  status: supportStatusSchema,
  revision: sequence,
  lastSequence: sequence,
  createdAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema,
  resolvedAt: utcTimestampSchema.nullable(),
  payoutHeld: z.boolean(),
})
export const supportMessageApiSchema = z.strictObject({
  id: entityIdSchema,
  caseId: entityIdSchema,
  sequence,
  authorId: entityIdSchema,
  authorName: z.string(),
  body: z.string(),
  createdAt: utcTimestampSchema,
})
export const supportStateSnapshotSchema = z.strictObject({
  status: supportStatusSchema,
  assigneeId: entityIdSchema.nullable(),
})
export const supportCaseChangeApiSchema = z.strictObject({
  id: entityIdSchema,
  caseId: entityIdSchema,
  sequence,
  actorId: entityIdSchema,
  kind: z.enum(["created", "message", "assignment", "status"]),
  before: supportStateSnapshotSchema.nullable(),
  after: supportStateSnapshotSchema,
  message: supportMessageApiSchema.nullable(),
  createdAt: utcTimestampSchema,
})
export const supportCaseResponseSchema = z.strictObject({
  case: supportCaseApiSchema,
  permissions: z.strictObject({
    canMessage: z.boolean(),
    canManage: z.boolean(),
  }),
})
export const supportMutationResponseSchema = z.strictObject({
  case: supportCaseApiSchema,
  change: supportCaseChangeApiSchema,
})
export const supportCaseListQuerySchema = paginationQuerySchema.extend({
  view: z.enum(["mine", "staff", "assigned"]).default("mine"),
  eventId: entityIdSchema.optional(),
  status: supportStatusSchema.optional(),
  category: supportIssueCategorySchema.optional(),
})
export const supportCaseListSchema = z.strictObject({
  items: z.array(supportCaseApiSchema),
  nextCursor: z.string().nullable(),
})
export const supportHistoryQuerySchema = z.strictObject({
  after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
const historyPage = z.strictObject({
  nextCursor: sequence.nullable(),
  throughSequence: sequence,
  caseRevision: sequence,
})
export const supportMessageListSchema = historyPage.extend({
  items: z.array(supportMessageApiSchema),
})
export const supportChangeListSchema = historyPage.extend({
  items: z.array(supportCaseChangeApiSchema),
})
export type SupportCase = z.infer<typeof supportCaseApiSchema>
export type SupportMessage = z.infer<typeof supportMessageApiSchema>
export type SupportCaseChange = z.infer<typeof supportCaseChangeApiSchema>
export type SupportStatus = z.infer<typeof supportStatusSchema>
export type SupportAudience = z.infer<typeof supportAudienceSchema>
export type SupportCategory = z.infer<typeof supportIssueCategorySchema>
export type SupportMutationResponse = z.infer<
  typeof supportMutationResponseSchema
>
export type OpenSupportCase = z.infer<typeof openSupportCaseSchema>

export const supportAssigneeListSchema = z.strictObject({
  caseId: entityIdSchema,
  items: z.array(z.strictObject({ userId: entityIdSchema, name: z.string() })),
  nextCursor: z.string().nullable(),
})

export const SUPPORT_LIVE_PROTOCOL = "elc.support.v1"
export const supportLiveFrameSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("ready"),
    version: z.literal(1),
    caseId: entityIdSchema,
    throughSequence: sequence,
    revalidateAfterMs: z.int().positive(),
  }),
  z.strictObject({
    type: z.literal("case_update"),
    version: z.literal(1),
    caseId: entityIdSchema,
    updateId: entityIdSchema,
    sequence,
  }),
  z.strictObject({
    type: z.literal("pong"),
    version: z.literal(1),
    throughSequence: sequence,
  }),
])
export type SupportLiveFrame = z.infer<typeof supportLiveFrameSchema>
