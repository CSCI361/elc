import { z } from "zod"
import { eventImageSchema, permissionSchema } from "@elc/shared"
import type { Bindings } from "../../env"
import { ApiFailure } from "../../db/transitions"

export type ImageEnvironment = Pick<Bindings, "DB" | "FILES" | "APP_ORIGIN">
export type ImageDependencies = {
  now?: () => number
  beforeStage?: () => Promise<void>
  beforePut?: () => Promise<void>
  beforeCommit?: () => Promise<void>
  beforeReturn?: () => Promise<void>
}
export type ImageAsset = {
  id: string
  event_id: string
  uploader_id: string
  request_id: string
  input_hash: string
  expected_revision: number
  alt_text: string
  object_key: string
  content_type: "image/jpeg" | "image/png"
  original_size: number
  content_size: number
  content_sha256: string
  state: "staged" | "ready" | "deleting" | "deleted"
  lease_token: string | null
  lease_until: number
  attempts: number
  created_at: number
  expires_at: number
  retired_at: number | null
  deleted_at: number | null
}
export type ImageLink = {
  id: string
  event_id: string
  asset_id: string
  position: number
  alt_text: string
  created_at: number
}
export type ReadImage = ImageLink & {
  object_key: string
  content_type: "image/jpeg" | "image/png"
  content_size: number
  content_sha256: string
}
export function parseImage<T extends z.ZodType>(
  schema: T,
  raw: unknown
): z.output<T> {
  const parsed = schema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Provide valid image details and the current event revision."
    )
  return parsed.data
}
export const imageReadSql = `SELECT i.*,a.object_key,a.content_type,a.content_size,a.content_sha256 FROM event_images i
 JOIN event_image_assets a ON a.id=i.asset_id AND a.state='ready'`
export function imageDto(row: ReadImage) {
  return eventImageSchema.parse({
    id: row.id,
    url: `/api/events/${row.event_id}/images/${row.id}`,
    altText: row.alt_text,
    position: row.position,
    contentType: row.content_type,
    sizeBytes: row.content_size,
  })
}
export async function listEventImages(db: D1Database, eventId: string) {
  const rows = (
    await db
      .prepare(
        `${imageReadSql} WHERE i.event_id=? ORDER BY i.position,i.id LIMIT 5`
      )
      .bind(eventId)
      .all<ReadImage>()
  ).results
  return rows.map(imageDto)
}
export async function assetByRequest(
  db: D1Database,
  actorId: string,
  requestId: string
) {
  return db
    .prepare(
      "SELECT * FROM event_image_assets WHERE uploader_id=? AND request_id=?"
    )
    .bind(actorId, requestId)
    .first<ImageAsset>()
}

// Match requireEventReadAccess inside the same final statement as the image association.
export function imageAccessSql(actorId?: string) {
  const publicEvent =
    "(e.visibility<>'private' AND e.publication_state='published' AND e.suspended_at IS NULL)"
  if (!actorId)
    return {
      predicate: `EXISTS(SELECT 1 FROM events e WHERE e.id=i.event_id AND ${publicEvent})`,
      bindings: [] as unknown[],
    }
  return {
    predicate: `EXISTS(SELECT 1 FROM events e WHERE e.id=i.event_id AND (${publicEvent} OR EXISTS
  (SELECT 1 FROM user u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=? AND u.email_verified=1 AND p.suspended_at IS NULL AND
   (e.organizer_id=u.id OR EXISTS(SELECT 1 FROM event_permissions ep WHERE ep.event_id=e.id AND ep.user_id=u.id AND ep.revoked_at IS NULL AND ep.permission IN(SELECT value FROM json_each(?)))
    OR EXISTS(SELECT 1 FROM platform_grants g WHERE g.user_id=u.id AND g.permission='platform:moderate')
    OR (e.visibility='private' AND e.publication_state='published' AND e.suspended_at IS NULL AND EXISTS
     (SELECT 1 FROM invitations inv WHERE inv.event_id=e.id AND inv.accepted_by=u.id AND lower(inv.email)=lower(u.email) AND inv.revoked_at IS NULL
      AND inv.accepted_at IS NOT NULL AND inv.accepted_at<inv.expires_at AND inv.accepted_at<e.ends_at))))))`,
    bindings: [actorId, JSON.stringify(permissionSchema.options)],
  }
}
