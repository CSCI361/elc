import { DEMO_PAID_TERMS_VERSION } from "@elc/shared"
import { recordPaymentStatus } from "../payments/reconcile"
import { loadPayment, paymentBinding } from "../payments/store"
import { completeActivation } from "./complete"
import { updateActivation } from "./mutations"
import { prepareActivationPayment } from "./payment"

/** Real activation transitions with synthetic provider confirmation, for isolated D1 tests. */
export async function activateTestEvent(
  db: D1Database,
  eventId: string,
  ownerId: string,
  now: number
) {
  const dependencies = { now: () => now }
  const saved = await updateActivation(
    db,
    ownerId,
    eventId,
    {
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
      profile: {
        displayName: "Test organizer",
        legalName: "Test Organizer",
        contact: "test@example.test",
        dummyPayoutReference: "DEMO-TEST",
      },
      identityCheck: "passed",
      payoutCheck: "passed",
      acceptedTermsVersion: DEMO_PAID_TERMS_VERSION,
    },
    dependencies
  )
  const result = await prepareActivationPayment(
    {
      DB: db,
      APP_ORIGIN: "https://app.example.test",
      TICKET_ENCRYPTION_KEY: "A".repeat(43),
    },
    ownerId,
    eventId,
    {
      requestId: crypto.randomUUID(),
      expectedRevision: saved.activation.revision,
    },
    dependencies
  )
  const payment = await loadPayment(db, result.payment.id)
  await recordPaymentStatus(
    db,
    {
      ...paymentBinding(payment),
      providerPaymentId: `checkout-${payment.id}`,
      providerOrderId: `order-${payment.id}`,
      state: "succeeded",
      refundedAmountMinor: 0,
    },
    now
  )
  await completeActivation(db, payment.id, dependencies)
  // Each caller asserts only the effects of its checkout/payment scenario.
  await db.batch([
    db.prepare("DELETE FROM request_receipts"),
    db.prepare("DELETE FROM audit_entries"),
    db.prepare("DELETE FROM outbox"),
  ])
  return payment.id
}
