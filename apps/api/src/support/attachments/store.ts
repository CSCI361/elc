import {
  supportUploadResponseSchema,
  type SupportMessageAttachment,
} from "@elc/shared"
import type { Bindings } from "../../env"
import { ApiFailure } from "../../db/transitions"
import { requireSupportCase } from "../store"
import type { AttachmentMime } from "./limits"

export type AttachmentEnvironment = Pick<Bindings, "DB" | "FILES">
export type AttachmentRow = {
  id: string
  case_id: string
  uploader_id: string
  message_id: string | null
  position: number | null
  upload_request_id: string
  input_hash: string
  safe_filename: string
  declared_type: AttachmentMime
  original_size: number
  original_sha256: string
  quarantine_key: string
  object_key: string
  content_type: AttachmentMime | null
  content_size: number | null
  content_sha256: string | null
  validator_version: string
  status:
    | "quarantined"
    | "ready"
    | "attached"
    | "rejected"
    | "deleting"
    | "deleted"
  rejection_code: string | null
  created_at: number
  expires_at: number
  validated_at: number | null
  attached_at: number | null
  deleted_at: number | null
  cleanup_after: number | null
}
export async function attachmentRow(db: D1Database, id: string) {
  const row = await db
    .prepare("SELECT * FROM support_attachments WHERE id = ?")
    .bind(id)
    .first<AttachmentRow>()
  if (!row)
    throw new ApiFailure("NOT_FOUND", 404, "Support attachment not found.")
  return row
}
export function uploadDto(row: AttachmentRow) {
  return supportUploadResponseSchema.parse({
    attachment: {
      id: row.id,
      caseId: row.case_id,
      fileName: row.safe_filename,
      status: row.status,
      contentType: row.content_type,
      size: row.content_size,
      errorCode: row.rejection_code,
      expiresAt: new Date(row.expires_at).toISOString(),
    },
  })
}
export function attachmentDto(row: AttachmentRow): SupportMessageAttachment {
  if (
    row.content_type === null ||
    row.content_size === null ||
    row.position === null
  )
    throw new Error("Attachment metadata is incomplete")
  return {
    id: row.id,
    fileName: row.safe_filename,
    contentType: row.content_type,
    size: row.content_size,
    position: row.position,
  }
}
export async function requireOwnedUpload(
  db: D1Database,
  actorId: string,
  caseId: string,
  id: string
) {
  await requireSupportCase(db, actorId, caseId)
  const row = await attachmentRow(db, id)
  if (row.case_id !== caseId || row.uploader_id !== actorId)
    throw new ApiFailure("NOT_FOUND", 404, "Support attachment not found.")
  return row
}
export async function messageAttachments(
  db: D1Database,
  caseId: string,
  ids: string[]
) {
  if (!ids.length) return []
  return (
    await db
      .prepare(
        "SELECT * FROM support_attachments WHERE case_id = ? AND status = 'attached' AND message_id IN (SELECT value FROM json_each(?)) ORDER BY message_id, position"
      )
      .bind(caseId, JSON.stringify(ids))
      .all<AttachmentRow>()
  ).results
}
export async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer
  )
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}
