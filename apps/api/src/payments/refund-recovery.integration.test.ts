import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { ProviderOperationError, type PaymentAdapter } from "@elc/shared"
import { createSupportCase } from "../support/service"
import { consumePaymentOutbox } from "./outbox"
import { readOrderRefund } from "./refund-read"
import { readRefundRecovery, requestRefundRecovery } from "./refund-recovery"
import {
  applyRefundStatus,
  loadRefund,
  processRefund,
  validatedRefundRequest,
} from "./refunds"
import { processPayment } from "./reconcile"
import { createPaymentFixture } from "./test-fixture"
import { approveOrderRefund } from "./voluntary"

describe("D1 authorized refund recovery", () => {
  let f: Awaited<ReturnType<typeof createPaymentFixture>>
  let refundId: string
  beforeEach(async () => {
    f = await createPaymentFixture()
    f.provider.state = "succeeded"
    await processPayment(f.env, f.provider, f.paymentId, { now: () => f.now })
    const opened = await createSupportCase(f.db, "buyer", {
      requestId: "case",
      audience: "attendee",
      category: "refund",
      orderId: f.checkout.order.id,
      subject: "Refund request",
      body: "Please refund the booking.",
    })
    const revision = (await f.db
      .prepare("SELECT revision FROM orders WHERE id = ?")
      .bind(f.checkout.order.id)
      .first<number>("revision"))!
    refundId = (
      await approveOrderRefund(f.db, "owner", f.checkout.order.id, {
        requestId: "approve",
        expectedRevision: revision,
        reason: "Approved by organizer",
        caseId: opened.case.id,
      })
    ).refundId
    f.provider.refundOutcome = "definite_failure"
    await processRefund(f.db, f.provider, refundId)
  })
  afterEach(async () => {
    await f?.runtime.dispose()
  })
  async function input(
    action: "retry_rejected" | "reconcile" = "retry_rejected",
    requestId = "recover"
  ) {
    const view = await readRefundRecovery(f.db, "owner", refundId)
    return {
      requestId,
      action,
      expectedUpdatedAt: view.updatedAt,
      reason: "Provider access has been restored.",
    }
  }
  const recover = async () =>
    requestRefundRecovery(f.db, "owner", refundId, await input())
  const consume = (id: string, adapter: PaymentAdapter = f.provider) =>
    consumePaymentOutbox(f.env, adapter, id)
  const complete = (id: string) =>
    f.db
      .prepare("SELECT completed_at FROM outbox WHERE id = ?")
      .bind(id)
      .first<number | null>("completed_at")

  it("keeps the rejected attempt, authorization and frozen request while retrying the same full refund once", async () => {
    const original = await loadRefund(f.db, refundId)
    const request = await input()
    expect(await readRefundRecovery(f.db, "owner", refundId)).toMatchObject({
      canRetryRejected: true,
      canReconcile: true,
    })
    const approved = await requestRefundRecovery(
      f.db,
      "owner",
      refundId,
      request
    )
    expect(
      await requestRefundRecovery(f.db, "owner", refundId, request)
    ).toEqual(approved)
    expect(f.provider.refunds).toHaveLength(1)
    expect(
      await readOrderRefund(f.db, "buyer", f.checkout.order.id)
    ).toMatchObject({ admissionBlocked: true, payoutHeld: true })
    expect(await readRefundRecovery(f.db, "owner", refundId)).toMatchObject({
      recoveryPending: true,
      canRetryRejected: false,
    })
    f.provider.refundOutcome = "success"
    await consume(approved.recoveryId)
    await consume(approved.recoveryId)
    await processRefund(f.db, f.provider, refundId)
    expect(f.provider.refunds).toHaveLength(2)
    expect(f.provider.refunds[1]).toEqual(f.provider.refunds[0])
    expect(await complete(approved.recoveryId)).not.toBeNull()
    expect((await loadRefund(f.db, refundId)).request_json).toBe(
      original.request_json
    )
    expect(await f.scalar("SELECT count(*) n FROM refunds")).toBe(1)
    const history = await f.db
      .prepare(
        "SELECT description FROM audit_entries WHERE action = 'refund.recovery_requested'"
      )
      .first<string>("description")
    expect(JSON.parse(history!)).toMatchObject({
      previousState: "failed",
      previousDispatchState: "reconciled",
      previousErrorCode: "PROVIDER_REJECTED",
      reason: request.reason,
      action: "retry_rejected",
    })
    expect(await readRefundRecovery(f.db, "owner", refundId)).toMatchObject({
      state: "succeeded",
      canRetryRejected: false,
      canReconcile: false,
    })
    await expect(
      requestRefundRecovery(
        f.db,
        "owner",
        refundId,
        await input("reconcile", "again")
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })

  it("a repeated provider rejection stays blocked and needs another explicit authorization", async () => {
    const first = await recover()
    await consume(first.recoveryId)
    expect(f.provider.refunds).toHaveLength(2)
    expect(await complete(first.recoveryId)).not.toBeNull()
    expect(await readRefundRecovery(f.db, "owner", refundId)).toMatchObject({
      state: "failed",
      canRetryRejected: true,
    })
    await processRefund(f.db, f.provider, refundId)
    expect(f.provider.refunds).toHaveLength(2)
    const second = await requestRefundRecovery(
      f.db,
      "owner",
      refundId,
      await input("retry_rejected", "retry-again")
    )
    f.provider.refundOutcome = "success"
    await consume(second.recoveryId)
    expect(f.provider.refunds).toHaveLength(3)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM audit_entries WHERE action = 'refund.dispatch_failed'"
      )
    ).toBe(2)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM audit_entries WHERE action = 'refund.recovery_requested'"
      )
    ).toBe(2)
  })

  it("an uncertain retry is never posted twice, even while provider lookup temporarily finds nothing", async () => {
    const approved = await recover()
    f.provider.refundOutcome = "uncertain"
    await consume(approved.recoveryId)
    f.provider.refundVisible = false
    await consume(approved.recoveryId)
    await processRefund(f.db, f.provider, refundId)
    expect(f.provider.refunds).toHaveLength(2)
    expect(await complete(approved.recoveryId)).toBeNull()
    expect(await readRefundRecovery(f.db, "owner", refundId)).toMatchObject({
      canRetryRejected: false,
      recoveryPending: true,
    })
    await expect(
      requestRefundRecovery(
        f.db,
        "owner",
        refundId,
        await input("retry_rejected", "blind-retry")
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
    f.provider.refundVisible = true
    await consume(approved.recoveryId)
    expect(f.provider.refunds).toHaveLength(2)
    expect((await loadRefund(f.db, refundId)).state).toBe("succeeded")
  })

  it("two competing authorizations and queue consumers create only one new financial attempt", async () => {
    const request = await input()
    const approvals = await Promise.allSettled([
      requestRefundRecovery(f.db, "owner", refundId, request),
      requestRefundRecovery(f.db, "owner", refundId, {
        ...request,
        requestId: "competing",
      }),
    ])
    const accepted = approvals.filter((result) => result.status === "fulfilled")
    expect(accepted).toHaveLength(1)
    const id = accepted[0]!.value.recoveryId
    f.provider.refundOutcome = "success"
    await Promise.all([consume(id), consume(id)])
    await consume(id)
    expect(f.provider.refunds).toHaveLength(2)
    expect(
      await f.scalar(
        "SELECT count(*) n FROM request_receipts WHERE actor_id = 'system:refund-recovery-dispatch'"
      )
    ).toBe(1)
  })

  it("a fresh provider lookup can confirm an existing refund before any retry POST", async () => {
    const approved = await recover()
    const request = await validatedRefundRequest(
      f.db,
      await loadRefund(f.db, refundId)
    )
    const adapter = Object.create(f.provider) as PaymentAdapter
    adapter.lookupRefund = async () => ({
      ...request.expected,
      providerPaymentId: request.providerPaymentId,
      providerOrderId: request.providerOrderId,
      refundId,
      providerRefundId: "existing-refund",
      state: "succeeded",
    })
    await consume(approved.recoveryId, adapter)
    expect(f.provider.refunds).toHaveLength(1)
    expect((await loadRefund(f.db, refundId)).state).toBe("succeeded")
    expect(
      await f.scalar(
        "SELECT count(*) n FROM request_receipts WHERE actor_id = 'system:refund-recovery-dispatch'"
      )
    ).toBe(0)
  })

  it("failed lookup before the claim cannot authorize a POST, and later successful lookup allows recovery", async () => {
    const approved = await recover()
    const failing = Object.create(f.provider) as PaymentAdapter
    failing.lookupRefund = async () => {
      throw new ProviderOperationError(
        "PROVIDER_UNAVAILABLE",
        "definite_failure",
        "Synthetic read outage"
      )
    }
    await consume(approved.recoveryId, failing)
    expect(f.provider.refunds).toHaveLength(1)
    expect(await complete(approved.recoveryId)).toBeNull()
    // A separate reconciliation read may report an outage without having made a financial request.
    await processRefund(f.db, failing, refundId)
    f.provider.refundOutcome = "success"
    await consume(approved.recoveryId)
    expect(f.provider.refunds).toHaveLength(2)
    expect((await loadRefund(f.db, refundId)).state).toBe("succeeded")
  })

  it("read-only recovery preserves a definite rejection and never sends a financial request", async () => {
    const approved = await requestRefundRecovery(
      f.db,
      "owner",
      refundId,
      await input("reconcile")
    )
    const failing = Object.create(f.provider) as PaymentAdapter
    failing.lookupRefund = async () => {
      throw new ProviderOperationError(
        "PROVIDER_UNAVAILABLE",
        "definite_failure",
        "Synthetic read outage"
      )
    }
    await consume(approved.recoveryId, failing)
    expect(await loadRefund(f.db, refundId)).toMatchObject({
      state: "failed",
      dispatch_state: "reconciled",
      last_error_code: "PROVIDER_REJECTED",
    })
    await consume(approved.recoveryId)
    expect(f.provider.refunds).toHaveLength(1)
    expect(await complete(approved.recoveryId)).not.toBeNull()
    expect(await readRefundRecovery(f.db, "owner", refundId)).toMatchObject({
      state: "failed",
      canRetryRejected: true,
    })
  })

  it("a failed provider refund with an assigned identity remains lookup-only", async () => {
    const request = await validatedRefundRequest(
      f.db,
      await loadRefund(f.db, refundId)
    )
    await applyRefundStatus(f.db, {
      ...request.expected,
      refundId,
      providerPaymentId: request.providerPaymentId,
      providerOrderId: request.providerOrderId,
      providerRefundId: "provider-failed",
      state: "failed",
    })
    expect(await readRefundRecovery(f.db, "owner", refundId)).toMatchObject({
      canRetryRejected: false,
      canReconcile: true,
    })
    await expect(recover()).rejects.toMatchObject({ code: "CONFLICT" })
    expect(f.provider.refunds).toHaveLength(1)
  })

  it("rechecks independent refund permission before authorizing and before replay", async () => {
    for (const permission of [
      "support:manage",
      "ticket:scan",
      "event:manage",
    ]) {
      await f.db
        .prepare(
          "INSERT INTO event_permissions (event_id,user_id,permission,granted_at) VALUES ('event','buyer',?,?)"
        )
        .bind(permission, f.now)
        .run()
    }
    await expect(
      readRefundRecovery(f.db, "buyer", refundId)
    ).rejects.toMatchObject({ status: 404 })
    await f.db
      .prepare(
        "INSERT INTO event_permissions (event_id,user_id,permission,granted_at) VALUES ('event','buyer','refund:initiate',?)"
      )
      .bind(f.now)
      .run()
    const request = await input()
    await expect(
      requestRefundRecovery(f.db, "buyer", refundId, request, {
        beforeCommit: async () => {
          await f.db
            .prepare(
              "UPDATE event_permissions SET revoked_at = ? WHERE user_id = 'buyer' AND permission = 'refund:initiate'"
            )
            .bind(f.now)
            .run()
        },
      })
    ).rejects.toMatchObject({ status: 404 })
    expect(
      await f.scalar(
        "SELECT count(*) n FROM outbox WHERE kind = 'refund.recovery'"
      )
    ).toBe(0)
    await f.db
      .prepare(
        "UPDATE event_permissions SET revoked_at = NULL WHERE user_id = 'buyer' AND permission = 'refund:initiate'"
      )
      .run()
    await requestRefundRecovery(f.db, "buyer", refundId, request)
    await f.db
      .prepare(
        "UPDATE event_permissions SET revoked_at = ? WHERE user_id = 'buyer' AND permission = 'refund:initiate'"
      )
      .bind(f.now)
      .run()
    await expect(
      requestRefundRecovery(f.db, "buyer", refundId, request)
    ).rejects.toMatchObject({ status: 404 })
  })

  it("rejects stale refund state and changed reuse of an idempotency key", async () => {
    const request = await input()
    await expect(
      requestRefundRecovery(f.db, "owner", refundId, {
        ...request,
        expectedUpdatedAt: new Date(0).toISOString(),
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    await requestRefundRecovery(f.db, "owner", refundId, request)
    await expect(
      requestRefundRecovery(f.db, "owner", refundId, {
        ...request,
        action: "reconcile",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(
      await f.scalar(
        "SELECT count(*) n FROM outbox WHERE kind = 'refund.recovery'"
      )
    ).toBe(1)
  })
})
