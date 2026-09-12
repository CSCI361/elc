import { z } from "zod"
import {
  entityIdSchema,
  paginationQuerySchema,
  requestIdSchema,
  utcTimestampSchema,
} from "./common"
import { offlineSnapshotSchema, scanResultSchema } from "./operations"

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const revisionSchema = z.int().nonnegative()
export const registerOfflineDeviceSchema = z.strictObject({
  requestId: requestIdSchema,
  label: z.string().trim().min(1).max(100),
})
export const revokeOfflineDeviceSchema = z.strictObject({
  requestId: requestIdSchema,
  expectedRevision: revisionSchema,
  reason: z.string().trim().min(1).max(500),
  lost: z.boolean().default(false),
})
export const offlineDeviceSchema = z.strictObject({
  id: entityIdSchema,
  eventId: entityIdSchema,
  accountId: entityIdSchema,
  label: z.string(),
  revision: revisionSchema,
  registeredAt: utcTimestampSchema,
  revokedAt: utcTimestampSchema.nullable(),
  lastSyncAt: utcTimestampSchema.nullable(),
  lossReported: z.boolean(),
})
export const offlineDevicesSchema = z.strictObject({
  items: z.array(offlineDeviceSchema).max(100),
  nextCursor: z.string().nullable(),
})
export const issueOfflineSnapshotSchema = z.strictObject({
  requestId: requestIdSchema,
  deviceId: entityIdSchema,
})
export const offlineSnapshotManifestSchema = z
  .strictObject({
    version: z.literal(1),
    snapshotId: entityIdSchema,
    accountId: entityIdSchema,
    deviceId: entityIdSchema,
    eventId: entityIdSchema,
    issuedAt: utcTimestampSchema,
    expiresAt: utcTimestampSchema,
    eventEndsAt: utcTimestampSchema,
    keyId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    algorithm: z.literal("ES256"),
    ticketCount: z.int().nonnegative(),
    pageSize: z.literal(100),
    pages: z.array(
      z.strictObject({
        page: z.int().nonnegative(),
        ticketCount: z.int().min(0).max(100),
        digest: digestSchema,
      })
    ),
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  })
  .superRefine((manifest, context) => {
    if (
      manifest.pages.length !==
        Math.max(1, Math.ceil(manifest.ticketCount / 100)) ||
      manifest.pages.some((page, index) => page.page !== index) ||
      manifest.pages.reduce((sum, page) => sum + page.ticketCount, 0) !==
        manifest.ticketCount
    )
      context.addIssue({
        code: "custom",
        path: ["pages"],
        message: "The manifest must describe every ordered snapshot page.",
      })
    const issued = Date.parse(manifest.issuedAt)
    const expires = Date.parse(manifest.expiresAt)
    if (
      expires <= issued ||
      expires >
        Math.min(
          issued + 4 * 60 * 60_000,
          Date.parse(manifest.eventEndsAt) + 2 * 60 * 60_000
        )
    )
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Snapshot expiry exceeds its allowed lifetime.",
      })
  })
export const offlineSnapshotPageSchema = z.strictObject({
  version: z.literal(1),
  snapshotId: entityIdSchema,
  accountId: entityIdSchema,
  deviceId: entityIdSchema,
  eventId: entityIdSchema,
  issuedAt: utcTimestampSchema,
  expiresAt: utcTimestampSchema,
  page: z.int().nonnegative(),
  totalPages: z.int().positive(),
  totalTickets: z.int().nonnegative(),
  tickets: offlineSnapshotSchema.shape.tickets.max(100),
})
const operationFields = {
  operationId: requestIdSchema,
  snapshotId: entityIdSchema,
  snapshotVersion: z.literal(1),
  deviceTimestamp: utcTimestampSchema,
  deviceSequence: z.int().positive(),
}
export const sealedOfflineScanSchema = z.strictObject({
  ...operationFields,
  kind: z.literal("scan"),
  ticketId: entityIdSchema,
  tokenHash: digestSchema,
})
export const sealedOfflineUndoSchema = z.strictObject({
  ...operationFields,
  kind: z.literal("undo"),
  originalOperationId: requestIdSchema,
})
export const offlineSyncUnitSchema = z
  .strictObject({
    scan: sealedOfflineScanSchema,
    undo: sealedOfflineUndoSchema.optional(),
  })
  .superRefine((unit, context) => {
    if (
      unit.undo &&
      (unit.undo.originalOperationId !== unit.scan.operationId ||
        unit.undo.snapshotId !== unit.scan.snapshotId ||
        unit.undo.operationId === unit.scan.operationId ||
        unit.undo.deviceSequence <= unit.scan.deviceSequence ||
        Date.parse(unit.undo.deviceTimestamp) <
          Date.parse(unit.scan.deviceTimestamp))
    )
      context.addIssue({
        code: "custom",
        path: ["undo"],
        message:
          "An undo must accompany its original scan in the same sealed unit.",
      })
  })
export const syncOfflineScansSchema = z
  .strictObject({
    requestId: requestIdSchema,
    accountId: entityIdSchema,
    deviceId: entityIdSchema,
    units: z.array(offlineSyncUnitSchema).min(1).max(25),
  })
  .superRefine((batch, context) => {
    const operations = batch.units.flatMap((unit) =>
      unit.undo ? [unit.scan, unit.undo] : [unit.scan]
    )
    if (
      new Set(operations.map((operation) => operation.operationId)).size !==
        operations.length ||
      new Set(operations.map((operation) => operation.deviceSequence)).size !==
        operations.length
    )
      context.addIssue({
        code: "custom",
        path: ["units"],
        message:
          "Operation IDs and device sequences must be unique in the sealed batch.",
      })
  })
