import { verifiedProviderEventSchema, type PaymentAdapter } from "@elc/shared"
import type { Bindings } from "../env"
import { applyRefundStatus, processPayment } from "./reconcile"
import { prepareEventCancellationRefunds, processRefund } from "./refunds"
import { consumeRefundRecovery } from "./refund-recovery"

const paymentKinds = [
  "payment.reconcile",
  "refund.reconcile",
  "refund.recovery",
  "provider.event",
  "event.cancellation",
]

export async function dispatchPaymentOutbox(
  env: Pick<Bindings, "DB" | "DELIVERY">,
  now = Date.now()
) {
  const pending =
    await env.DB.prepare(`SELECT id FROM outbox WHERE kind IN ('payment.reconcile', 'refund.reconcile', 'refund.recovery', 'provider.event', 'event.cancellation')
    AND completed_at IS NULL AND next_attempt_at <= ? ORDER BY next_attempt_at, id LIMIT 20`)
      .bind(now)
      .all<{ id: string }>()
  for (const row of pending.results) {
    try {
      await env.DELIVERY.send({ id: row.id })
      await env.DB.prepare(
        "UPDATE outbox SET dispatched_at = ?, next_attempt_at = ? WHERE id = ? AND completed_at IS NULL"
      )
        .bind(now, now + 60_000, row.id)
        .run()
    } catch {
      // The committed outbox remains available to the next scheduled sweep.
      console.warn(JSON.stringify({ code: "PAYMENT_QUEUE_DISPATCH_FAILED" }))
    }
  }
}

export async function consumePaymentOutbox(
  env: Pick<Bindings, "DB" | "APP_ORIGIN" | "TICKET_ENCRYPTION_KEY">,
  adapter: PaymentAdapter | (() => PaymentAdapter),
  id: string
) {
  const row = await env.DB.prepare("SELECT * FROM outbox WHERE id = ?")
    .bind(id)
    .first<{
      id: string
      kind: string
      entity_id: string
      completed_at: number | null
      attempts: number
    }>()
  if (!row || row.completed_at !== null) return true
  if (!paymentKinds.includes(row.kind)) return false
  const provider = () => (typeof adapter === "function" ? adapter() : adapter)
  let complete = false
  try {
    if (row.kind === "event.cancellation")
      complete = await prepareEventCancellationRefunds(env.DB, row.entity_id)
    if (row.kind === "payment.reconcile")
      complete = await processPayment(env, provider(), row.entity_id)
    if (row.kind === "refund.recovery")
      complete = await consumeRefundRecovery(env.DB, provider(), row.id)
    if (row.kind === "refund.reconcile") {
      await processRefund(env.DB, provider(), row.entity_id)
      const refund = await env.DB.prepare(
        "SELECT state FROM refunds WHERE id = ?"
      )
        .bind(row.entity_id)
        .first<{ state: string }>()
      complete = refund?.state === "succeeded"
    }
    if (row.kind === "provider.event") {
      const stored = await env.DB.prepare(
        "SELECT payload_json FROM provider_events WHERE id = ?"
      )
        .bind(row.entity_id)
        .first<{ payload_json: string }>()
      if (stored) {
        const event = verifiedProviderEventSchema.parse(
          JSON.parse(stored.payload_json)
        )
        if (event.kind === "refund") {
          // Resolve missing checkout/order identities before applying a refund received first.
          await processPayment(env, provider(), event.paymentAttemptId)
          const {
            kind: _kind,
            providerEventId: _providerEventId,
            ...refundStatus
          } = event
          await applyRefundStatus(env.DB, refundStatus)
        }
        // Payment lookup is authoritative, including refunds received before payment events.
        complete = await processPayment(env, provider(), event.paymentAttemptId)
        if (complete)
          await env.DB.prepare(
            "UPDATE provider_events SET processed_at = ? WHERE id = ?"
          )
            .bind(Date.now(), row.entity_id)
            .run()
      } else {
        complete = true
      }
    }
    const now = Date.now()
    await env.DB.prepare(`UPDATE outbox SET completed_at = CASE WHEN ? = 1 THEN ? ELSE completed_at END,
      attempts = attempts + 1, next_attempt_at = ? WHERE id = ? AND completed_at IS NULL`)
      .bind(
        complete ? 1 : 0,
        now,
        now + Math.min(900_000, 15_000 * 2 ** Math.min(row.attempts, 6)),
        id
      )
      .run()
  } catch {
    console.warn(JSON.stringify({ code: "PAYMENT_OUTBOX_RETRY", outboxId: id }))
    await env.DB.prepare(
      "UPDATE outbox SET attempts = attempts + 1, next_attempt_at = ? WHERE id = ? AND completed_at IS NULL"
    )
      .bind(Date.now() + 60_000, id)
      .run()
  }
  // Acknowledgement is safe because incomplete work is retained in D1 for Cron replay.
  return true
}
