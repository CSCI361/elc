import { z } from "zod"
import {
  entityIdSchema,
  paginationQuerySchema,
  requestIdSchema,
  utcTimestampSchema,
} from "./common"
import { permissionSchema } from "./states"

const revision = z.int().nonnegative()
export const eventAccessRevisionSchema = z.strictObject({
  requestId: requestIdSchema,
  expectedRevision: revision,
})
export const replaceEventStaffSchema = eventAccessRevisionSchema.extend({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  permissions: z
    .array(permissionSchema)
    .max(8)
    .refine(
      (values) => new Set(values).size === values.length,
      "Each permission must appear once."
    ),
})
export const staffGrantApiSchema = z.strictObject({
  permission: permissionSchema,
  grantedAt: utcTimestampSchema,
  revokedAt: utcTimestampSchema.nullable(),
})
export const eventStaffApiSchema = z.strictObject({
  userId: entityIdSchema,
  name: z.string(),
  email: z.email(),
  permissions: z.array(permissionSchema),
  grants: z.array(staffGrantApiSchema).max(8),
})
export const eventStaffListSchema = z.strictObject({
  eventId: entityIdSchema,
  revision,
  items: z.array(eventStaffApiSchema),
  nextCursor: z.string().nullable(),
})
export const eventStaffMutationSchema = z.strictObject({
  eventId: entityIdSchema,
  revision,
  staff: eventStaffApiSchema,
})
export const createEventInvitationSchema = eventAccessRevisionSchema.extend({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
})
export const eventInvitationApiSchema = z.strictObject({
  id: entityIdSchema,
  eventId: entityIdSchema,
  email: z.email(),
  createdAt: utcTimestampSchema,
  expiresAt: utcTimestampSchema,
  acceptedAt: utcTimestampSchema.nullable(),
  acceptedBy: entityIdSchema.nullable(),
  revokedAt: utcTimestampSchema.nullable(),
  state: z.enum(["pending", "accepted", "expired", "revoked"]),
})
export const eventInvitationListSchema = z.strictObject({
  eventId: entityIdSchema,
  revision,
  items: z.array(eventInvitationApiSchema),
  nextCursor: z.string().nullable(),
})
export const eventInvitationMutationSchema = z.strictObject({
  eventId: entityIdSchema,
  revision,
  invitation: eventInvitationApiSchema,
  deliveryQueued: z.boolean(),
})
export const acceptEventInvitationSchema = z.strictObject({
  requestId: requestIdSchema,
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
})
export const acceptedEventInvitationSchema = z.strictObject({
  eventId: entityIdSchema,
  invitationId: entityIdSchema,
  acceptedAt: utcTimestampSchema,
})
export const eventAccessListQuerySchema = paginationQuerySchema
export type ReplaceEventStaff = z.infer<typeof replaceEventStaffSchema>
export type EventStaff = z.infer<typeof eventStaffApiSchema>
export type EventStaffList = z.infer<typeof eventStaffListSchema>
export type EventStaffMutation = z.infer<typeof eventStaffMutationSchema>
export type EventInvitation = z.infer<typeof eventInvitationApiSchema>
export type EventInvitationList = z.infer<typeof eventInvitationListSchema>
export type EventInvitationMutation = z.infer<
  typeof eventInvitationMutationSchema
>
export type AcceptEventInvitation = z.infer<typeof acceptEventInvitationSchema>
