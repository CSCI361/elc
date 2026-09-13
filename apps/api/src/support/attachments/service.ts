import { createSupportUploadSchema } from "@elc/shared"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  readReceipt,
  requestHash,
} from "../../db/transitions"
import { supportCaseAccessSql } from "../guards"
import {
  parseSupport,
  requireSupportCase,
  supportTime,
  type SupportDependencies,
} from "../store"
import {
  ABANDONED_UPLOAD_MS,
  ATTACHMENT_VALIDATOR_VERSION,
  AttachmentValidationError,
  sizeChecked,
} from "./limits"
import {
  attachmentRow,
  digest,
  requireOwnedUpload,
  uploadDto,
  type AttachmentEnvironment,
  type AttachmentRow,
} from "./store"
import { validateAttachment } from "./validate"

export type AttachmentDependencies = SupportDependencies & {
  validate?: typeof validateAttachment
  beforeRelease?: () => Promise<void>
}
function safeFilename(value: string, type: string) {
  const result = new TextDecoder()
    .decode(new TextEncoder().encode(value))
    .normalize("NFC")
    // Remove control characters before including the name in download headers.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f/\\\u202a-\u202e\u2066-\u2069]/g, "_")
    .trim()
    .slice(0, 160)
  if (!result)
    throw new ApiFailure("INVALID_INPUT", 400, "Provide a file name.")
  const extension =
    type === "application/pdf" ? "pdf" : type === "image/png" ? "png" : "jpg"
  const stem = Array.from(result.replace(/\.[^.]*$/, ""))
    .slice(0, 150)
    .join("")
  return `${stem || "file"}.${extension}`
}
async function deleteObjects(env: AttachmentEnvironment, row: AttachmentRow) {
  await env.FILES.delete([row.quarantine_key, row.object_key])
}
async function immutablePut(
  env: AttachmentEnvironment,
  key: string,
  bytes: Uint8Array,
  hash: string,
  type: string
) {
  const stored = await env.FILES.put(key, new Uint8Array(bytes).buffer, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: type, cacheControl: "private, no-store" },
    customMetadata: { sha256: hash, validator: ATTACHMENT_VALIDATOR_VERSION },
  })
  if (!stored) {
    const previous = await env.FILES.head(key)
    if (
      !previous ||
      previous.size !== bytes.length ||
      previous.customMetadata?.sha256 !== hash
    )
      throw new ApiFailure(
        "CONFLICT",
        409,
        "The stored upload differs. Upload a new file."
      )
  }
}

