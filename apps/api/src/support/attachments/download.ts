import { ApiFailure } from "../../db/transitions"
import { requireSupportCase } from "../store"
import { attachmentRow, digest, type AttachmentEnvironment } from "./store"

export async function downloadSupportAttachment(
  env: AttachmentEnvironment,
  actorId: string,
  caseId: string,
  id: string,
  dependencies: { beforeReturn?: () => Promise<void> } = {}
) {
  await requireSupportCase(env.DB, actorId, caseId)
  const row = await attachmentRow(env.DB, id)
  if (
    row.case_id !== caseId ||
    row.status !== "attached" ||
    !row.message_id ||
    !row.content_type ||
    !row.content_size ||
    !row.content_sha256
  )
    throw new ApiFailure("NOT_FOUND", 404, "Support attachment not found.")
  const object = await env.FILES.get(row.object_key)
  if (!object || object.size !== row.content_size)
    throw new ApiFailure(
      "INTERNAL_ERROR",
      503,
      "The attachment is temporarily unavailable."
    )
  const bytes = new Uint8Array(await object.arrayBuffer())
  if ((await digest(bytes)) !== row.content_sha256)
    throw new ApiFailure(
      "INTERNAL_ERROR",
      503,
      "The attachment is temporarily unavailable."
    )
  await dependencies.beforeReturn?.()
  await requireSupportCase(env.DB, actorId, caseId)
  return new Response(bytes.buffer, {
    headers: {
      "Content-Type": row.content_type,
      "Content-Disposition": `attachment; filename="elc-support-file.${row.content_type === "application/pdf" ? "pdf" : row.content_type === "image/png" ? "png" : "jpg"}"; filename*=UTF-8''${encodeURIComponent(row.safe_filename).replace(/['()*]/g, (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Content-Length": String(bytes.length),
      Vary: "Cookie",
    },
  })
}
