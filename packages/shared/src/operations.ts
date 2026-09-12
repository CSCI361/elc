import { z } from "zod"

import {
  currencySchema,
  entityIdSchema,
  localeSchema,
  minorAmountSchema,
  requestIdSchema,
  utcTimestampSchema,
} from "./common"
import { policy, supportMimeTypes } from "./policy"
import { ticketStateSchema } from "./states"
import { seatSnapshotSchema } from "./ticketing"

export const calendarIdentitySchema = z.strictObject({
  uid: z.string().min(1).max(2_048),
  sequence: z.int().nonnegative(),
  status: z.enum(["CONFIRMED", "CANCELLED"]),
  updatedAt: utcTimestampSchema,
})

/** Use an immutable event ID; an event duplicated to a new ID gets a new UID. */
export function calendarUid(eventId: string): string {
  const id = entityIdSchema.parse(eventId)
  return `elc-${encodeURIComponent(id)}@events.elc`
}

export const admissionPayloadSchema = z.strictObject({
  kind: z.literal("elc_admission"),
  version: z.literal(1),
  token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
})

export const scanResultSchema = z.enum([
  "checked_in",
  "invalid",
  "wrong_event",
  "cancelled",
  "refunded",
  "already_used",
  "admission_blocked",
  "forbidden",
  "snapshot_expired",
  "locally_reversed",
])

export const scanTicketSchema = z.strictObject({
  operationId: requestIdSchema,
  eventId: entityIdSchema,
  credential: admissionPayloadSchema,
})

const snapshotTicketSchema = z.strictObject({
  ticketId: entityIdSchema,
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  state: ticketStateSchema,
  admissionBlocked: z.boolean(),
  attendeeName: z.string().min(1).max(200),
  activeCheckInId: entityIdSchema.nullable(),
  seat: seatSnapshotSchema.nullable(),
})

/** This schema checks structure, not the signature or current device authorization. */
export const offlineSnapshotSchema = z
  .strictObject({
    version: z.literal(1),
    snapshotId: entityIdSchema,
    accountId: entityIdSchema,
    deviceId: entityIdSchema,
    eventId: entityIdSchema,
    issuedAt: utcTimestampSchema,
    expiresAt: utcTimestampSchema,
    eventEndsAt: utcTimestampSchema,
    tickets: z.array(snapshotTicketSchema),
    signature: z.string().min(1),
  })
  .superRefine((snapshot, context) => {
    const issuedAt = Date.parse(snapshot.issuedAt)
    const expiresAt = Date.parse(snapshot.expiresAt)
    const maximumExpiry = Math.min(
      issuedAt + policy.offlineSnapshotLifetimeMs,
      Date.parse(snapshot.eventEndsAt) + policy.offlineEventEndGraceMs
    )
    if (expiresAt <= issuedAt || expiresAt > maximumExpiry) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message:
          "The snapshot must have a positive lifetime within the offline limits",
      })
    }
    if (
      new Set(snapshot.tickets.map((ticket) => ticket.ticketId)).size !==
        snapshot.tickets.length ||
      new Set(snapshot.tickets.map((ticket) => ticket.tokenHash)).size !==
        snapshot.tickets.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["tickets"],
        message: "Snapshot tickets and credential hashes must be unique",
      })
    }
  })

const offlineOperationFields = {
  operationId: requestIdSchema,
  snapshotId: entityIdSchema,
  snapshotVersion: z.literal(1),
  deviceTimestamp: utcTimestampSchema,
}

export const offlineOperationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...offlineOperationFields,
    kind: z.literal("scan"),
    ticketId: entityIdSchema,
    tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.strictObject({
    ...offlineOperationFields,
    kind: z.literal("undo"),
    originalOperationId: requestIdSchema,
  }),
])

export const synchronizeScansSchema = z
  .strictObject({
    accountId: entityIdSchema,
    deviceId: entityIdSchema,
    eventId: entityIdSchema,
    operations: z.array(offlineOperationSchema).min(1).max(100),
  })
  .refine(
    (batch) =>
      new Set(batch.operations.map((operation) => operation.operationId))
        .size === batch.operations.length,
    {
      path: ["operations"],
      message: "Each operation ID must appear once in a batch",
    }
  )