export async function uploadSupportAttachment(
  env: AttachmentEnvironment,
  actorId: string,
  caseId: string,
  raw: unknown,
  bytes: Uint8Array,
  dependencies: AttachmentDependencies = {}
) {
  const input = parseSupport(createSupportUploadSchema, raw)
  sizeChecked(bytes)
  const currentCase = await requireSupportCase(env.DB, actorId, caseId)
  if (currentCase.status === "resolved")
    throw new ApiFailure(
      "CONFLICT",
      409,
      "Reopen the case before uploading files."
    )
  const filename = safeFilename(input.fileName, input.contentType)
  const originalHash = await digest(bytes)
  const inputHash = await requestHash("support.upload", {
    caseId,
    ...input,
    fileName: filename,
    size: bytes.length,
    sha256: originalHash,
  })
  const receipt = await readReceipt(env.DB, actorId, input.requestId, inputHash)
  let row: AttachmentRow
  if (receipt)
    row = await requireOwnedUpload(env.DB, actorId, caseId, receipt.resourceId)
  else {
    const now = supportTime(dependencies)
    const id = crypto.randomUUID()
    const acl = supportCaseAccessSql(actorId, caseId)
    try {
      await env.DB.batch([
        ...assertSql(env.DB, acl.predicate, acl.bindings),
        ...assertSql(
          env.DB,
          "EXISTS (SELECT 1 FROM support_cases WHERE id = ? AND status <> 'resolved') AND (SELECT count(*) FROM support_attachments WHERE uploader_id = ? AND status IN ('quarantined','ready')) < 12",
          [caseId, actorId]
        ),
        env.DB.prepare(`INSERT INTO support_attachments (id, case_id, uploader_id, upload_request_id, input_hash, safe_filename, declared_type, original_size, original_sha256, quarantine_key, object_key, validator_version, status, created_at, expires_at, cleanup_after)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'quarantined', ?, ?, ?)`).bind(
          id,
          caseId,
          actorId,
          input.requestId,
          inputHash,
          filename,
          input.contentType,
          bytes.length,
          originalHash,
          `private/support-quarantine/${id}`,
          `private/support-files/${id}`,
          ATTACHMENT_VALIDATOR_VERSION,
          now,
          now + ABANDONED_UPLOAD_MS,
          now + ABANDONED_UPLOAD_MS
        ),
        env.DB.prepare(
          "INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, created_at) VALUES (?, ?, ?, ?, ?)"
        ).bind(actorId, input.requestId, inputHash, id, now),
      ])
      row = await attachmentRow(env.DB, id)
    } catch (error) {
      if (!isTransitionConflict(error)) throw error
      const saved = await readReceipt(
        env.DB,
        actorId,
        input.requestId,
        inputHash
      )
      if (!saved)
        throw new ApiFailure(
          "CONFLICT",
          409,
          "The case changed or too many uploads are pending. Remove unused files before retrying."
        )
      row = await requireOwnedUpload(env.DB, actorId, caseId, saved.resourceId)
    }
  }
  if (row.status !== "quarantined") return uploadDto(row)
  if (row.expires_at <= supportTime(dependencies))
    throw new ApiFailure(
      "CONFLICT",
      409,
      "This upload expired. Upload a new file."
    )
  try {
    await immutablePut(
      env,
      row.quarantine_key,
      bytes,
      originalHash,
      "application/octet-stream"
    )
    const validated = await (dependencies.validate ?? validateAttachment)(
      bytes,
      input.contentType
    )
    const contentHash = await digest(validated.bytes)
    await dependencies.beforeRelease?.()
    await requireSupportCase(env.DB, actorId, caseId)
    const now = supportTime(dependencies)
    if (row.expires_at <= now)
      throw new ApiFailure(
        "CONFLICT",
        409,
        "This upload expired. Upload a new file."
      )
    await immutablePut(
      env,
      row.object_key,
      validated.bytes,
      contentHash,
      validated.contentType
    )
    await dependencies.beforeCommit?.()
    const commitNow = supportTime(dependencies)
    const acl = supportCaseAccessSql(actorId, caseId)
    try {
      await env.DB.batch([
        ...assertSql(env.DB, acl.predicate, acl.bindings),
        ...assertSql(
          env.DB,
          "EXISTS (SELECT 1 FROM support_cases WHERE id = ? AND status <> 'resolved')",
          [caseId]
        ),
        env.DB.prepare(`UPDATE support_attachments SET status = 'ready', content_type = ?, content_size = ?, content_sha256 = ?, validated_at = ?
          WHERE id = ? AND status = 'quarantined' AND expires_at > ? ${dependencies.now ? "" : "AND expires_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER)"}`).bind(
          validated.contentType,
          validated.bytes.length,
          contentHash,
          commitNow,
          row.id,
          commitNow
        ),
        ...assertSql(env.DB, "changes() = 1"),
      ])
    } catch (error) {
      if (!isTransitionConflict(error)) throw error
      const saved = await requireOwnedUpload(env.DB, actorId, caseId, row.id)
      if (saved.status !== "ready" && saved.status !== "attached")
        throw new ApiFailure(
          "CONFLICT",
          409,
          "The case or upload changed. Reload before retrying."
        )
    }
    // The released object is separate and immutable; raw quarantine bytes are never served.
    await env.FILES.delete(row.quarantine_key).catch(() => undefined)
    await requireSupportCase(env.DB, actorId, caseId)
    return uploadDto(await attachmentRow(env.DB, row.id))
  } catch (error) {
    const code =
      error instanceof AttachmentValidationError
        ? error.code
        : "UPLOAD_UNAVAILABLE"
    const now = supportTime(dependencies)
    await env.DB.prepare(
      "UPDATE support_attachments SET status = 'rejected', rejection_code = ?, cleanup_after = ? WHERE id = ? AND status = 'quarantined'"
    )
      .bind(code, now, row.id)
      .run()
    const saved = await attachmentRow(env.DB, row.id)
    // A concurrent successful request may already have attached the same immutable object.
    if (saved.status !== "ready" && saved.status !== "attached")
      await deleteObjects(env, saved).catch(() => undefined)
    else {
      await env.FILES.delete(saved.quarantine_key).catch(() => undefined)
      if (saved.status === "attached")
        await env.DB.prepare(
          "UPDATE support_attachments SET cleanup_after = ? WHERE id = ? AND status = 'attached'"
        )
          .bind(now, saved.id)
          .run()
    }
    await requireSupportCase(env.DB, actorId, caseId)
    if (error instanceof AttachmentValidationError) return uploadDto(saved)
    throw error
  }
}

