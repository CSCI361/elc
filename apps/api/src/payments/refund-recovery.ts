import {
  refundRecoveryResponseSchema,
  refundRecoveryViewSchema,
  requestRefundRecoverySchema,
  type PaymentAdapter,
} from "@elc/shared"
import { z } from "zod"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  readReceipt,
  requestHash,
} from "../db/transitions"
import { refundAuthoritySql } from "./voluntary"
import {
  applyRefundStatus,
  executeRefundOperation,
  loadRefund,
  validatedRefundRequest,
  type RefundRow,
} from "./refunds"
import { loadPayment, paymentAudit } from "./store"

const rejectedSql =
  "r.state = 'failed' AND r.dispatch_state = 'reconciled' AND r.provider_refund_id IS NULL AND r.last_error_code = 'PROVIDER_REJECTED'"
const noPendingRecovery =
  "NOT EXISTS (SELECT 1 FROM outbox recovery WHERE recovery.kind = 'refund.recovery' AND recovery.entity_id = r.id AND recovery.completed_at IS NULL)"
const recoveryJobSchema = z.strictObject({
  refundId: z.string(),
  action: z.enum(["reconcile", "retry_rejected"]),
})

async function authorizedRefund(
  db: D1Database,
  actorId: string,
  refundId: string
) {
  const row = await db
    .prepare(`SELECT r.*, e.id event_id, (${rejectedSql}) retry_rejected, (${noPendingRecovery}) no_pending_recovery
    FROM refunds r JOIN payment_attempts p ON p.id = r.payment_attempt_id
    LEFT JOIN orders o ON p.purpose = 'ticket_order' AND o.id = p.subject_id
    JOIN events e ON e.id = CASE WHEN p.purpose = 'ticket_order' THEN o.event_id ELSE p.subject_id END
    JOIN user actor ON actor.id = ? LEFT JOIN profiles profile ON profile.user_id = actor.id
    WHERE r.id = ? AND actor.email_verified = 1 AND profile.suspended_at IS NULL
    AND (e.organizer_id = actor.id OR EXISTS (SELECT 1 FROM event_permissions ep
      WHERE ep.event_id = e.id AND ep.user_id = actor.id AND ep.permission = 'refund:initiate' AND ep.revoked_at IS NULL))`)
    .bind(actorId, refundId)
    .first<
      RefundRow & {
        event_id: string
        retry_rejected: number
        no_pending_recovery: number
      }
    >()
  if (!row) throw new ApiFailure("NOT_FOUND", 404, "Refund recovery not found.")
  return row
}

export async function readRefundRecovery(
  db: D1Database,
  actorId: string,
  refundId: string
) {
  const row = await authorizedRefund(db, actorId, refundId)
  return refundRecoveryViewSchema.parse({
    refundId,
    eventId: row.event_id,
    state: row.state,
    updatedAt: new Date(row.updated_at).toISOString(),
    recoveryPending: row.no_pending_recovery !== 1,
    canRetryRejected: row.retry_rejected === 1 && row.no_pending_recovery === 1,
    canReconcile: row.state !== "succeeded" && row.no_pending_recovery === 1,
  })
}

