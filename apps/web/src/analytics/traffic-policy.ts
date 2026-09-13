import type {
  EventAnalyticsQuery,
  EventAnalyticsResponse,
  TrafficResponse,
} from "@elc/shared"

export function trafficPath(
  data: EventAnalyticsResponse,
  query: EventAnalyticsQuery
) {
  const parameters = new URLSearchParams({
    range: "custom",
    start: data.period.start,
    end: data.period.end,
    limit: String(query.limit),
  })
  if (query.campaignAfter) parameters.set("campaignAfter", query.campaignAfter)
  return `/events/${encodeURIComponent(data.eventId)}/traffic?${parameters}`
}
export function matchingTraffic(
  data: EventAnalyticsResponse,
  traffic: TrafficResponse
) {
  if (
    traffic.eventId !== data.eventId ||
    traffic.eventTimeZone !== data.timeZone
  )
    return false
  const result = traffic.result
  return (
    result.status === "unavailable" ||
    (result.eventReportingId === data.reportingId &&
      result.period.start === data.period.start &&
      result.period.end === data.period.end &&
      result.period.dayCount === data.period.dayCount &&
      result.campaigns.length === data.campaigns.length &&
      new Set(result.campaigns.map((row) => row.campaignReportingId)).size ===
        result.campaigns.length &&
      result.campaigns.every((row) =>
        data.campaigns.some(
          (campaign) => campaign.reportingId === row.campaignReportingId
        )
      ))
  )
}
