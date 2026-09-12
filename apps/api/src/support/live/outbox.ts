import type { Bindings } from "../../env"

type DispatchEnvironment = Pick<Bindings, "DB" | "DELIVERY">
type ConsumeEnvironment = Pick<Bindings, "DB" | "SUPPORT">

export async function dispatchSupportLiveOutbox(
  env: DispatchEnvironment,
  now = Date.now()
) {
  const pending = (
    await env.DB.prepare(
      "SELECT id FROM outbox WHERE kind = 'support.live' AND completed_at IS NULL AND next_attempt_at <= ? ORDER BY next_attempt_at, id LIMIT 20"
    )
      .bind(now)
      .all<{ id: string }>()
  ).results
  for (const row of pending) {
    try {
      await env.DELIVERY.send({ id: row.id })
      await env.DB.prepare(
        "UPDATE outbox SET dispatched_at = ?, next_attempt_at = ? WHERE id = ? AND completed_at IS NULL"
      )
        .bind(now, now + 60_000, row.id)
        .run()
    } catch {
      console.warn(JSON.stringify({ code: "SUPPORT_LIVE_QUEUE_RETRY" }))
    }
  }
}

/** Return false before any provider setup for jobs owned by another consumer. */
export async function consumeSupportLiveOutbox(
  env: ConsumeEnvironment,
  id: string,
  now = Date.now()
): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT kind, entity_id, completed_at, attempts FROM outbox WHERE id = ?"
  )
    .bind(id)
    .first<{
      kind: string
      entity_id: string
      completed_at: number | null
      attempts: number
    }>()
  if (!row || row.kind !== "support.live") return false
  if (row.completed_at !== null) return true
  try {
    const response = await env.SUPPORT.get(
      env.SUPPORT.idFromName(row.entity_id)
    ).fetch("https://support.internal/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outboxId: id }),
    })
    if (!response.ok) throw new Error("Support room delivery failed")
    await env.DB.prepare(
      "UPDATE outbox SET completed_at = ?, attempts = attempts + 1 WHERE id = ? AND completed_at IS NULL"
    )
      .bind(Date.now(), id)
      .run()
  } catch {
    await env.DB.prepare(
      "UPDATE outbox SET attempts = attempts + 1, next_attempt_at = ? WHERE id = ? AND completed_at IS NULL"
    )
      .bind(
        now + Math.min(900_000, 15_000 * 2 ** Math.min(row.attempts, 6)),
        id
      )
      .run()
    console.warn(JSON.stringify({ code: "SUPPORT_LIVE_DELIVERY_RETRY" }))
  }
  // Failed delivery is still durable. Cron retries it even after the queue message is acknowledged.
  return true
}
