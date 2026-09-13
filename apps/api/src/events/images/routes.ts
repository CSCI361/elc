import { Hono, type Context } from "hono"
import { HTTPException } from "hono/http-exception"
import type { Request as WorkerRequest } from "@cloudflare/workers-types"
import { eventImageLimits } from "@elc/shared"
import type { Bindings } from "../../env"
import { requireSession } from "../../auth/session"
import { requireEventPermission } from "../../auth/permissions"
import { ApiFailure } from "../../db/transitions"
import { uploadEventImage, updateEventImages } from "./service"
import { downloadEventImage } from "./download"
import type { ImageDependencies } from "./store"

type Environment = { Bindings: Bindings; Variables: { requestId: string } }
type RouteDependencies = ImageDependencies & {
  identify?: (context: Context<Environment>) => Promise<string | undefined>
}
async function identifySession(c: Context<Environment>) {
  try {
    return (await requireSession(c)).user.id
  } catch (error) {
    if (error instanceof HTTPException && error.status === 401) return undefined
    throw error
  }
}
export async function receiveEventImage(
  c: Context<Environment>,
  actorId: string,
  dependencies: ImageDependencies = {}
) {
  const eventId = c.req.param("eventId") ?? ""
  await requireEventPermission(c.env.DB, actorId, eventId, "event:manage")
  const type = c.req.header("Content-Type") ?? "",
    maximum = eventImageLimits.fileBytes + 65536
  if (!type.startsWith("multipart/form-data;"))
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Upload one image with its details."
    )
  if (Number(c.req.header("Content-Length") ?? 0) > maximum)
    throw new ApiFailure("ATTACHMENT_REJECTED", 413, "FILE_TOO_LARGE")
  const reader = c.req.raw.body?.getReader()
  if (!reader) throw new ApiFailure("INVALID_INPUT", 400, "Choose an image.")
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.length
      if (size > maximum) {
        await reader.cancel()
        throw new ApiFailure("ATTACHMENT_REJECTED", 413, "FILE_TOO_LARGE")
      }
      chunks.push(chunk.value)
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
  const parser = new Request(c.req.url, {
    method: "POST",
    headers: { "Content-Type": type },
    body: bytes.buffer,
  }) as unknown as WorkerRequest
  const form = await parser.formData().catch(() => null)
  const keys = ["file", "requestId", "expectedRevision", "altText"]
  if (
    !form ||
    [...form.keys()].length !== keys.length ||
    keys.some((key) => form.getAll(key).length !== 1)
  )
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Upload one image with its request ID, revision and alternative text."
    )
  const file = form.get("file"),
    requestId = form.get("requestId"),
    revision = form.get("expectedRevision"),
    altText = form.get("altText")
  if (
    !file ||
    typeof file === "string" ||
    typeof requestId !== "string" ||
    typeof revision !== "string" ||
    !/^\d+$/.test(revision) ||
    typeof altText !== "string"
  )
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Upload one image with valid details."
    )
  if (!file.size || file.size > eventImageLimits.fileBytes)
    throw new ApiFailure(
      "ATTACHMENT_REJECTED",
      file.size ? 413 : 400,
      file.size ? "FILE_TOO_LARGE" : "FILE_INVALID"
    )
  return c.json(
    await uploadEventImage(
      c.env,
      actorId,
      eventId,
      { requestId, expectedRevision: Number(revision), altText },
      new Uint8Array(await file.arrayBuffer()),
      file.type,
      dependencies
    ),
    201
  )
}
export function createEventImageRoutes(dependencies: RouteDependencies = {}) {
  const identify = dependencies.identify ?? identifySession
  const actor = async (c: Context<Environment>) => {
    const id = await identify(c)
    if (!id)
      throw new ApiFailure("UNAUTHENTICATED", 401, "Sign in to continue.")
    return id
  }
  return new Hono<Environment>()
    .post("/events/:eventId/images", async (c) =>
      receiveEventImage(c, await actor(c), dependencies)
    )
    .patch("/events/:eventId/images", async (c) =>
      c.json(
        await updateEventImages(
          c.env,
          await actor(c),
          c.req.param("eventId"),
          await c.req.json().catch(() => null),
          dependencies
        )
      )
    )
    .get("/events/:eventId/images/:imageId", async (c) =>
      downloadEventImage(
        c.env,
        c.req.param("eventId"),
        c.req.param("imageId"),
        await identify(c),
        dependencies
      )
    )
}
