import type { Bindings } from "../env"

const retained = `EXISTS (SELECT 1 FROM email_deliveries delivery WHERE delivery.id=delivery_payload_objects.delivery_id AND delivery.payload_key=delivery_payload_objects.key
  AND (delivery.completed_at IS NULL OR delivery.completed_at > ?))`

/** Repeated deletion covers a put that was already in flight when its unclaimed staging record expired. */
export async function cleanupDeliveryPayloads(
  env: Pick<Bindings, "DB" | "FILES">,
  now = Date.now()
): Promise<number> {
  const cutoff = now - 30 * 86_400_000
  const rows = (
    await env.DB.prepare(`SELECT key,delivery_id,hash,created_at FROM delivery_payload_objects
    WHERE delete_after<=? AND (last_swept_at IS NULL OR last_swept_at<=?) AND NOT (${retained})
    ORDER BY delete_after,key LIMIT 50`)
      .bind(now, now - 3_600_000, cutoff)
      .all<{
        key: string
        delivery_id: string
        hash: string
        created_at: number
      }>()
  ).results
  let count = 0
  for (const row of rows) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(row.delivery_id) ||
      !/^[a-f0-9]{64}$/.test(row.hash) ||
      row.key !== `private/email-deliveries/${row.delivery_id}/${row.hash}.json`
    )
      continue
    const claim =
      await env.DB.prepare(`UPDATE delivery_payload_objects SET state='deleting'
      WHERE key=? AND delete_after<=? AND NOT (${retained}) RETURNING key`)
        .bind(row.key, now, cutoff)
        .first()
    if (!claim) continue
    try {
      await env.FILES.delete(row.key)
      if (row.created_at <= cutoff) {
        await env.DB.prepare(
          "DELETE FROM delivery_payload_objects WHERE key=? AND state='deleting'"
        )
          .bind(row.key)
          .run()
      } else {
        await env.DB.prepare(
          "UPDATE delivery_payload_objects SET state='deleted',last_swept_at=? WHERE key=? AND state='deleting'"
        )
          .bind(now, row.key)
          .run()
      }
      count++
    } catch {
      // Keep the tracked key for the next bounded sweep. No body, credential or recipient enters logs.
      console.warn(JSON.stringify({ code: "DELIVERY_PAYLOAD_CLEANUP_RETRY" }))
    }
  }
  return count
}