export const synchronizedScanSchema = z.strictObject({
  operationId: requestIdSchema,
  result: scanResultSchema,
  serverTimestamp: utcTimestampSchema,
  checkInId: entityIdSchema.nullable(),
  conflict: z.boolean(),
})

export const supportCaseStateSchema = z.enum([
  "open",
  "in_progress",
  "waiting_for_customer",
  "resolved",
])
export const supportCategorySchema = z.enum([
  "ticket_delivery",
  "payment",
  "refund",
  "seating",
  "event_information",
  "check_in",
  "account",
  "activation",
  "technical",
])

/** Declared metadata still requires server inspection of the uploaded bytes. */
export const supportUploadSchema = z.strictObject({
  caseId: entityIdSchema,
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(supportMimeTypes),
  sizeBytes: z.int().positive().max(policy.supportFileMaxBytes),
})

export const supportAttachmentSchema = supportUploadSchema.extend({
  id: entityIdSchema,
  uploaderId: entityIdSchema,
  state: z.enum(["quarantined", "validated", "rejected"]),
  createdAt: utcTimestampSchema,
})

export const createSupportCaseSchema = z.strictObject({
  requestId: requestIdSchema,
  kind: z.enum(["attendee_to_organizer", "organizer_to_platform"]),
  category: supportCategorySchema,
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(10_000),
  eventId: entityIdSchema.optional(),
  orderId: entityIdSchema.optional(),
  ticketId: entityIdSchema.optional(),
})

export const createSupportMessageSchema = z
  .strictObject({
    requestId: requestIdSchema,
    caseId: entityIdSchema,
    text: z.string().trim().max(10_000).default(""),
    attachmentIds: z
      .array(entityIdSchema)
      .max(policy.supportFilesPerMessage)
      .default([]),
  })
  .superRefine((message, context) => {
    if (!message.text && message.attachmentIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Provide message text or an attachment",
      })
    }
    if (new Set(message.attachmentIds).size !== message.attachmentIds.length) {
      context.addIssue({
        code: "custom",
        path: ["attachmentIds"],
        message: "An attachment can occur only once in a message",
      })
    }
  })

export const supportCaseUpdateSchema = z.strictObject({
  updateId: entityIdSchema,
  caseId: entityIdSchema,
  kind: z.enum(["message_created", "assignment_changed", "status_changed"]),
  occurredAt: utcTimestampSchema,
})

/** Reporting IDs are separate from admission and redeemable campaign credentials. */
export const reportingIdSchema = z.string().regex(/^rpt_[A-Za-z0-9_-]{8,100}$/)

export const analyticsQuerySchema = z
  .strictObject({
    eventId: entityIdSchema,
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    ticketTypeId: entityIdSchema.optional(),
  })
  .refine(
    (query) => {
      const elapsedDays =
        (Date.parse(query.endsOn) - Date.parse(query.startsOn)) / 86_400_000
      return elapsedDays >= 0 && elapsedDays < policy.maxReportDays
    },
    {
      path: ["endsOn"],
      message: "Use an inclusive date range of at most 180 days",
    }
  )

export const ga4EventSchema = z.strictObject({
  name: z.enum(["page_view", "view_item", "campaign_visit", "begin_checkout"]),
  eventReportingId: reportingIdSchema.optional(),
  campaignReportingId: reportingIdSchema.optional(),
  locale: localeSchema,
  currency: currencySchema.optional(),
  valueMinor: minorAmountSchema.optional(),
  quantity: z.int().nonnegative().optional(),
  pageKind: z.enum(["marketing", "public_event", "public_event_checkout"]),
})

export type OfflineSnapshot = z.infer<typeof offlineSnapshotSchema>
export type OfflineOperation = z.infer<typeof offlineOperationSchema>
export type SynchronizeScans = z.infer<typeof synchronizeScansSchema>
export type SupportAttachment = z.infer<typeof supportAttachmentSchema>
export type CreateSupportCase = z.infer<typeof createSupportCaseSchema>
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>
export type Ga4Event = z.infer<typeof ga4EventSchema>