export async function removeSupportUpload(
  env: AttachmentEnvironment,
  actorId: string,
  caseId: string,
  id: string,
  dependencies: SupportDependencies = {}
) {
  const row = await requireOwnedUpload(env.DB, actorId, caseId, id)
  if (row.status === "attached")
    throw new ApiFailure(
      "CONFLICT",
      409,
      "Files in committed messages cannot be removed."
    )
  await dependencies.beforeCommit?.()
  const now = supportTime(dependencies)
  const acl = supportCaseAccessSql(actorId, caseId)
  try {
    await env.DB.batch([
      ...assertSql(env.DB, acl.predicate, acl.bindings),
      ...assertSql(
        env.DB,
        "EXISTS (SELECT 1 FROM support_attachments WHERE id = ? AND uploader_id = ? AND status <> 'attached')",
        [row.id, actorId]
      ),
      env.DB.prepare(
        "UPDATE support_attachments SET status = 'deleting', cleanup_after = ? WHERE id = ? AND status IN ('quarantined','ready','rejected')"
      ).bind(now, row.id),
    ])
  } catch (error) {
    if (isTransitionConflict(error))
      throw new ApiFailure(
        "CONFLICT",
        409,
        "The upload or case access changed. Reload before removing the file."
      )
    throw error
  }
  await cleanupSupportAttachments(env, now, row.id)
  return uploadDto(await attachmentRow(env.DB, row.id))
}

/** Repeated tombstone sweeps also remove a late R2 write from an interrupted upload. */
export async function cleanupSupportAttachments(
  env: AttachmentEnvironment,
  now = Date.now(),
  onlyId?: string
) {
  const rows = (
    await env.DB.prepare(
      `SELECT * FROM support_attachments WHERE cleanup_after <= ? ${onlyId ? "AND id = ?" : ""} ORDER BY cleanup_after, id LIMIT 50`
    )
      .bind(...(onlyId ? [now, onlyId] : [now]))
      .all<AttachmentRow>()
  ).results
  for (const row of rows) {
    if (row.status === "attached") {
      try {
        await env.FILES.delete(row.quarantine_key)
        await env.DB.prepare(
          "UPDATE support_attachments SET cleanup_after = ? WHERE id = ? AND status = 'attached'"
        )
          .bind(now >= row.expires_at + 86400000 ? null : now + 3600000, row.id)
          .run()
      } catch {
        await env.DB.prepare(
          "UPDATE support_attachments SET cleanup_after = ? WHERE id = ? AND status = 'attached'"
        )
          .bind(now + 60000, row.id)
          .run()
      }
      continue
    }
    await env.DB.prepare(
      "UPDATE support_attachments SET status = 'deleting' WHERE id = ? AND cleanup_after <= ? AND status IN ('quarantined','ready','rejected')"
    )
      .bind(row.id, now)
      .run()
    const current = await attachmentRow(env.DB, row.id)
    if (current.status !== "deleting" && current.status !== "deleted") continue
    try {
      await deleteObjects(env, current)
      await env.DB.prepare(
        "UPDATE support_attachments SET status = 'deleted', deleted_at = coalesce(deleted_at, ?), cleanup_after = ? WHERE id = ? AND status IN ('deleting','deleted')"
      )
        .bind(
          now,
          now < row.expires_at + 86400000 ? now + 3600000 : null,
          row.id
        )
        .run()
    } catch {
      await env.DB.prepare(
        "UPDATE support_attachments SET cleanup_after = ? WHERE id = ? AND status IN ('deleting','deleted')"
      )
        .bind(now + 60000, row.id)
        .run()
      console.warn(JSON.stringify({ code: "SUPPORT_ATTACHMENT_CLEANUP_RETRY" }))
    }
  }
}
