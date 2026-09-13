import { HTTPException } from "hono/http-exception"
import {
  eventUploadImageRequestSchema,
  updateEventImagesRequestSchema,
  eventMutationResponseSchema,
} from "@elc/shared"
import { requireEventPermission } from "../../auth/permissions"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  readReceipt,
  requestHash,
} from "../../db/transitions"
import {
  activeAccountSql,
  manageEventSql,
  commitMutation,
  type EventContext,
} from "../store"
import {
  assetByRequest,
  parseImage,
  type ImageAsset,
  type ImageLink,
  type ImageEnvironment,
  type ImageDependencies,
} from "./store"
import {
  imageDigest,
  validateEventImage,
  MAX_EVENT_IMAGES,
  IMAGE_LEASE_MS,
  IMAGE_UPLOAD_LIFETIME,
  IMAGE_VALIDATOR_VERSION,
} from "./validate"
import { retireUnreferencedImageStatements } from "./cleanup"

const context = (
  env: ImageEnvironment,
  actorId: string,
  now: number
): EventContext => ({
  db: env.DB,
  actorId,
  now,
  appOrigin: env.APP_ORIGIN,
  correlationId: crypto.randomUUID(),
})
async function replay(
  db: D1Database,
  actorId: string,
  requestId: string,
  hash: string
) {
  const receipt = await readReceipt(db, actorId, requestId, hash)
  return receipt?.responseJson
    ? eventMutationResponseSchema.parse(JSON.parse(receipt.responseJson))
    : null
}
function writable(
  db: D1Database,
  actorId: string,
  eventId: string,
  revision: number
) {
  return [
    ...assertSql(db, activeAccountSql, [actorId]),
    ...assertSql(db, manageEventSql, [eventId, actorId, actorId]),
    ...assertSql(
      db,
      "EXISTS(SELECT 1 FROM events WHERE id=? AND revision=? AND cancelled_at IS NULL)",
      [eventId, revision]
    ),
  ]
}
async function putImage(
  env: ImageEnvironment,
  row: ImageAsset,
  bytes: Uint8Array
) {
  if (row.object_key !== `private/event-images/${row.id}`)
    throw new ApiFailure("CONFLICT", 409, "Stored image identity changed.")
  const result = await env.FILES.put(
    row.object_key,
    new Uint8Array(bytes).buffer,
    {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: {
        contentType: row.content_type,
        cacheControl: "private, no-store",
      },
      customMetadata: {
        sha256: row.content_sha256,
        validator: IMAGE_VALIDATOR_VERSION,
      },
    }
  )
  if (!result) {
    const prior = await env.FILES.get(row.object_key)
    if (
      !prior ||
      prior.size !== row.content_size ||
      (await imageDigest(new Uint8Array(await prior.arrayBuffer()))) !==
        row.content_sha256
    )
      throw new ApiFailure(
        "CONFLICT",
        409,
        "Stored image integrity changed. Upload a new image."
      )
  }
}

