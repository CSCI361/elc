import { type PaymentAdapter, type VerifiedProviderEvent } from "@elc/shared"
import {
  ApiFailure,
  isTransitionConflict,
  requestHash,
} from "../db/transitions"
import { loadPayment, paymentBinding } from "./store"

/** Persist verified, normalized facts before acknowledgement; raw customer payloads stay out of storage. */
export async function acceptProviderWebhook(
  db: D1Database,
  adapter: PaymentAdapter,
  rawBody: string,
  headers: Readonly<Record<string, string>>,
  now = Date.now()
) {
  const event = await adapter.verifyWebhook(rawBody, headers)
  if (!event) return { accepted: true as const }
  const payment = await loadPayment(db, event.paymentAttemptId)
  const expected = paymentBinding(payment)
  if (
    Object.entries(expected).some(
      ([key, value]) => event[key as keyof VerifiedProviderEvent] !== value
    ) ||
    (payment.provider_payment_id !== null &&
      payment.provider_payment_id !== event.providerPaymentId) ||
    (payment.provider_order_id !== null &&
      event.providerOrderId !== null &&
      payment.provider_order_id !== event.providerOrderId)
  )
    throw new ApiFailure(
      "PAYMENT_MISMATCH",
      409,
      "The provider event does not match its payment."
    )
  const inputHash = await requestHash("polar.webhook", rawBody)
  const id = crypto.randomUUID()
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO provider_events (id, provider, provider_event_id, input_hash, payment_attempt_id, payload_json, received_at)
        VALUES (?, 'polar_sandbox', ?, ?, ?, ?, ?)`)
        .bind(
          id,
          event.providerEventId,
          inputHash,
          payment.id,
          JSON.stringify(event),
          now
        ),
      db
        .prepare(`INSERT INTO outbox (id, kind, entity_id, payload_json, created_at, next_attempt_at)
        VALUES (?, 'provider.event', ?, ?, ?, ?)`)
        .bind(
          `provider-event:${id}`,
          id,
          JSON.stringify({ providerEventId: id, paymentAttemptId: payment.id }),
          now,
          now
        ),
      db
        .prepare(
          "UPDATE outbox SET completed_at = NULL, next_attempt_at = ? WHERE id = ?"
        )
        .bind(now, `payment-reconcile:${payment.id}`),
    ])
  } catch (error) {
    if (!isTransitionConflict(error)) throw error
    const existing = await db
      .prepare(
        "SELECT input_hash FROM provider_events WHERE provider = 'polar_sandbox' AND provider_event_id = ?"
      )
      .bind(event.providerEventId)
      .first<{ input_hash: string }>()
    if (existing?.input_hash === inputHash) return { accepted: true as const }
    throw new ApiFailure(
      "CONFLICT",
      409,
      "This provider event identifier already has different contents."
    )
  }
  return { accepted: true as const }
}
