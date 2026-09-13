import type { Bindings } from "../env"
import { recoveryPaused } from "../recovery/gate"

export const RESERVATION_EXPIRY_BATCH_SIZE = 50

type ExpiryDependencies = {
  beforeCommit?: () => Promise<void>
  mayCommit?: () => boolean
}

/** Every mutation uses the selected IDs and rechecks eligibility in the atomic batch. */
export async function expireReservationBatch(
  db: D1Database,
  eventId: string | undefined,
  now: number,
  dependencies: ExpiryDependencies = {}
) {
  const selected = await db
    .prepare(`SELECT r.id FROM reservations r JOIN orders o ON o.id=r.order_id
      WHERE ${eventId === undefined ? "" : "r.event_id=? AND"} r.state='active' AND r.expires_at<=? AND o.state='pending'
      ORDER BY r.expires_at LIMIT ${RESERVATION_EXPIRY_BATCH_SIZE}`)
    .bind(...(eventId === undefined ? [now] : [eventId, now]))
    .all<{ id: string }>()
  if (!selected.results.length) return { selected: 0, expired: 0 }
  await dependencies.beforeCommit?.()
  if (dependencies.mayCommit && !dependencies.mayCommit())
    return { selected: selected.results.length, expired: 0 }
  const ids = JSON.stringify(selected.results.map((row) => row.id))
  const target = `SELECT r.id FROM reservations r JOIN orders o ON o.id=r.order_id
    WHERE r.id IN (SELECT value FROM json_each(?)) AND r.state='active' AND r.expires_at<=? AND o.state='pending'`
  const targetOrders = `SELECT order_id FROM reservations WHERE id IN (${target})`
  const results = await db.batch([
    db
      .prepare(`INSERT INTO audit_entries (id,event_id,actor_id,scope,action,entity_id,description,correlation_id,created_at)
      SELECT 'expiry:' || r.id,r.event_id,r.account_id,'account','checkout.expired',r.order_id,
        'Reservation expired and unsold inventory was released.','expiry:' || r.id,?
      FROM reservations r WHERE r.id IN (${target})`)
      .bind(now, ids, now),
    db
      .prepare(`INSERT INTO request_receipts (actor_id,request_id,input_hash,resource_id,created_at)
      SELECT 'system:expiry',r.id,'reservation-expiry-v1',r.order_id,? FROM reservations r WHERE r.id IN (${target})`)
      .bind(now, ids, now),
    db
      .prepare(
        `UPDATE inventory SET reservation_id=NULL WHERE order_id IS NULL AND reservation_id IN (${target})`
      )
      .bind(ids, now),
    db
      .prepare(
        `UPDATE promo_allocations SET released_at=? WHERE committed_at IS NULL AND released_at IS NULL AND order_id IN (${targetOrders})`
      )
      .bind(now, ids, now),
    db
      .prepare(
        `UPDATE orders SET state='expired',revision=revision+1 WHERE state='pending' AND id IN (${targetOrders})`
      )
      .bind(ids, now),
    db
      .prepare(`UPDATE reservations SET state='expired' WHERE id IN (SELECT value FROM json_each(?)) AND state='active' AND expires_at<=?
      AND EXISTS (SELECT 1 FROM orders o WHERE o.id=reservations.order_id AND o.state='expired')`)
      .bind(ids, now),
  ])
  return {
    selected: selected.results.length,
    expired: results[5]!.meta.changes,
  }
}

/** Cron performs one bounded batch; subsequent ticks resume from remaining active rows. */
export async function sweepExpiredReservations(
  env: Pick<Bindings, "DB" | "RECOVERY_MODE">,
  dependencies: { now?: () => number; beforeCommit?: () => Promise<void> } = {}
) {
  if (recoveryPaused(env)) return 0
  return (
    await expireReservationBatch(
      env.DB,
      undefined,
      (dependencies.now ?? Date.now)(),
      {
        beforeCommit: dependencies.beforeCommit,
        mayCommit: () => !recoveryPaused(env),
      }
    )
  ).expired
}