export async function uploadEventImage(
  env: ImageEnvironment,
  actorId: string,
  eventId: string,
  raw: unknown,
  bytes: Uint8Array,
  contentType: string,
  dependencies: ImageDependencies = {}
) {
  const input = parseImage(eventUploadImageRequestSchema, raw),
    clock = dependencies.now ?? Date.now
  const liveDeadline = dependencies.now
    ? ""
    : " AND lease_until>CAST(unixepoch('subsecond')*1000 AS INTEGER) AND expires_at>CAST(unixepoch('subsecond')*1000 AS INTEGER)"
  await requireEventPermission(env.DB, actorId, eventId, "event:manage")
  const originalHash = await imageDigest(bytes)
  const hash = await requestHash("event.image.upload", {
    eventId,
    ...input,
    contentType,
    size: bytes.length,
    sha256: originalHash,
  })
  const prior = await replay(env.DB, actorId, input.requestId, hash)
  if (prior) return prior
  // Type and full parser checks run before any raw bytes could be persisted.
  const valid = validateEventImage(bytes, contentType),
    contentHash = await imageDigest(valid.bytes)
  let row = await assetByRequest(env.DB, actorId, input.requestId)
  if (row && row.input_hash !== hash)
    throw new ApiFailure(
      "CONFLICT",
      409,
      "This request ID belongs to different image details."
    )
  if (!row) {
    await dependencies.beforeStage?.()
    const now = clock(),
      id = crypto.randomUUID()
    try {
      await env.DB.batch([
        ...writable(env.DB, actorId, eventId, input.expectedRevision),
        ...assertSql(
          env.DB,
          "(SELECT count(*) FROM event_images WHERE event_id=?)<? AND (SELECT count(*) FROM event_image_assets WHERE uploader_id=? AND state='staged' AND expires_at>?)<10",
          [eventId, MAX_EVENT_IMAGES, actorId, now]
        ),
        env.DB.prepare(`INSERT INTO event_image_assets(id,event_id,uploader_id,request_id,input_hash,expected_revision,alt_text,object_key,content_type,original_size,content_size,content_sha256,state,created_at,expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'staged',?,?)`).bind(
          id,
          eventId,
          actorId,
          input.requestId,
          hash,
          input.expectedRevision,
          input.altText,
          `private/event-images/${id}`,
          valid.contentType,
          bytes.length,
          valid.bytes.length,
          contentHash,
          now,
          now + IMAGE_UPLOAD_LIFETIME
        ),
      ])
    } catch (error) {
      if (!isTransitionConflict(error)) throw error
      await requireEventPermission(env.DB, actorId, eventId, "event:manage")
      const winner = await replay(env.DB, actorId, input.requestId, hash)
      if (winner) return winner
      const saved = await assetByRequest(env.DB, actorId, input.requestId)
      if (!saved)
        throw new ApiFailure(
          "CONFLICT",
          409,
          "The gallery changed, is full, or too many uploads are pending. Reload it before retrying."
        )
    }
    row = await assetByRequest(env.DB, actorId, input.requestId)
  }
  if (
    !row ||
    row.input_hash !== hash ||
    row.content_sha256 !== contentHash ||
    row.content_size !== valid.bytes.length
  )
    throw new ApiFailure(
      "CONFLICT",
      409,
      "The stored upload differs. Upload the same file or use a new request."
    )
  const token = crypto.randomUUID(),
    claimAt = clock()
  const claimed =
    await env.DB.prepare(`UPDATE event_image_assets SET lease_token=?,lease_until=?,attempts=attempts+1
  WHERE id=? AND state='staged' AND expires_at>? AND lease_until<=? RETURNING *`)
      .bind(token, claimAt + IMAGE_LEASE_MS, row.id, claimAt, claimAt)
      .first<ImageAsset>()
  if (!claimed) {
    const result = await replay(env.DB, actorId, input.requestId, hash)
    if (result) return result
    throw new ApiFailure(
      "CONFLICT",
      409,
      "This upload is being processed or has expired. Retry shortly or upload a new image."
    )
  }
  try {
    await dependencies.beforePut?.()
    const putAt = clock()
    // Recheck authority and this exact lease before the external write.
    await env.DB.batch([
      ...writable(env.DB, actorId, eventId, input.expectedRevision),
      ...assertSql(
        env.DB,
        `EXISTS(SELECT 1 FROM event_image_assets WHERE id=? AND state='staged' AND lease_token=? AND lease_until>? AND expires_at>?${liveDeadline})`,
        [row.id, token, putAt, putAt]
      ),
    ])
    await putImage(env, claimed, valid.bytes)
    await dependencies.beforeCommit?.()
    const committedAt = clock()
    const result = await commitMutation(context(env, actorId, committedAt), {
      eventId,
      expectedRevision: input.expectedRevision,
      requestId: input.requestId,
      inputHash: hash,
      action: "event.image_added",
      description: "Added a validated event image.",
      resourceId: row.id,
      statements: [
        ...assertSql(
          env.DB,
          `EXISTS(SELECT 1 FROM event_image_assets WHERE id=? AND state='staged' AND lease_token=? AND lease_until>? AND expires_at>?${liveDeadline}) AND (SELECT count(*) FROM event_images WHERE event_id=?)<?`,
          [row.id, token, committedAt, committedAt, eventId, MAX_EVENT_IMAGES]
        ),
        env.DB.prepare(
          "UPDATE event_image_assets SET state='ready',lease_token=NULL,lease_until=0 WHERE id=? AND lease_token=?"
        ).bind(row.id, token),
        env.DB.prepare(`INSERT INTO event_images(id,event_id,asset_id,position,alt_text,created_at)
     SELECT ?,?,?,(SELECT count(*) FROM event_images WHERE event_id=?),?,?`).bind(
          row.id,
          eventId,
          row.id,
          eventId,
          input.altText,
          committedAt
        ),
      ],
    })
    await requireEventPermission(env.DB, actorId, eventId, "event:manage")
    return result
  } catch (error) {
    // The immutable staging intent remains retryable on R2 failure. A superseded lease cannot attach.
    await env.DB.prepare(
      "UPDATE event_image_assets SET lease_token=NULL,lease_until=0 WHERE id=? AND state='staged' AND lease_token=?"
    )
      .bind(row.id, token)
      .run()
    if (isTransitionConflict(error)) {
      await requireEventPermission(env.DB, actorId, eventId, "event:manage")
      const result = await replay(env.DB, actorId, input.requestId, hash)
      if (result) return result
      throw new ApiFailure(
        "CONFLICT",
        409,
        "The event, gallery or upload changed. Reload before retrying."
      )
    }
    if (error instanceof HTTPException) throw error
    // Keep transport failures free of object keys, content or provider error details.
    throw new ApiFailure(
      "INTERNAL_ERROR",
      503,
      "The image upload is temporarily unavailable. Retry the same file."
    )
  }
}

