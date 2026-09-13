import { describe, expect, it } from "vite-plus/test"
import type { EventAnalyticsResponse, TrafficResponse } from "@elc/shared"
import { matchingTraffic, trafficPath } from "./traffic-policy"

const data = {
  eventId: "event",
  reportingId: "rpt_event0001",
  timeZone: "America/Los_Angeles",
  period: {
    start: "2026-09-01",
    end: "2026-09-07",
    dayCount: 7,
    ticketTypeId: "type",
  },
  campaigns: [{ reportingId: "rpt_campaign1" }],
} as EventAnalyticsResponse
const response = {
  eventId: data.eventId,
  eventTimeZone: data.timeZone,
  scope: "event_all_ticket_types",
  cache: "fresh",
  result: {
    status: "available",
    source: "ga4",
    eventReportingId: data.reportingId,
    period: {
      range: "custom",
      start: data.period.start,
      end: data.period.end,
      dayCount: 7,
    },
    timeZone: "Asia/Almaty",
    currency: "KZT",
    currencyVerified: true,
    fetchedAt: "2026-09-13T00:00:00Z",
    dataAsOf: null,
    processingDelayPossible: true,
    quality: {
      sampled: false,
      subjectToThresholding: false,
      dataLossFromOtherRow: false,
    },
    totals: {
      pageViews: 0,
      eventViews: 0,
      campaignVisits: 0,
      checkoutStarts: 0,
    },
    daily: [],
    campaigns: [
      {
        campaignReportingId: "rpt_campaign1",
        pageViews: 0,
        eventViews: 0,
        campaignVisits: 0,
        checkoutStarts: 0,
      },
    ],
  },
} satisfies TrafficResponse

describe("GA4 dashboard scope", () => {
  it("requests the exact resolved sales dates without the ticket-type filter", () => {
    const path = trafficPath(data, {
      range: "7",
      ticketTypeId: "type",
      typeAfter: "type",
      campaignAfter: "campaign",
      limit: 20,
    })
    expect(path).toBe(
      "/events/event/traffic?range=custom&start=2026-09-01&end=2026-09-07&limit=20&campaignAfter=campaign"
    )
  })
  it("accepts the corresponding event and campaign page", () => {
    expect(matchingTraffic(data, response)).toBe(true)
  })
  it("rejects results for another event, reporting zone, date range or campaign page", () => {
    expect(matchingTraffic(data, { ...response, eventId: "other" })).toBe(false)
    expect(
      matchingTraffic(data, { ...response, eventTimeZone: "Asia/Almaty" })
    ).toBe(false)
    if (response.result.status !== "available") throw new Error("Fixture")
    expect(
      matchingTraffic(data, {
        ...response,
        result: {
          ...response.result,
          period: { ...response.result.period, end: "2026-09-08" },
        },
      })
    ).toBe(false)
    expect(
      matchingTraffic(data, {
        ...response,
        result: { ...response.result, campaigns: [] },
      })
    ).toBe(false)
    expect(
      matchingTraffic(data, {
        ...response,
        result: {
          ...response.result,
          campaigns: [
            {
              ...response.result.campaigns[0]!,
              campaignReportingId: "rpt_other0001",
            },
          ],
        },
      })
    ).toBe(false)
  })
  it("permits a scoped unavailable result so sales remain usable", () => {
    expect(
      matchingTraffic(data, {
        ...response,
        result: {
          status: "unavailable",
          source: "ga4",
          reason: "not_configured",
          retryable: false,
          retryAfterSeconds: null,
          checkedAt: null,
        },
      })
    ).toBe(true)
  })
})
