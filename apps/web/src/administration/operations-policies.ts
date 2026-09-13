import { operationsQuerySchema, type OperationsKind } from "@elc/shared"
export type OperationsQuery = ReturnType<typeof operationsQuerySchema.parse>
export function operationsFilters(search: string): OperationsQuery | null {
  const params = new URLSearchParams(search)
  const allowed = [
    "kind",
    "q",
    "eventId",
    "accountId",
    "campaignId",
    "after",
    "limit",
  ]
  if (
    [...params.keys()].some(
      (key) => !allowed.includes(key) || params.getAll(key).length !== 1
    )
  )
    return null
  const parsed = operationsQuerySchema.safeParse(
    Object.fromEntries([...params].filter(([, value]) => value !== ""))
  )
  return parsed.success ? { ...parsed.data, limit: 20 } : null
}
/** One canonical query supplies both the displayed page and its CSV export. */
export function operationsSearch(query: OperationsQuery) {
  const parsed = operationsQuerySchema.parse({ ...query, limit: 20 })
  return new URLSearchParams(
    Object.entries(parsed).flatMap(([key, value]) =>
      value === undefined || value === "" ? [] : [[key, String(value)]]
    )
  ).toString()
}
export function operationsSubmission(fields: {
  kind: OperationsKind
  q: string
  eventId: string
  accountId: string
  campaignId: string
}): OperationsQuery | null {
  const parsed = operationsQuerySchema.safeParse({
    kind: fields.kind,
    q: fields.q.trim(),
    eventId: fields.eventId.trim() || undefined,
    accountId: fields.accountId.trim() || undefined,
    campaignId:
      fields.kind === "orders"
        ? fields.campaignId.trim() || undefined
        : undefined,
    limit: 20,
  })
  return parsed.success ? parsed.data : null
}
