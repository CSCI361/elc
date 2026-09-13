import {
  entityIdSchema,
  payoutListQuerySchema,
  type EventPayoutsResponse,
} from "@elc/shared"
export function payoutEventId(path: string): string | null {
  const match = /^\/organizer\/events\/([^/]+)\/payouts$/.exec(path)
  if (!match) return null
  try {
    const result = entityIdSchema.safeParse(decodeURIComponent(match[1]!))
    return result.success ? result.data : null
  } catch {
    return null
  }
}
export function payoutCursor(search: string): string {
  const before = new URLSearchParams(search).get("before")
  const parsed = payoutListQuerySchema.safeParse(before ? { before } : {})
  return parsed.success ? (parsed.data.before ?? "") : ""
}
export function payoutPath(eventId: string, before: string) {
  const query = new URLSearchParams({ limit: "20" })
  if (before) query.set("before", before)
  return `/events/${encodeURIComponent(eventId)}/payouts?${query}`
}
export const summaryMeasures = [
  "completedPaymentsMinor",
  "confirmedRefundsMinor",
  "remainingProcessingFeesMinor",
  "estimatedContributionMinor",
  "simulatedPaidMinor",
  "adjustmentMinor",
  "outstandingMinor",
  "heldMinor",
  "availableMinor",
] as const satisfies readonly (keyof EventPayoutsResponse["summary"])[]