/** Authorization preserves the existing refund obligation and never unblocks admission or payouts. */
export async function requestRefundRecovery(
  db: D1Database,
  actorId: string,
  refundId: string,
  raw: unknown,
  options: { beforeCommit?: () => Promise<void> } = {}
) {
  const input = requestRefundRecoverySchema.parse(raw)
  const refund = await authorizedRefund(db, actorId, refundId)
  const hash = await requestHash("refund.recovery", { refundId, ...input })
  const previous = await readReceipt(db, actorId, input.requestId, hash)
  if (previous?.responseJson)
    return refundRecoveryResponseSchema.parse(JSON.parse(previous.responseJson))
  await validatedRefundRequest(db, refund)
  const id = crypto.randomUUID()
  const now = Date.now()
  const response = {
    refundId,
    recoveryId: id,
    action: input.action,
    state: "queued" as const,
  }
  const authority = refundAuthoritySql(actorId, refund.event_id)
  const eligible = `EXISTS (SELECT 1 FROM refunds r WHERE r.id = ? AND r.updated_at = ? AND r.state <> 'succeeded'
    AND r.state = ? AND r.dispatch_state = ? AND r.last_error_code IS ? AND r.provider_refund_id IS ?
    AND ${noPendingRecovery} ${input.action === "retry_rejected" ? `AND (${rejectedSql})` : ""})`
  await options.beforeCommit?.()
  try {
    await db.batch([
      ...assertSql(db, authority.predicate, authority.bindings),
      ...assertSql(db, eligible, [
        refundId,
        Date.parse(input.expectedUpdatedAt),
        refund.state,
        refund.dispatch_state,
        refund.last_error_code,
        refund.provider_refund_id,
      ]),
      ...(input.action === "retry_rejected"
        ? [
            db
              .prepare(
                "UPDATE refunds SET state = 'pending', updated_at = ? WHERE id = ?"
              )
              .bind(now, refundId),
          ]
        : []),
      db
        .prepare(`INSERT INTO outbox (id, kind, entity_id, payload_json, created_at, next_attempt_at)
        VALUES (?, 'refund.recovery', ?, ?, ?, ?)`)
        .bind(
          id,
          refundId,
          JSON.stringify({ refundId, action: input.action }),
          now,
          now
        ),
      db
        .prepare(`INSERT INTO audit_entries (id, event_id, actor_id, scope, action, entity_id, description, correlation_id, created_at)
        VALUES (?, ?, ?, 'event', 'refund.recovery_requested', ?, ?, ?, ?)`)
        .bind(
          id,
          refund.event_id,
          actorId,
          refundId,
          JSON.stringify({
            recoveryId: id,
            action: input.action,
            reason: input.reason,
            previousState: refund.state,
            previousDispatchState: refund.dispatch_state,
            previousErrorCode: refund.last_error_code,
            previousUpdatedAt: refund.updated_at,
          }),
          input.requestId,
          now
        ),
      db
        .prepare(`INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, response_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(
          actorId,
          input.requestId,
          hash,
          id,
          JSON.stringify(response),
          now
        ),
    ])
    return refundRecoveryResponseSchema.parse(response)
  } catch (error) {
    if (!isTransitionConflict(error)) throw error
    await authorizedRefund(db, actorId, refundId)
    const replay = await readReceipt(db, actorId, input.requestId, hash)
    if (replay?.responseJson)
      return refundRecoveryResponseSchema.parse(JSON.parse(replay.responseJson))
    throw new ApiFailure(
      "CONFLICT",
      409,
      "The refund changed or another recovery is pending. Refresh its status."
    )
  }
}

/** A lost response keeps its claim forever; only lookups can follow that claim. */
export async function consumeRefundRecovery(
  db: D1Database,
  adapter: PaymentAdapter,
  recoveryId: string
) {
  const job = await db
    .prepare(
      "SELECT payload_json, completed_at FROM outbox WHERE id = ? AND kind = 'refund.recovery'"
    )
    .bind(recoveryId)
    .first<{ payload_json: string; completed_at: number | null }>()
  if (!job || job.completed_at !== null) return true
  const input = recoveryJobSchema.parse(JSON.parse(job.payload_json))
  let refund = await loadRefund(db, input.refundId)
  if (refund.state === "succeeded") return true
  const now = Date.now()
  if (input.action === "reconcile")
    return executeRefundOperation(
      db,
      adapter,
      refund.id,
      false,
      now,
      recoveryId
    )
  const claimed = await db
    .prepare(
      "SELECT 1 FROM request_receipts WHERE actor_id = 'system:refund-recovery-dispatch' AND request_id = ?"
    )
    .bind(recoveryId)
    .first()
  if (!claimed) {
    // A definite rejection can be retried only after a fresh successful provider lookup.
    const request = await validatedRefundRequest(db, refund)
    const existing = await adapter.lookupRefund(request)
    if (existing) {
      await applyRefundStatus(db, existing, now)
      return existing.state !== "pending"
    }
    const payment = await loadPayment(db, refund.payment_attempt_id)
    try {
      await db.batch([
        ...assertSql(
          db,
          `EXISTS (SELECT 1 FROM refunds r WHERE r.id = ? AND r.state = 'pending'
          AND r.dispatch_state IN ('reconciled', 'uncertain') AND r.provider_refund_id IS NULL)`,
          [refund.id]
        ),
        db
          .prepare(`INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, created_at)
          VALUES ('system:refund-recovery-dispatch', ?, 'refund-recovery-v1', ?, ?)`)
          .bind(recoveryId, refund.id, now),
        db
          .prepare(
            "UPDATE refunds SET dispatch_state = 'dispatched', last_error_code = NULL, updated_at = ? WHERE id = ?"
          )
          .bind(now, refund.id),
        paymentAudit(
          db,
          payment,
          "refund.recovery_dispatched",
          now,
          "system:payments",
          { refundId: refund.id, recoveryId }
        ),
      ])
    } catch (error) {
      if (!isTransitionConflict(error)) throw error
      refund = await loadRefund(db, refund.id)
      if (refund.state === "succeeded") return true
      return false
    }
    await executeRefundOperation(db, adapter, refund.id, true, now, recoveryId)
  } else {
    await executeRefundOperation(db, adapter, refund.id, false, now, recoveryId)
  }
  refund = await loadRefund(db, refund.id)
  return (
    refund.state === "succeeded" ||
    (refund.state === "failed" && refund.dispatch_state === "reconciled")
  )
}
