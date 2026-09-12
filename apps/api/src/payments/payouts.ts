import { policy as platformPolicy } from "@elc/shared"
import { assertSql, isTransitionConflict } from "../db/transitions"

const databaseNow = "CAST(unixepoch('subsecond') * 1000 AS INTEGER)"

/** Only server-authored aliases are accepted. Refunds and financial cases withhold the entire order. */
export const payoutEligibleSql = `o.state = 'completed' AND o.completed_at IS NOT NULL
  AND o.total_minor > 0 AND o.currency = 'KZT' AND o.admission_blocked_at IS NULL AND e.cancelled_at IS NULL
  AND p.purpose = 'ticket_order' AND p.subject_id = o.id AND p.state = 'succeeded'
  AND p.amount_minor = o.total_minor AND p.currency = o.currency AND p.actor_id = o.account_id
  AND p.provider_payment_id IS NOT NULL AND p.provider_order_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.payment_attempt_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM support_cases sc WHERE sc.order_id = o.id
    AND sc.status <> 'resolved' AND sc.category IN ('refund', 'dispute', 'compensation'))
  AND NOT EXISTS (SELECT 1 FROM simulated_payout_items paid WHERE paid.order_id = o.id)`

const payoutJoins = `FROM orders o JOIN events e ON e.id = o.event_id
  JOIN reservations reservation ON reservation.order_id = o.id AND reservation.state = 'consumed'
  JOIN payment_attempts p ON p.id = reservation.payment_attempt_id`

type Candidate = {
  order_id: string
  payment_id: string
  organizer_id: string
  revision: number
  total_minor: number
  processing_fee_minor: number
  ends_at: number
}

