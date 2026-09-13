import { z } from "zod"
import {
  entityIdSchema,
  paginationQuerySchema,
  requestIdSchema,
  utcTimestampSchema,
} from "./common"
import { calendarIdentitySchema, reportingIdSchema } from "./operations"
import { eventPhaseSchema } from "./states"
import { eventImageSchema } from "./event-images-api"
import {
  createCampaignSchema,
  createEventSchema,
  createTicketTypeSchema,
  eventSchema,
} from "./ticketing"

const revisionSchema = z.int().nonnegative()
const refundInstructionsSchema = z.string().trim().max(4_000)

export const createEventRequestSchema = createEventSchema.safeExtend({
  requestId: requestIdSchema,
  refundInstructions: refundInstructionsSchema.default(""),
})

export const updateEventRequestSchema = createEventRequestSchema.safeExtend({
  expectedRevision: revisionSchema,
})

export const eventRevisionRequestSchema = z.strictObject({
  requestId: requestIdSchema,
  expectedRevision: revisionSchema,
})

export const createTicketTypeRequestSchema = createTicketTypeSchema.safeExtend({
  requestId: requestIdSchema,
  expectedRevision: revisionSchema,
})

export const updateTicketTypeRequestSchema = createTicketTypeRequestSchema

export const updateSeatRequestSchema = eventRevisionRequestSchema.extend({
  enabled: z.boolean(),
})

export const createCampaignRequestSchema = z.strictObject({
  ...createCampaignSchema.shape,
  startsAt: utcTimestampSchema.optional(),
  endsAt: utcTimestampSchema.optional(),
  requestId: requestIdSchema,
  expectedRevision: revisionSchema,
})

export const eventListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(80).optional(),
  startsFrom: utcTimestampSchema.optional(),
  startsBefore: utcTimestampSchema.optional(),
  phase: eventPhaseSchema.optional(),
})

export const eventApiSchema = eventSchema.safeExtend({
  images: z.array(eventImageSchema).max(5).default([]),
  revision: revisionSchema,
  reportingId: reportingIdSchema,
  refundInstructions: refundInstructionsSchema,
  phase: eventPhaseSchema,
  calendar: calendarIdentitySchema,
})

export const ticketTypeApiSchema = createTicketTypeSchema.safeExtend({
  id: entityIdSchema,
  available: z.int().nonnegative(),
  reserved: z.int().nonnegative(),
  sold: z.int().nonnegative(),
  unavailable: z.int().nonnegative(),
})

export const eventDetailResponseSchema = z.strictObject({
  event: eventApiSchema,
  ticketTypes: z.array(ticketTypeApiSchema),
})

export const eventListResponseSchema = z.strictObject({
  items: z.array(eventApiSchema),
  nextCursor: z.string().nullable(),
})

export const inventoryResponseSchema = z.strictObject({
  eventId: entityIdSchema,
  revision: revisionSchema,
  seatingMode: z.enum(["general_admission", "assigned"]),
  ticketTypes: z.array(ticketTypeApiSchema),
  seats: z.array(
    z.strictObject({
      id: entityIdSchema,
      ticketTypeId: entityIdSchema.nullable(),
      section: z.string(),
      row: z.string(),
      number: z.string(),
      accessible: z.boolean(),
      enabled: z.boolean(),
      state: z.enum(["available", "held", "sold", "unavailable"]),
      priceMinor: z.int().nonnegative().nullable(),
    })
  ),
})

export const campaignResponseSchema = z.strictObject({
  ...createCampaignSchema.shape,
  enabled: z.boolean(),
  id: entityIdSchema,
  code: z.string().min(1),
  campaignUrl: z.url(),
  reportingId: reportingIdSchema,
  updatedAt: utcTimestampSchema,
})

export const campaignListResponseSchema = z.strictObject({
  items: z.array(campaignResponseSchema),
  nextCursor: z.string().nullable(),
})

export const eventMutationResponseSchema = z.strictObject({
  eventId: entityIdSchema,
  resourceId: entityIdSchema,
  revision: revisionSchema,
})

export type CreateEventRequest = z.infer<typeof createEventRequestSchema>
export type UpdateEventRequest = z.infer<typeof updateEventRequestSchema>
export type EventRevisionRequest = z.infer<typeof eventRevisionRequestSchema>
export type CreateTicketTypeRequest = z.infer<
  typeof createTicketTypeRequestSchema
>
export type CreateCampaignRequest = z.infer<typeof createCampaignRequestSchema>
export type EventListQuery = z.infer<typeof eventListQuerySchema>
export type EventMutationResponse = z.infer<typeof eventMutationResponseSchema>
export type EventApi = z.infer<typeof eventApiSchema>
