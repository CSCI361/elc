import { z } from "zod"

import { entityIdSchema, utcTimestampSchema } from "./common"
import { policy } from "./policy"

export const eventVisibilitySchema = z.enum(["public", "unlisted", "private"])
export const publicationStateSchema = z.enum([
  "draft",
  "published",
  "unpublished",
])
export const paidSalesStateSchema = z.enum(["pending", "active", "suspended"])
export const eventPhaseSchema = z.enum([
  "upcoming",
  "active",
  "completed",
  "cancelled",
])
export const orderStateSchema = z.enum([
  "pending",
  "completed",
  "expired",
  "abandoned",
  "cancelled",
  "refunded",
])
export const reservationStateSchema = z.enum([
  "active",
  "consumed",
  "expired",
  "abandoned",
])
export const paymentStateSchema = z.enum([
  "pending",
  "succeeded",
  "failed",
  "cancelled",
])
export const refundStateSchema = z.enum(["pending", "succeeded", "failed"])
export const ticketStateSchema = z.enum([
  "valid",
  "checked_in",
  "cancelled",
  "refunded",
])
export const permissionSchema = z.enum([
  "event:manage",
  "support:manage",
  "refund:initiate",
  "ticket:scan",
  "checkin:reverse",
  "checkin:review",
  "analytics:read",
  "history:read",
])
export const platformPermissionSchema = z.enum([
  "platform:moderate",
  "platform:support",
  "platform:configure",
  "platform:recover",
])

export const staffAssignmentSchema = z.strictObject({
  id: entityIdSchema,
  userId: entityIdSchema,
  eventId: entityIdSchema,
  permissions: z.array(permissionSchema).min(1),
  revokedAt: utcTimestampSchema.nullable(),
})

export type EventPhase = z.infer<typeof eventPhaseSchema>
export type Permission = z.infer<typeof permissionSchema>
export type StaffAssignment = z.infer<typeof staffAssignmentSchema>
export type OrderState = z.infer<typeof orderStateSchema>
export type ReservationState = z.infer<typeof reservationStateSchema>
export type TicketState = z.infer<typeof ticketStateSchema>

export function hasEventPermission(
  assignments: readonly StaffAssignment[],
  userId: string,
  eventId: string,
  permission: Permission
): boolean {
  return assignments.some(
    (assignment) =>
      assignment.userId === userId &&
      assignment.eventId === eventId &&
      assignment.revokedAt === null &&
      assignment.permissions.includes(permission)
  )
}

function timestamp(value: string): number {
  return Date.parse(utcTimestampSchema.parse(value))
}

export function deriveEventPhase(
  event: { startsAt: string; endsAt: string; cancelledAt: string | null },
  now: string
): EventPhase {
  const currentTime = timestamp(now)
  const startsAt = timestamp(event.startsAt)
  const endsAt = timestamp(event.endsAt)
  if (endsAt <= startsAt)
    throw new RangeError("Event end must follow its start")
  if (event.cancelledAt !== null) {
    timestamp(event.cancelledAt)
    return "cancelled"
  }
  if (currentTime < startsAt) return "upcoming"
  return currentTime < endsAt ? "active" : "completed"
}

export function reservationExpiresAt(createdAt: string): string {
  return new Date(
    timestamp(createdAt) + policy.reservationDurationMs
  ).toISOString()
}

export function isReservationExpired(expiresAt: string, now: string): boolean {
  return timestamp(now) >= timestamp(expiresAt)
}

export function offlineSnapshotExpiresAt(
  issuedAt: string,
  eventEndsAt: string
): string {
  return new Date(
    Math.min(
      timestamp(issuedAt) + policy.offlineSnapshotLifetimeMs,
      timestamp(eventEndsAt) + policy.offlineEventEndGraceMs
    )
  ).toISOString()
}

/** A policy check only; the API must recheck these facts inside its commit. */
export function canVoluntarilyRefund(input: {
  eventStartsAt: string
  now: string
  hasActiveCheckIn: boolean
  hasUnresolvedOfflineAdmission: boolean
}): boolean {
  return (
    timestamp(input.now) < timestamp(input.eventStartsAt) &&
    !input.hasActiveCheckIn &&
    !input.hasUnresolvedOfflineAdmission
  )
}
