import {
  ProviderOperationError,
  providerPaymentStatusSchema,
  type PaymentAdapter,
  type ProviderCheckout,
  type ProviderPaymentStatus,
} from "@elc/shared"
import { HTTPException } from "hono/http-exception"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  requestHash,
} from "../db/transitions"
import { completePaidOrder } from "../tickets/issue"
import type { PaymentDependencies, PaymentEnvironment } from "./checkout"
import { applyRefundStatus, ensureCompensation, processRefund } from "./refunds"
import {
  checkoutRequest,
  claimPaymentDispatch,
  loadPayment,
  paymentAudit,
  paymentBinding,
  type PaymentRow,
} from "./store"

async function saveCheckout(
  db: D1Database,
  payment: PaymentRow,
  result: ProviderCheckout,
  now: number
) {
  await db.batch([
    ...assertSql(
      db,
      `EXISTS (SELECT 1 FROM payment_attempts WHERE id = ? AND request_hash = ?
      AND (provider_payment_id IS NULL OR provider_payment_id = ?))`,
      [payment.id, payment.request_hash, result.providerPaymentId]
    ),
    db
      .prepare(`UPDATE payment_attempts SET provider_payment_id = ?, checkout_url = COALESCE(checkout_url, ?),
      dispatch_state = 'reconciled', last_error_code = NULL, updated_at = ? WHERE id = ?`)
      .bind(result.providerPaymentId, result.checkoutUrl, now, payment.id),
    paymentAudit(db, payment, "payment.checkout_linked", now),
  ])
}