export const offlineOperationResultSchema = z.strictObject({
  operationId: entityIdSchema,
  result: scanResultSchema,
  serverTimestamp: utcTimestampSchema,
  checkInId: entityIdSchema.nullable(),
  conflict: z.boolean(),
  reviewState: z.enum(["none", "unresolved", "resolved"]),
})
export const offlineSyncResponseSchema = z.strictObject({
  requestId: requestIdSchema,
  deviceId: entityIdSchema,
  eventId: entityIdSchema,
  acknowledgedAt: utcTimestampSchema,
  results: z.array(offlineOperationResultSchema).min(1).max(50),
})
export const reviewOfflineAdmissionSchema = z.strictObject({
  requestId: requestIdSchema,
  expectedRevision: revisionSchema,
  resolution: z.enum(["no_admission", "admission_confirmed"]),
  reason: z.string().trim().min(1).max(500),
})
export const reportedOfflineAdmissionSchema = z.strictObject({
  operationId: entityIdSchema,
  eventId: entityIdSchema,
  deviceId: entityIdSchema,
  accountId: entityIdSchema,
  ticketId: entityIdSchema.nullable(),
  orderId: entityIdSchema.nullable(),
  capturedAt: utcTimestampSchema,
  reportedAt: utcTimestampSchema,
  result: scanResultSchema,
  reviewState: z.enum(["none", "unresolved", "resolved"]),
  revision: revisionSchema,
  resolution: z.enum(["no_admission", "admission_confirmed"]).nullable(),
  reviewedAt: utcTimestampSchema.nullable(),
  reviewedBy: entityIdSchema.nullable(),
  reason: z.string().nullable(),
})
export const reportedOfflineAdmissionsSchema = z.strictObject({
  items: z.array(reportedOfflineAdmissionSchema).max(100),
  nextCursor: z.string().nullable(),
})
export const offlineListQuerySchema = paginationQuerySchema
export type OfflineSnapshotManifest = z.infer<
  typeof offlineSnapshotManifestSchema
>
export type OfflineSnapshotPage = z.infer<typeof offlineSnapshotPageSchema>
export type OfflineSyncUnit = z.infer<typeof offlineSyncUnitSchema>
export type OfflineOperationResult = z.infer<
  typeof offlineOperationResultSchema
>
export type OfflineDevice = z.infer<typeof offlineDeviceSchema>

/** Stable UTF-8 JSON serialization shared by the server and offline verifier. */
export function offlineCanonicalJson(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical)
    if (item !== null && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, entry]) => [key, canonical(entry)])
      )
    return item
  }
  return JSON.stringify(canonical(value))
}

export async function offlinePageDigest(
  page: OfflineSnapshotPage
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(offlineCanonicalJson(page))
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

/** A page is never usable alone. The caller supplies a deployment-pinned public key. */
export async function verifyCompleteOfflineSnapshot(
  rawManifest: unknown,
  rawPages: unknown[],
  publicKey: JsonWebKey,
  expected: {
    accountId: string
    deviceId: string
    eventId: string
    keyId: string
  },
  now: number
): Promise<OfflineSnapshotPage["tickets"] | null> {
  try {
    const manifest = offlineSnapshotManifestSchema.parse(rawManifest)
    if (
      Object.entries(expected).some(
        ([key, value]) =>
          manifest[key as keyof OfflineSnapshotManifest] !== value
      ) ||
      now < Date.parse(manifest.issuedAt) ||
      now >= Date.parse(manifest.expiresAt) ||
      publicKey.d !== undefined ||
      publicKey.kty !== "EC" ||
      publicKey.crv !== "P-256"
    )
      return null
    const { signature, ...unsigned } = manifest
    const key = await crypto.subtle.importKey(
      "jwk",
      publicKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    )
    const bytes = Uint8Array.from(
      atob(signature.replaceAll("-", "+").replaceAll("_", "/")),
      (character) => character.charCodeAt(0)
    )
    if (
      !(await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        bytes,
        new TextEncoder().encode(
          `elc-offline-manifest-v1\n${offlineCanonicalJson(unsigned)}`
        )
      ))
    )
      return null
    const pages = rawPages
      .map((page) => offlineSnapshotPageSchema.parse(page))
      .sort((left, right) => left.page - right.page)
    if (pages.length !== manifest.pages.length) return null
    for (const [index, page] of pages.entries()) {
      if (
        page.page !== index ||
        page.totalPages !== pages.length ||
        page.totalTickets !== manifest.ticketCount ||
        page.tickets.length !== manifest.pages[index]!.ticketCount ||
        [
          "snapshotId",
          "accountId",
          "deviceId",
          "eventId",
          "issuedAt",
          "expiresAt",
        ].some(
          (key) =>
            page[key as keyof OfflineSnapshotPage] !==
            manifest[key as keyof OfflineSnapshotManifest]
        ) ||
        (await offlinePageDigest(page)) !== manifest.pages[index]!.digest
      )
        return null
    }
    const tickets = pages.flatMap((page) => page.tickets)
    if (
      new Set(tickets.map((ticket) => ticket.ticketId)).size !==
        tickets.length ||
      new Set(tickets.map((ticket) => ticket.tokenHash)).size !== tickets.length
    )
      return null
    return tickets
  } catch {
    return null
  }
}
