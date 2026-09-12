import { ApiFailure, assertSql, isTransitionConflict } from "../db/transitions"
import { checkoutRequest, loadPayment } from "../payments/store"
import { activationEligibilitySql } from "./guards"
import {
  activationAudit,
  activationOutbox,
  loadActivation,
  type ActivationDependencies,
} from "./store"

export async function completedActivation(
  db: D1Database,
  paymentAttemptId: string
) {
  const row = await db
    .prepare(
      "SELECT event_id, activated_at FROM event_activations WHERE successful_payment_attempt_id = ?"
    )
    .bind(paymentAttemptId)
    .first<{ event_id: string; activated_at: number }>()
  return row
    ? { eventId: row.event_id, paymentAttemptId, activatedAt: row.activated_at }
    : null
}

/** Completion preserves the payment fact. Its caller compensates an unfulfilled success. */
export async function completeActivation(
  db: D1Database,
  paymentAttemptId: string,
  dependencies: ActivationDependencies = {}
) {
  const replay = await completedActivation(db, paymentAttemptId)
  if (replay) return replay
  const payment = await loadPayment(db, paymentAttemptId)
  if (
    payment.purpose !== "event_activation" ||
    payment.state !== "succeeded" ||
    payment.succeeded_at === null ||
    !payment.provider_payment_id ||
    !payment.provider_order_id ||
    !payment.actor_id
  )
    throw new ApiFailure(
      "PAYMENT_MISMATCH",
      409,
      "A confirmed activation payment is required."
    )
  checkoutRequest(payment)
  const activation = await loadActivation(db, payment.subject_id)
  if (!activation || activation.successful_payment_attempt_id)
    throw new ApiFailure(
      "CONFLICT",
      409,
      "This event cannot consume another activation payment."
    )
  await dependencies.beforeCommit?.()
  const now = (dependencies.now ?? Date.now)()
  const eligible = activationEligibilitySql(payment, now, !!dependencies.now)
  try {
    await db.batch([
      ...assertSql(db, eligible.predicate, eligible.bindings),
      ...assertSql(
        db,
        "EXISTS (SELECT 1 FROM payment_attempts WHERE id = ? AND purpose = 'event_activation' AND state = 'succeeded' AND succeeded_at IS NOT NULL AND provider_payment_id = ? AND provider_order_id = ?)",
        [payment.id, payment.provider_payment_id, payment.provider_order_id]
      ),
      db
        .prepare(
          "UPDATE event_activations SET successful_payment_attempt_id = ?, activated_at = ?, revision = revision + 1, updated_at = ? WHERE event_id = ?"
        )
        .bind(payment.id, now, now, payment.subject_id),
      db
        .prepare(
          "UPDATE events SET paid_sales_state = 'active', revision = revision + 1, updated_at = ? WHERE id = ?"
        )
        .bind(now, payment.subject_id),
      activationAudit(
        db,
        payment.subject_id,
        "system:activation",
        "activation.completed",
        payment.id,
        now
      ),
      activationOutbox(
        db,
        payment.subject_id,
        "activation.completed",
        now,
        payment.id
      ),
    ])
  } catch (error) {
    const completed = await completedActivation(db, paymentAttemptId)
    if (completed) return completed
    if (isTransitionConflict(error))
      throw new ApiFailure(
        "CONFLICT",
        409,
        "The activation checklist or event eligibility changed before completion."
      )
    throw error
  }
  return { eventId: payment.subject_id, paymentAttemptId, activatedAt: now }
}
