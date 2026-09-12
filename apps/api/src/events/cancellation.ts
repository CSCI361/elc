import { cancelEventRequestSchema } from "@elc/shared"
import { ApiFailure } from "../db/transitions"
import { commitMutation, existingMutation, type EventContext } from "./store"

/** Cancellation blocks connected admission in the same commit as inventory and audit changes. */
export async function cancelEvent(
  context: EventContext,
  eventId: string,
  raw: unknown,
  dependencies: { beforeCommit?: () => Promise<void> } = {}
) {
  const parsed = cancelEventRequestSchema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Provide the current event revision and a cancellation reason."
    )
  const input = parsed.data
  const previous = await existingMutation(context, eventId, "event.cancel", {
    ...input,
    eventId,
  })
  if (previous.response) return previous.response
  await dependencies.beforeCommit?.()
  const { db, now } = context
  return commitMutation(context, {
    eventId,
    expectedRevision: input.expectedRevision,
    requestId: input.requestId,
    inputHash: previous.hash,
    action: "event.cancelled",
    description: input.reason,
    resourceId: eventId,
    statements: [
      db
        .prepare(
          "UPDATE events SET cancelled_at = ?, calendar_sequence = calendar_sequence + 1 WHERE id = ?"
        )
        .bind(now, eventId),
      // Preserve completed paid order snapshots while its full refund settles.
      db
        .prepare(`UPDATE orders SET admission_blocked_at = COALESCE(admission_blocked_at, ?),
        state = CASE WHEN state = 'pending' OR (state = 'completed' AND total_minor = 0) THEN 'cancelled' ELSE state END,
        revision = revision + 1 WHERE event_id = ? AND state NOT IN ('refunded', 'cancelled')`)
        .bind(now, eventId),
      db
        .prepare(
          "UPDATE tickets SET state = 'cancelled' WHERE event_id = ? AND state <> 'refunded'"
        )
        .bind(eventId),
      db
        .prepare(
          "UPDATE inventory SET reservation_id = NULL WHERE event_id = ? AND order_id IS NULL"
        )
        .bind(eventId),
      db
        .prepare(`UPDATE promo_allocations SET released_at = ? WHERE committed_at IS NULL AND released_at IS NULL
        AND order_id IN (SELECT id FROM orders WHERE event_id = ?)`)
        .bind(now, eventId),
      db
        .prepare(
          "UPDATE reservations SET state = 'abandoned' WHERE event_id = ? AND state = 'active'"
        )
        .bind(eventId),
      db
        .prepare(`INSERT INTO outbox (id, kind, entity_id, payload_json, created_at, next_attempt_at)
        VALUES (?, 'event.cancellation', ?, ?, ?, ?)`)
        .bind(
          `event-cancel:${eventId}`,
          eventId,
          JSON.stringify({ eventId }),
          now,
          now
        ),
      // Reconcile in-flight payments independently, including checkout replies already received.
      db
        .prepare(`INSERT INTO outbox (id, kind, entity_id, payload_json, created_at, next_attempt_at)
        SELECT 'payment-reconcile:' || p.id, 'payment.reconcile', p.id,
          json_object('paymentAttemptId', p.id), ?, ? FROM payment_attempts p JOIN orders o ON o.id = p.subject_id
        WHERE p.purpose = 'ticket_order' AND o.event_id = ? AND o.completed_at IS NULL
        ON CONFLICT(id) DO UPDATE SET completed_at = NULL, next_attempt_at = excluded.next_attempt_at`)
        .bind(now, now, eventId),
    ],
  })
}
