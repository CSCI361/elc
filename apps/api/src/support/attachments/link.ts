import type { SupportMessageAttachment } from "@elc/shared"
import { ApiFailure, assertSql } from "../../db/transitions"
import type { MessageRow } from "../store"
import { ATTACHMENT_VALIDATOR_VERSION } from "./limits"
import { attachmentRow, type AttachmentRow } from "./store"

export async function readyAttachments(
  db: D1Database,
  actorId: string,
  caseId: string,
  ids: string[]
) {
  const rows: AttachmentRow[] = []
  for (const id of ids) {
    const row = await attachmentRow(db, id)
    if (
      row.uploader_id !== actorId ||
      row.case_id !== caseId ||
      row.status !== "ready" ||
      row.validator_version !== ATTACHMENT_VALIDATOR_VERSION
    )
      throw new ApiFailure(
        "CONFLICT",
        409,
        "Choose your validated, unused files from this case."
      )
    rows.push(row)
  }
  return rows
}
export function linkedAttachmentDtos(
  rows: AttachmentRow[]
): SupportMessageAttachment[] {
  return rows.map((row, position) => {
    if (!row.content_type || !row.content_size)
      throw new Error("Validated file lacks metadata")
    return {
      id: row.id,
      fileName: row.safe_filename,
      contentType: row.content_type,
      size: row.content_size,
      position,
    }
  })
}
export function attachmentLinkStatements(
  db: D1Database,
  rows: AttachmentRow[],
  message: MessageRow,
  now: number,
  currentClock: boolean
) {
  return rows.flatMap((row, position) => [
    db
      .prepare(`UPDATE support_attachments SET status = 'attached', message_id = ?, position = ?, attached_at = ?, cleanup_after = ?
      WHERE id = ? AND case_id = ? AND uploader_id = ? AND status = 'ready' AND expires_at > ? AND validator_version = ?
      ${currentClock ? "AND expires_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER)" : ""}`)
      .bind(
        message.id,
        position,
        now,
        now,
        row.id,
        message.case_id,
        message.author_id,
        now,
        ATTACHMENT_VALIDATOR_VERSION
      ),
    ...assertSql(db, "changes() = 1"),
  ])
}