export async function updateEventImages(
  env: ImageEnvironment,
  actorId: string,
  eventId: string,
  raw: unknown,
  dependencies: ImageDependencies = {}
) {
  const input = parseImage(updateEventImagesRequestSchema, raw),
    clock = dependencies.now ?? Date.now
  await requireEventPermission(env.DB, actorId, eventId, "event:manage")
  const hash = await requestHash("event.images.update", { eventId, ...input })
  const prior = await replay(env.DB, actorId, input.requestId, hash)
  if (prior) return prior
  const rows = (
    await env.DB.prepare(
      "SELECT * FROM event_images WHERE event_id=? ORDER BY position,id LIMIT 5"
    )
      .bind(eventId)
      .all<ImageLink>()
  ).results
  const links = input.images.map((image) => ({
    input: image,
    row: rows.find((row) => row.id === image.id),
  }))
  if (links.some((link) => !link.row))
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Only current images from this event can be selected."
    )
  await dependencies.beforeCommit?.()
  const now = clock()
  const result = await commitMutation(context(env, actorId, now), {
    eventId,
    expectedRevision: input.expectedRevision,
    requestId: input.requestId,
    inputHash: hash,
    action: "event.images_updated",
    description: "Updated the event image gallery.",
    resourceId: eventId,
    statements: [
      ...assertSql(
        env.DB,
        "(SELECT count(*) FROM event_images WHERE event_id=?)=?",
        [eventId, rows.length]
      ),
      ...rows.flatMap((row) =>
        assertSql(
          env.DB,
          "EXISTS(SELECT 1 FROM event_images WHERE id=? AND event_id=? AND asset_id=? AND position=? AND alt_text=? AND created_at=?)",
          [
            row.id,
            eventId,
            row.asset_id,
            row.position,
            row.alt_text,
            row.created_at,
          ]
        )
      ),
      env.DB.prepare("DELETE FROM event_images WHERE event_id=?").bind(eventId),
      ...links.map((link, position) =>
        env.DB.prepare(
          "INSERT INTO event_images(id,event_id,asset_id,position,alt_text,created_at) VALUES (?,?,?,?,?,?)"
        ).bind(
          link.row!.id,
          eventId,
          link.row!.asset_id,
          position,
          link.input.altText,
          link.row!.created_at
        )
      ),
      ...retireUnreferencedImageStatements(env.DB, now),
    ],
  })
  await requireEventPermission(env.DB, actorId, eventId, "event:manage")
  return result
}