export async function recordPaymentStatus(
  db: D1Database,
  raw: ProviderPaymentStatus,
  now = Date.now()
) {
  const status = providerPaymentStatusSchema.parse(raw)
  const payment = await loadPayment(db, status.paymentAttemptId)
  const binding = paymentBinding(payment)
  if (
    Object.entries(binding).some(
      ([key, value]) => status[key as keyof ProviderPaymentStatus] !== value
    ) ||
    (payment.provider_payment_id !== null &&
      status.providerPaymentId !== payment.provider_payment_id) ||
    (payment.provider_order_id !== null &&
      status.providerOrderId !== payment.provider_order_id) ||
    (status.state === "succeeded" && status.providerOrderId === null)
  )
    throw new ApiFailure(
      "PAYMENT_MISMATCH",
      409,
      "The provider payment does not match its frozen order."
    )
  const hash = await requestHash("payment.fact", status)
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, created_at)
        VALUES ('system:payment-fact', ?, ?, ?, ?)`)
        .bind(hash, hash, payment.id, now),
      ...assertSql(
        db,
        `EXISTS (SELECT 1 FROM payment_attempts WHERE id = ? AND request_hash = ?
        AND (provider_payment_id IS NULL OR provider_payment_id = ?)
        AND (provider_order_id IS NULL OR provider_order_id = ?))`,
        [
          payment.id,
          binding.requestHash,
          status.providerPaymentId,
          status.providerOrderId,
        ]
      ),
      db
        .prepare(`UPDATE payment_attempts SET provider_payment_id = ?, provider_order_id = COALESCE(provider_order_id, ?),
        state = CASE WHEN state = 'succeeded' THEN 'succeeded' ELSE ? END,
        succeeded_at = CASE WHEN ? = 'succeeded' THEN COALESCE(succeeded_at, ?) ELSE succeeded_at END,
        dispatch_state = 'reconciled', last_error_code = NULL, updated_at = ? WHERE id = ?`)
        .bind(
          status.providerPaymentId,
          status.providerOrderId,
          status.state,
          status.state,
          now,
          now,
          payment.id
        ),
      paymentAudit(db, payment, `payment.${status.state}`, now),
      ...(status.refundedAmountMinor === 0 || payment.purpose !== "ticket_order"
        ? []
        : [
            db
              .prepare(
                "UPDATE orders SET admission_blocked_at = COALESCE(admission_blocked_at, ?), revision = revision + 1 WHERE id = ?"
              )
              .bind(now, payment.subject_id),
          ]),
    ])
  } catch (error) {
    if (!isTransitionConflict(error)) throw error
    const receipt = await db
      .prepare(
        "SELECT 1 FROM request_receipts WHERE actor_id = 'system:payment-fact' AND request_id = ?"
      )
      .bind(hash)
      .first()
    if (!receipt) throw error
  }
}

/** Returns true only when there is no immediate reconciliation work remaining. */
export async function processPayment(
  env: PaymentEnvironment,
  adapter: PaymentAdapter,
  paymentId: string,
  dependencies: PaymentDependencies = {}
): Promise<boolean> {
  const now = dependencies.now ?? Date.now
  const db = env.DB
  let payment = await loadPayment(db, paymentId)
  if (
    !payment.provider_payment_id &&
    payment.dispatch_state === "reconciled" &&
    ["failed", "cancelled"].includes(payment.state)
  )
    return true
  const request = checkoutRequest(payment)
  if (payment.provider_payment_id === null) {
    const claimed =
      payment.dispatch_state === "prepared" &&
      (await claimPaymentDispatch(db, payment, now(), !!dependencies.now))
    if (!claimed) {
      payment = await loadPayment(db, paymentId)
      if (payment.state === "cancelled") return true
    }
    try {
      const checkout = claimed
        ? await adapter.createCheckout(request)
        : await adapter.recoverCheckout(request)
      if (!checkout) return false
      await saveCheckout(db, payment, checkout, now())
    } catch (error) {
      payment = await loadPayment(db, paymentId)
      if (payment.state === "succeeded") return false
      const definite =
        claimed &&
        error instanceof ProviderOperationError &&
        error.outcome === "definite_failure"
      await db.batch([
        db
          .prepare(
            `UPDATE payment_attempts SET state = ?, dispatch_state = ?, last_error_code = ?, updated_at = ? WHERE id = ? AND state <> 'succeeded'`
          )
          .bind(
            definite ? "failed" : payment.state,
            definite ? "reconciled" : "uncertain",
            error instanceof ProviderOperationError
              ? error.code
              : "RECONCILIATION_REQUIRED",
            now(),
            payment.id
          ),
        paymentAudit(
          db,
          payment,
          definite ? "payment.dispatch_failed" : "payment.dispatch_uncertain",
          now()
        ),
      ])
      return definite
    }
    payment = await loadPayment(db, paymentId)
  }
  if (!payment.provider_payment_id) return false
  let status: ProviderPaymentStatus
  try {
    status = await adapter.lookupPayment({
      providerPaymentId: payment.provider_payment_id,
      ...(payment.provider_order_id
        ? { providerOrderId: payment.provider_order_id }
        : {}),
      expected: paymentBinding(payment),
    })
    await recordPaymentStatus(db, status, now())
  } catch (error) {
    await db
      .prepare(
        "UPDATE payment_attempts SET last_error_code = ?, updated_at = ? WHERE id = ?"
      )
      .bind(
        error instanceof ProviderOperationError
          ? error.code
          : "RECONCILIATION_REQUIRED",
        now(),
        payment.id
      )
      .run()
    return false
  }
  payment = await loadPayment(db, paymentId)
  if (payment.state !== "succeeded")
    return payment.state === "failed" || payment.state === "cancelled"
  const existingRefund = await db
    .prepare("SELECT id, state FROM refunds WHERE payment_attempt_id = ?")
    .bind(paymentId)
    .first<{ id: string; state: string }>()
  if (existingRefund) {
    await processRefund(db, adapter, existingRefund.id, now(), {
      lookupOnly: status.refundedAmountMinor > 0,
    })
    return (
      (
        await db
          .prepare("SELECT state FROM refunds WHERE id = ?")
          .bind(existingRefund.id)
          .first<{ state: string }>()
      )?.state === "succeeded"
    )
  }
  // A provider refund discovered before its webhook must block fulfillment immediately.
  // A refund without our stable reference needs reconciliation, never another blind POST.
  if (status.refundedAmountMinor > 0) {
    await db
      .prepare(
        "UPDATE payment_attempts SET last_error_code = 'RECONCILIATION_REQUIRED' WHERE id = ?"
      )
      .bind(payment.id)
      .run()
    return false
  }
  if (payment.purpose === "event_activation") return false
  try {
    await completePaidOrder(env, payment.id, dependencies)
    return true
  } catch (error) {
    if (!(error instanceof HTTPException) || ![403, 409].includes(error.status))
      throw error
    const completed = await db
      .prepare("SELECT state FROM orders WHERE id = ?")
      .bind(payment.subject_id)
      .first<{ state: string }>()
    if (completed?.state === "completed") return true
    let refundId: string
    try {
      refundId = await ensureCompensation(db, payment, now())
    } catch (compensationError) {
      const current = await db
        .prepare("SELECT state FROM orders WHERE id = ?")
        .bind(payment.subject_id)
        .first<{ state: string }>()
      if (current?.state === "completed") return true
      throw compensationError
    }
    await processRefund(db, adapter, refundId, now())
    return (
      (
        await db
          .prepare("SELECT state FROM refunds WHERE id = ?")
          .bind(refundId)
          .first<{ state: string }>()
      )?.state === "succeeded"
    )
  }
}

export { applyRefundStatus }
