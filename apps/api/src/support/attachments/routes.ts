import type { Context } from "hono"
import type { Request as WorkerRequest } from "@cloudflare/workers-types"
import type { Bindings } from "../../env"
import { ApiFailure } from "../../db/transitions"
import { requireSupportCase } from "../store"
import { MAX_ATTACHMENT_BYTES } from "./limits"
import { uploadSupportAttachment, type AttachmentDependencies } from "./service"

export async function receiveSupportUpload(
  c: Context<{ Bindings: Bindings }>,
  actorId: string,
  dependencies: AttachmentDependencies = {}
) {
  const caseId = c.req.param("caseId") ?? ""
  await requireSupportCase(c.env.DB, actorId, caseId)
  if (!c.req.header("Content-Type")?.startsWith("multipart/form-data;"))
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Upload one file with its request ID."
    )
  const maximum = MAX_ATTACHMENT_BYTES + 65536
  if (Number(c.req.header("Content-Length") ?? 0) > maximum)
    throw new ApiFailure(
      "ATTACHMENT_REJECTED",
      413,
      "Files must be at most 5 MiB."
    )
  const reader = c.req.raw.body?.getReader()
  if (!reader) throw new ApiFailure("INVALID_INPUT", 400, "Choose a file.")
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > maximum) {
        await reader.cancel()
        throw new ApiFailure(
          "ATTACHMENT_REJECTED",
          413,
          "Files must be at most 5 MiB."
        )
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  // This module runs in Workers even when an RPC client imports its inferred types.
  const parser = new Request(c.req.url, {
    method: "POST",
    headers: { "Content-Type": c.req.header("Content-Type")! },
    body: bytes.buffer,
  }) as unknown as WorkerRequest
  const form = await parser.formData().catch(() => null)
  if (
    !form ||
    [...form.keys()].length !== 2 ||
    form.getAll("file").length !== 1 ||
    form.getAll("requestId").length !== 1
  )
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Upload one file with its request ID."
    )
  const file = form.get("file")
  if (
    !file ||
    typeof file === "string" ||
    typeof form.get("requestId") !== "string"
  )
    throw new ApiFailure("INVALID_INPUT", 400, "Choose a file.")
  if (file.size === 0)
    throw new ApiFailure("INVALID_INPUT", 400, "Choose a nonempty file.")
  if (file.size > MAX_ATTACHMENT_BYTES)
    throw new ApiFailure(
      "ATTACHMENT_REJECTED",
      413,
      "Files must be at most 5 MiB."
    )
  const result = await uploadSupportAttachment(
    c.env,
    actorId,
    caseId,
    {
      requestId: form.get("requestId"),
      fileName: file.name,
      contentType: file.type,
    },
    new Uint8Array(await file.arrayBuffer()),
    dependencies
  )
  return c.json(result, result.attachment.status === "rejected" ? 422 : 201)
}
