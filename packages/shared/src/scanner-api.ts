import { z } from "zod"
import {
  entityIdSchema,
  paginationQuerySchema,
  utcTimestampSchema,
} from "./common"
import { permissionSchema, ticketStateSchema } from "./states"
import { seatSnapshotSchema } from "./ticketing"

export const scannerCountsSchema = z.strictObject({
  registered: z.int().nonnegative(),
  checkedIn: z.int().nonnegative(),
  unresolvedOffline: z.int().nonnegative(),
})
export const scannerEventSchema = z.strictObject({
  id: entityIdSchema,
  title: z.string(),
  venueName: z.string(),
  timeZone: z.string(),
  startsAt: utcTimestampSchema,
  endsAt: utcTimestampSchema,
  cancelledAt: utcTimestampSchema.nullable(),
  suspendedAt: utcTimestampSchema.nullable(),
  permissions: z.array(permissionSchema),
  counts: scannerCountsSchema,
})
export const scannerEventsResponseSchema = z.strictObject({
  items: z.array(scannerEventSchema).max(100),
  nextCursor: z.string().nullable(),
})
export const scannerAttendeeQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).default(""),
})
export const scannerAttendeeSchema = z.strictObject({
  ticketId: entityIdSchema,
  attendeeName: z.string(),
  state: ticketStateSchema,
  admissionBlocked: z.boolean(),
  seat: seatSnapshotSchema.nullable(),
  activeCheckInId: entityIdSchema.nullable(),
})
export const scannerAttendeesResponseSchema = z.strictObject({
  eventId: entityIdSchema,
  items: z.array(scannerAttendeeSchema).max(100),
  nextCursor: z.string().nullable(),
})
export const reversedCheckInResponseSchema = z.strictObject({
  checkInId: entityIdSchema,
  reversed: z.literal(true),
})
export type ScannerEvent = z.infer<typeof scannerEventSchema>
export type ScannerAttendee = z.infer<typeof scannerAttendeeSchema>
