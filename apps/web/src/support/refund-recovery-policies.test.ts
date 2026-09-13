import { describe, expect, it } from "vite-plus/test"
import { refundRecoveryViewSchema } from "@elc/shared"
import {
  refundRecoveryActions,
  refundRecoveryInput,
} from "./refund-recovery-policies"
const view = refundRecoveryViewSchema.parse({
  refundId: "refund",
  eventId: "event",
  state: "failed",
  updatedAt: "2026-09-13T00:00:00.000Z",
  canRetryRejected: true,
  canReconcile: true,
  recoveryPending: false,
})
describe("refund recovery authorization and duplicate prevention", () => {
  it("never infers retry permission from a failed refund alone", () => {
    expect(refundRecoveryActions(view)).toEqual(["reconcile", "retry_rejected"])
    expect(refundRecoveryActions({ ...view, canRetryRejected: false })).toEqual(
      ["reconcile"]
    )
    expect(
      refundRecoveryActions({
        ...view,
        canRetryRejected: false,
        canReconcile: false,
      })
    ).toEqual([])
    expect(refundRecoveryActions({ ...view, state: "pending" })).toEqual([
      "reconcile",
    ])
  })
  it("blocks all operations during a queued recovery or after confirmation", () => {
    expect(refundRecoveryActions({ ...view, recoveryPending: true })).toEqual(
      []
    )
    expect(refundRecoveryActions({ ...view, state: "succeeded" })).toEqual([])
    expect(
      refundRecoveryInput(
        { ...view, recoveryPending: true },
        "retry_rejected",
        "Reason"
      )
    ).toBeNull()
  })
  it("binds an allowed request to the fetched version and a bounded, nonblank reason", () => {
    expect(
      refundRecoveryInput(
        view,
        "retry_rejected",
        "  Provider rejected the request.  "
      )
    ).toEqual({
      requestId: "validate",
      expectedUpdatedAt: view.updatedAt,
      action: "retry_rejected",
      reason: "Provider rejected the request.",
    })
    for (const reason of ["   ", "ab", "x".repeat(501)])
      expect(refundRecoveryInput(view, "reconcile", reason)).toBeNull()
    expect(refundRecoveryInput(view, "refund", "Reason")).toBeNull()
    expect(
      refundRecoveryInput(
        { ...view, canRetryRejected: false },
        "retry_rejected",
        "Reason"
      )
    ).toBeNull()
  })
})
