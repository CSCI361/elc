import { requireEventReadAccess } from "../../auth/permissions"
import { ApiFailure } from "../../db/transitions"
import {
  imageReadSql,
  imageAccessSql,
  type ReadImage,
  type ImageEnvironment,
  type ImageDependencies,
} from "./store"
import { imageDigest } from "./validate"

export async function downloadEventImage(
  env: Pick<ImageEnvironment, "DB" | "FILES">,
  eventId: string,
  imageId: string,
  actorId?: string,
  dependencies: ImageDependencies = {}
) {
  await requireEventReadAccess(env.DB, eventId, actorId)
  const row = await env.DB.prepare(
    `${imageReadSql} WHERE i.event_id=? AND i.id=?`
  )
    .bind(eventId, imageId)
    .first<ReadImage>()
  if (!row) throw new ApiFailure("NOT_FOUND", 404, "Event image not found.")
  if (row.object_key !== `private/event-images/${row.asset_id}`)
    throw new ApiFailure(
      "INTERNAL_ERROR",
      503,
      "The event image is temporarily unavailable."
    )
  const object = await env.FILES.get(row.object_key)
  if (!object || object.size !== row.content_size)
    throw new ApiFailure(
      "INTERNAL_ERROR",
      503,
      "The event image is temporarily unavailable."
    )
  const bytes = new Uint8Array(await object.arrayBuffer())
  if ((await imageDigest(bytes)) !== row.content_sha256)
    throw new ApiFailure(
      "INTERNAL_ERROR",
      503,
      "The event image is temporarily unavailable."
    )
  await dependencies.beforeReturn?.()
  await requireEventReadAccess(env.DB, eventId, actorId)
  const access = imageAccessSql(actorId)
  const current = await env.DB.prepare(
    `${imageReadSql} WHERE i.event_id=? AND i.id=? AND i.asset_id=? AND a.object_key=? AND a.content_sha256=? AND ${access.predicate}`
  )
    .bind(
      eventId,
      imageId,
      row.asset_id,
      row.object_key,
      row.content_sha256,
      ...access.bindings
    )
    .first()
  if (!current) throw new ApiFailure("NOT_FOUND", 404, "Event image not found.")
  return new Response(bytes.buffer, {
    headers: {
      "Content-Type": row.content_type,
      "Content-Length": String(bytes.length),
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      Vary: "Cookie",
    },
  })
}
