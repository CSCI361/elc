import {
  refundRecoveryActionSchema,
  refundRecoveryViewSchema,
  requestRefundRecoverySchema,
} from "@elc/shared"
export type RefundRecoveryView = ReturnType<
  typeof refundRecoveryViewSchema.parse
>
export function refundRecoveryActions(view: RefundRecoveryView) {
  if (view.state === "succeeded" || view.recoveryPending) return []
  return refundRecoveryActionSchema.options.filter((action) =>
    action === "reconcile"
      ? view.canReconcile
      : view.state === "failed" && view.canRetryRejected
  )
}
export function refundRecoveryInput(
  view: RefundRecoveryView,
  action: unknown,
  reason: unknown
) {
  const parsedAction = refundRecoveryActionSchema.safeParse(action)
  if (
    !parsedAction.success ||
    !refundRecoveryActions(view).includes(parsedAction.data)
  )
    return null
  const parsed = requestRefundRecoverySchema.safeParse({
    requestId: "validate",
    expectedUpdatedAt: view.updatedAt,
    action: parsedAction.data,
    reason,
  })
  return parsed.success ? parsed.data : null
}