/** Each bounded run is a demonstration ledger transaction; it never calls a bank or payment provider. */
export async function simulateEventPayout(
  db: D1Database,
  eventId: string,
  options: { now?: () => number; beforeCommit?: () => Promise<void> } = {}
) {
  const now = options.now?.() ?? Date.now()
  const clock = options.now ? "?" : databaseNow
  const clockBindings = options.now ? [now] : []
  const due = `e.ends_at + ${platformPolicy.payoutDelayMs} <= ${clock}`
  const candidates = await db
    .prepare(`SELECT o.id order_id, p.id payment_id, e.organizer_id, o.revision,
      o.total_minor, o.processing_fee_minor, e.ends_at ${payoutJoins}
      WHERE o.event_id = ? AND ${due} AND ${payoutEligibleSql}
      ORDER BY o.id LIMIT 20`)
    .bind(eventId, ...clockBindings)
    .all<Candidate>()
  const rows = candidates.results
  if (rows.length === 0) return null
  const id = crypto.randomUUID()
  const amount = rows.reduce(
    (sum, row) => sum + row.total_minor - row.processing_fee_minor,
    0
  )
  if (!Number.isSafeInteger(amount)) throw new Error("PAYOUT_AMOUNT_OVERFLOW")
  await options.beforeCommit?.()
  const completedAt = options.now ? now : Date.now()
  try {
    await db.batch([
      ...assertSql(
        db,
        `(SELECT COUNT(*) ${payoutJoins}
        JOIN json_each(?) frozen ON o.id = json_extract(frozen.value, '$.order_id')
        WHERE o.event_id = ? AND ${due} AND ${payoutEligibleSql}
        AND p.id = json_extract(frozen.value, '$.payment_id')
        AND o.revision = json_extract(frozen.value, '$.revision')
        AND o.total_minor = json_extract(frozen.value, '$.total_minor')
        AND o.processing_fee_minor = json_extract(frozen.value, '$.processing_fee_minor')
        AND e.organizer_id = json_extract(frozen.value, '$.organizer_id')
        AND e.ends_at = json_extract(frozen.value, '$.ends_at')) = ?`,
        [JSON.stringify(rows), eventId, ...clockBindings, rows.length]
      ),
      db
        .prepare(`INSERT INTO simulated_payouts
        (id, event_id, organizer_id, currency, amount_minor, order_count, eligible_at, completed_at)
        VALUES (?, ?, ?, 'KZT', ?, ?, ?, ?)`)
        .bind(
          id,
          eventId,
          rows[0]!.organizer_id,
          amount,
          rows.length,
          rows[0]!.ends_at + platformPolicy.payoutDelayMs,
          completedAt
        ),
      ...rows.map((row) =>
        db
          .prepare(`INSERT INTO simulated_payout_items
        (id, payout_id, order_id, payment_attempt_id, paid_minor, processing_fee_minor, contribution_minor)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(
            crypto.randomUUID(),
            id,
            row.order_id,
            row.payment_id,
            row.total_minor,
            row.processing_fee_minor,
            row.total_minor - row.processing_fee_minor
          )
      ),
      ...assertSql(
        db,
        `(SELECT COUNT(*) FROM simulated_payout_items WHERE payout_id = ?) = ?
        AND (SELECT SUM(contribution_minor) FROM simulated_payout_items WHERE payout_id = ?) = ?`,
        [id, rows.length, id, amount]
      ),
      db
        .prepare(`INSERT INTO audit_entries
        (id, event_id, actor_id, scope, action, entity_id, description, correlation_id, created_at)
        VALUES (?, ?, 'system:payouts', 'event', 'payout.simulated', ?, ?, ?, ?)`)
        .bind(
          `payout:${id}`,
          eventId,
          id,
          JSON.stringify({
            simulation: true,
            amountMinor: amount,
            currency: "KZT",
            orderCount: rows.length,
          }),
          id,
          now
        ),
      db
        .prepare(`INSERT INTO outbox (id, kind, entity_id, payload_json, created_at, next_attempt_at)
        VALUES (?, 'payout.simulated', ?, ?, ?, ?)`)
        .bind(
          `payout:${id}`,
          id,
          JSON.stringify({ payoutId: id, eventId, simulation: true }),
          now,
          now
        ),
    ])
    return {
      id,
      eventId,
      simulation: true as const,
      amountMinor: amount,
      orderCount: rows.length,
    }
  } catch (error) {
    // Competing runs and a newly opened case/refund are retried by the next bounded sweep.
    if (isTransitionConflict(error)) return null
    throw error
  }
}

export async function simulateDuePayouts(db: D1Database) {
  const events = await db
    .prepare(`SELECT DISTINCT e.id ${payoutJoins}
    WHERE e.ends_at + ${platformPolicy.payoutDelayMs} <= ${databaseNow} AND ${payoutEligibleSql}
    ORDER BY e.id LIMIT 5`)
    .all<{ id: string }>()
  for (const event of events.results) await simulateEventPayout(db, event.id)
}

/** Included in the same D1 transaction that confirms a refund; original payout records stay immutable. */
export function refundedPayoutAdjustment(
  db: D1Database,
  refundId: string,
  now: number
) {
  return [
    db
      .prepare(`INSERT INTO simulated_payout_adjustments
      (id, payout_item_id, refund_id, amount_minor, created_at)
      SELECT ?, item.id, r.id, -item.contribution_minor, ? FROM refunds r
      JOIN simulated_payout_items item ON item.payment_attempt_id = r.payment_attempt_id
      WHERE r.id = ? AND r.state = 'succeeded'`)
      .bind(`refund:${refundId}`, now, refundId),
    db
      .prepare(`INSERT INTO audit_entries
      (id, event_id, actor_id, scope, action, entity_id, description, correlation_id, created_at)
      SELECT ?, p.event_id, 'system:payouts', 'event', 'payout.adjusted', adjustment.id,
        json_object('simulation', json('true'), 'payoutId', p.id, 'refundId', adjustment.refund_id,
          'amountMinor', adjustment.amount_minor, 'currency', p.currency), ?, ?
      FROM simulated_payout_adjustments adjustment JOIN simulated_payout_items item ON item.id = adjustment.payout_item_id
      JOIN simulated_payouts p ON p.id = item.payout_id WHERE adjustment.refund_id = ?`)
      .bind(`payout-adjustment:${refundId}`, refundId, now, refundId),
    db
      .prepare(`INSERT INTO outbox (id, kind, entity_id, payload_json, created_at, next_attempt_at)
      SELECT ?, 'payout.adjusted', adjustment.id,
        json_object('payoutId', p.id, 'eventId', p.event_id, 'refundId', adjustment.refund_id, 'simulation', json('true')), ?, ?
      FROM simulated_payout_adjustments adjustment JOIN simulated_payout_items item ON item.id = adjustment.payout_item_id
      JOIN simulated_payouts p ON p.id = item.payout_id WHERE adjustment.refund_id = ?`)
      .bind(`payout-adjustment:${refundId}`, now, now, refundId),
  ]
}
