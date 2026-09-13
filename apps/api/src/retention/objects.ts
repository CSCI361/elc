import type { Bindings } from "../env"
import { DAY, PAYLOAD_MS } from "./policy"

type ObjectJob = {
  id: string
  mode: "key" | "prefix"
  object_key: string
  cursor: string | null
  created_at: number
  attempts: number
  lease_token: string
}
type Dependencies = {
  now?: () => number
  beforeDelete?: (id: string) => Promise<void>
}
const identifier = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}"
const keyPattern = new RegExp(
  `^private/(support-(?:quarantine|files)/${identifier}|event-images/${identifier}|email-deliveries/${identifier}/[a-f0-9]{64}\\.json)$`
)
const prefixPattern = new RegExp(`^private/ticket-pdfs/${identifier}/$`)

/** Only server-owned private file namespaces can be retired. Backup keys have a separate policy. */
export function validRetentionObject(mode: string, key: string) {
  return mode === "key"
    ? keyPattern.test(key)
    : mode === "prefix" && prefixPattern.test(key)
}

/** D1 is the durable queue. Repeated sweeps of an immutable key cover puts already in flight
 * at aggregate retirement. A stale worker may repeat a harmless R2 deletion, but cannot
 * acknowledge a newer lease or erase its cursor. */
export async function cleanupRetentionObjects(
  env: Pick<Bindings, "DB" | "FILES">,
  dependencies: Dependencies = {}
) {
  const clock = dependencies.now ?? Date.now
  const now = clock()
  const candidates = (
    await env.DB.prepare(`SELECT id FROM retention_object_jobs
 WHERE bucket='files' AND next_attempt_at<=? AND lease_until<=? ORDER BY next_attempt_at,id LIMIT 50`)
      .bind(now, now)
      .all<{ id: string }>()
  ).results
  let swept = 0,
    retry = 0
  for (const candidate of candidates) {
    const token = crypto.randomUUID(),
      claimedAt = clock()
    const row =
      await env.DB.prepare(`UPDATE retention_object_jobs SET lease_token=?,lease_until=?,attempts=attempts+1
   WHERE id=? AND next_attempt_at<=? AND lease_until<=? RETURNING *`)
        .bind(token, claimedAt + 60_000, candidate.id, claimedAt, claimedAt)
        .first<ObjectJob>()
    if (!row) continue
    try {
      if (!validRetentionObject(row.mode, row.object_key))
        throw new Error("Invalid private object namespace")
      await dependencies.beforeDelete?.(row.id)
      const owns = await env.DB.prepare(
        "SELECT 1 FROM retention_object_jobs WHERE id=? AND lease_token=? AND lease_until>?"
      )
        .bind(row.id, token, clock())
        .first()
      if (!owns) continue
      let cursor: string | null = null
      if (row.mode === "key") await env.FILES.delete(row.object_key)
      else {
        const page = await env.FILES.list({
          prefix: row.object_key,
          limit: 100,
          ...(row.cursor ? { cursor: row.cursor } : {}),
        })
        // R2 list should enforce its prefix; fail closed if an adapter or restored job is malformed.
        if (
          page.objects.some((object) => !object.key.startsWith(row.object_key))
        )
          throw new Error("Object prefix mismatch")
        if (page.objects.length)
          await env.FILES.delete(page.objects.map((object) => object.key))
        if (page.truncated) cursor = page.cursor
      }
      const doneAt = clock()
      const acknowledge =
        cursor === null && row.created_at <= doneAt - PAYLOAD_MS
          ? env.DB.prepare(
              "DELETE FROM retention_object_jobs WHERE id=? AND lease_token=? AND lease_until>?"
            ).bind(row.id, token, doneAt)
          : env.DB.prepare(`UPDATE retention_object_jobs SET cursor=?,last_swept_at=?,completed_at=?,next_attempt_at=?,lease_token=NULL,lease_until=0
          WHERE id=? AND lease_token=? AND lease_until>?`).bind(
              cursor,
              doneAt,
              cursor ? null : doneAt,
              cursor ? doneAt : doneAt + DAY,
              row.id,
              token,
              doneAt
            )
      // Complete image retirement in the same lease-guarded batch as its object acknowledgement.
      // Even a first sweep after 30 days cannot erase the only proof that the asset was deleted.
      await env.DB.batch([
        ...(cursor === null &&
        row.mode === "key" &&
        row.object_key.startsWith("private/event-images/")
          ? [
              env.DB.prepare(`UPDATE event_image_assets SET state='deleted',deleted_at=?
          WHERE object_key=? AND state='deleting' AND NOT EXISTS(SELECT 1 FROM event_images i WHERE i.asset_id=event_image_assets.id)
          AND EXISTS(SELECT 1 FROM retention_object_jobs WHERE id=? AND lease_token=? AND lease_until>?)`).bind(
                doneAt,
                row.object_key,
                row.id,
                token,
                doneAt
              ),
            ]
          : []),
        acknowledge,
      ])
      swept++
    } catch {
      retry++
      const failedAt = clock()
      await env.DB.prepare(`UPDATE retention_object_jobs SET next_attempt_at=?,lease_token=NULL,lease_until=0
    WHERE id=? AND lease_token=? AND lease_until>?`)
        .bind(
          failedAt + Math.min(DAY, 60_000 * 2 ** Math.min(row.attempts, 10)),
          row.id,
          token,
          failedAt
        )
        .run()
    }
  }
  return { swept, retry }
}
