import { DAY, PAYLOAD_MS } from "../../retention/policy"

/** Link deletion and orphan retirement share the caller's D1 transaction. A deleting asset
 * cannot gain new links, so later object work never races a newly referenced image. */
export function retireUnreferencedImageStatements(
  db: D1Database,
  now: number,
  limit = 100
) {
  return [
    db
      .prepare(`UPDATE event_image_assets SET state='deleting',retired_at=?,lease_token=NULL,lease_until=0 WHERE id IN
   (SELECT a.id FROM event_image_assets a WHERE NOT EXISTS(SELECT 1 FROM event_images i WHERE i.asset_id=a.id)
    AND (a.state='ready' OR (a.state='staged' AND (a.expires_at<=? OR NOT EXISTS(SELECT 1 FROM events e WHERE e.id=a.event_id))))
    ORDER BY a.created_at,a.id LIMIT ?)`)
      .bind(now, now, limit),
    db
      .prepare(`INSERT OR IGNORE INTO retention_object_jobs(id,bucket,mode,object_key,created_at,next_attempt_at)
   SELECT lower(hex(randomblob(16))),'files','key',a.object_key,?,? FROM event_image_assets a
   WHERE a.state='deleting' AND NOT EXISTS(SELECT 1 FROM event_images i WHERE i.asset_id=a.id)
    AND NOT EXISTS(SELECT 1 FROM retention_object_jobs j WHERE j.bucket='files' AND j.mode='key' AND j.object_key=a.object_key)
   ORDER BY a.retired_at,a.id LIMIT ?`)
      .bind(now, now, limit),
  ]
}

/** Run with normal scheduled cleanup and before restored data is exposed. */
export async function cleanupEventImageAssets(
  db: D1Database,
  now = Date.now()
) {
  const result = await db.batch([
    ...retireUnreferencedImageStatements(db, now),
    db
      .prepare(`UPDATE event_image_assets SET state='deleted',deleted_at=? WHERE state='deleting'
   AND NOT EXISTS(SELECT 1 FROM event_images i WHERE i.asset_id=event_image_assets.id)
   AND EXISTS(SELECT 1 FROM retention_object_jobs j WHERE j.bucket='files' AND j.mode='key' AND j.object_key=event_image_assets.object_key AND j.completed_at IS NOT NULL)`)
      .bind(now),
    // Object jobs keep their own immutable tombstone for 30 days of repeated sweeps.
    db
      .prepare(`DELETE FROM event_image_assets WHERE id IN (SELECT a.id FROM event_image_assets a
   WHERE a.state='deleted' AND a.retired_at<=? AND a.deleted_at<=?
    AND NOT EXISTS(SELECT 1 FROM event_images i WHERE i.asset_id=a.id)
    AND NOT EXISTS(SELECT 1 FROM retention_object_jobs j WHERE j.bucket='files' AND j.mode='key' AND j.object_key=a.object_key)
   ORDER BY a.retired_at,a.id LIMIT 100)`)
      .bind(now - PAYLOAD_MS, now - DAY),
  ])
  return { retired: result[0]!.meta.changes, deleted: result[3]!.meta.changes }
}
