/** Reported physical admissions block voluntary refunds until authorized review. */
export function unresolvedOrderOfflineAdmissionSql(orderId: string) {
  return {
    predicate:
      "EXISTS (SELECT 1 FROM offline_admission_reports WHERE order_id = ? AND review_state = 'unresolved')",
    bindings: [orderId],
  }
}
