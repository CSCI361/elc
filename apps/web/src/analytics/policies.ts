import {
  entityIdSchema,
  eventAnalyticsQuerySchema,
  type EventAnalyticsQuery,
  type EventAnalyticsResponse,
} from "@elc/shared"

export function analyticsEventId(path: string): string | null {
  const match = /^\/events\/([^/]+)\/analytics$/.exec(path)
  if (!match) return null
  try {
    const decoded = decodeURIComponent(match[1]!)
    if (decoded.includes("/")) return null
    const parsed = entityIdSchema.safeParse(decoded)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
/** Calendar dates are compared as dates, without the browser's time zone or DST. */
export function analyticsQuery(raw: unknown): EventAnalyticsQuery {
  const query = eventAnalyticsQuerySchema.parse(raw)
  if (query.range === "custom") {
    const days =
      (Date.parse(`${query.end}T00:00:00Z`) -
        Date.parse(`${query.start}T00:00:00Z`)) /
        86400000 +
      1
    if (!Number.isInteger(days) || days < 1 || days > 180)
      throw new Error("INVALID_REPORT_PERIOD")
  }
  return query
}
export function initialAnalyticsQuery(search: string): EventAnalyticsQuery {
  const parameters = new URLSearchParams(search)
  const allowed = [
    "range",
    "start",
    "end",
    "ticketTypeId",
    "typeAfter",
    "campaignAfter",
    "limit",
  ]
  return analyticsQuery(
    Object.fromEntries([...parameters].filter(([key]) => allowed.includes(key)))
  )
}
export function analyticsPath(eventId: string, query: EventAnalyticsQuery) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(analyticsQuery(query)))
    if (value !== undefined) params.set(key, String(value))
  return `/events/${encodeURIComponent(eventId)}/analytics?${params}`
}
export function applyAnalyticsFilters(raw: unknown): EventAnalyticsQuery {
  const {
    typeAfter: _type,
    campaignAfter: _campaign,
    ...query
  } = analyticsQuery(raw)
  return query
}
export function analyticsPage(
  query: EventAnalyticsQuery,
  kind: "type" | "campaign",
  cursor: string | null
) {
  const next = { ...query }
  const key = kind === "type" ? "typeAfter" : "campaignAfter"
  if (cursor) next[key] = cursor
  else delete next[key]
  return analyticsQuery(next)
}
export function matchingAnalyticsResponse(
  eventId: string,
  query: EventAnalyticsQuery,
  data: EventAnalyticsResponse
) {
  return (
    data.eventId === eventId &&
    data.period.ticketTypeId === (query.ticketTypeId ?? null) &&
    (query.range === "custom"
      ? data.period.start === query.start && data.period.end === query.end
      : data.period.dayCount === Number(query.range))
  )
}
export const summaryMeasures = [
  "completedOrders",
  "ticketsIssued",
  "grossMinor",
  "discountMinor",
  "refundedTickets",
  "ticketRefundMinor",
  "netTicketRevenueMinor",
  "processingFeeMinor",
  "processingFeeReversalMinor",
  "estimatedPayoutMinor",
  "committedRedemptions",
] as const
export const currentMeasures = [
  "capacity",
  "enabledInventory",
  "remainingInventory",
  "reservedInventory",
  "issuedTickets",
  "nonCancelledNonRefundedTickets",
  "cancelledTickets",
  "refundedTickets",
  "eligibleAttendance",
  "confirmedAttendance",
  "absent",
] as const
