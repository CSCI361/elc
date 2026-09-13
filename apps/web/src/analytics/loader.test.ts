import { describe, expect, it, vi } from "vite-plus/test"
import type { EventAnalyticsResponse } from "@elc/shared"
import { EventApiError } from "../events/api"
import { AnalyticsLoader } from "./loader"
import {
  analyticsEventId,
  analyticsPage,
  analyticsQuery,
  applyAnalyticsFilters,
  initialAnalyticsQuery,
} from "./policies"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function report(
  overrides: Partial<EventAnalyticsResponse["period"]> = {},
  eventId = "event"
) {
  return {
    eventId,
    period: { dayCount: 30, ticketTypeId: null, ...overrides },
  } as EventAnalyticsResponse
}
describe("analytics calendar and filter policy", () => {
  it("lets the server resolve event-local preset dates instead of using the browser clock", () => {
    expect(initialAnalyticsQuery("")).toEqual({ range: "30", limit: 20 })
    expect(initialAnalyticsQuery("?range=7")).toEqual({ range: "7", limit: 20 })
    expect(() => analyticsQuery({ range: "7", start: "2026-01-01" })).toThrow()
  })
  it("accepts 180 inclusive calendar days and leap dates, rejecting reversed, invalid and oversized ranges", () => {
    expect(
      analyticsQuery({
        range: "custom",
        start: "2026-01-01",
        end: "2026-06-29",
      }).end
    ).toBe("2026-06-29")
    expect(
      analyticsQuery({
        range: "custom",
        start: "2024-02-29",
        end: "2024-02-29",
      }).start
    ).toBe("2024-02-29")
    for (const [start, end] of [
      ["2026-01-01", "2026-06-30"],
      ["2026-02-29", "2026-03-01"],
      ["2026-03-01", "2026-02-28"],
    ])
      expect(() => analyticsQuery({ range: "custom", start, end })).toThrow()
  })
  it("resets both breakdown cursors when filters change, while each page changes only its own cursor", () => {
    const query = analyticsQuery({
      range: "7",
      ticketTypeId: "type",
      typeAfter: "type-old",
      campaignAfter: "campaign-old",
    })
    expect(applyAnalyticsFilters(query)).toEqual({
      range: "7",
      ticketTypeId: "type",
      limit: 20,
    })
    expect(analyticsPage(query, "type", "type-new")).toMatchObject({
      typeAfter: "type-new",
      campaignAfter: "campaign-old",
      ticketTypeId: "type",
    })
    expect(analyticsPage(query, "campaign", null)).toEqual({
      range: "7",
      ticketTypeId: "type",
      limit: 20,
      typeAfter: "type-old",
    })
  })
  it("accepts only a complete event analytics path with a valid decoded ID", () => {
    expect(analyticsEventId("/events/event-id/analytics")).toBe("event-id")
    for (const path of [
      "/events/event/analytics/extra",
      "/events/%2f/analytics",
      "/events/%/analytics",
      "/events/event",
    ])
      expect(analyticsEventId(path)).toBeNull()
  })
})
describe("private analytics request recovery", () => {
  it("discards an older date response after a ticket-type filter wins, even if fetch ignores abort", async () => {
    const older = deferred<EventAnalyticsResponse>(),
      newer = deferred<EventAnalyticsResponse>()
    const read = vi
      .fn()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)
    const loader = new AnalyticsLoader("event", analyticsQuery({}), read)
    const first = loader.load({
      range: "custom",
      start: "2026-01-01",
      end: "2026-01-03",
    })
    const second = loader.load({ range: "7", ticketTypeId: "type" })
    expect(read.mock.calls[0]?.[1].aborted).toBe(true)
    newer.resolve(report({ dayCount: 7, ticketTypeId: "type" }))
    await second
    older.resolve(
      report({ start: "2026-01-01", end: "2026-01-03", dayCount: 3 })
    )
    await first
    expect(loader.snapshot().data?.period).toMatchObject({
      dayCount: 7,
      ticketTypeId: "type",
    })
    expect(read.mock.calls[1]?.[0]).toContain("ticketTypeId=type")
  })
  it("prevents a late breakdown page from replacing a newly selected period", async () => {
    const page = deferred<EventAnalyticsResponse>(),
      period = deferred<EventAnalyticsResponse>()
    const read = vi
      .fn()
      .mockReturnValueOnce(page.promise)
      .mockReturnValueOnce(period.promise)
    const loader = new AnalyticsLoader("event", analyticsQuery({}), read)
    const first = loader.load({ range: "30", campaignAfter: "last-campaign" })
    const second = loader.load(applyAnalyticsFilters({ range: "7" }))
    period.resolve(report({ dayCount: 7 }))
    await second
    page.reject(new Error("Late page failure"))
    await first
    expect(loader.snapshot()).toMatchObject({
      loading: false,
      query: { range: "7" },
      data: { period: { dayCount: 7 } },
    })
    expect(loader.snapshot().error).toBeUndefined()
  })
  it("clears a loaded report while refreshing and never restores it after access is revoked", async () => {
    const pending = deferred<EventAnalyticsResponse>(),
      read = vi
        .fn()
        .mockResolvedValueOnce(report())
        .mockReturnValueOnce(pending.promise)
    const loader = new AnalyticsLoader("event", analyticsQuery({}), read)
    await loader.load()
    expect(loader.snapshot().data).toBeDefined()
    const refresh = loader.load()
    expect(loader.snapshot().data).toBeUndefined()
    loader.deny(new EventApiError("NOT_FOUND", 404))
    pending.resolve(report())
    await refresh
    expect(loader.snapshot().data).toBeUndefined()
    expect(loader.snapshot().error).toBeInstanceOf(EventApiError)
  })
  it("rejects mismatched event, type and date responses, and recovers with an explicit retry", async () => {
    for (const bad of [
      report({}, "other-event"),
      report({ ticketTypeId: "other-type" }),
      report({ dayCount: 7 }),
    ]) {
      const read = vi
        .fn()
        .mockResolvedValueOnce(bad)
        .mockResolvedValueOnce(report())
      const loader = new AnalyticsLoader("event", analyticsQuery({}), read)
      await loader.load()
      expect(loader.snapshot().data).toBeUndefined()
      expect(loader.snapshot().error).toMatchObject({
        code: "INVALID_RESPONSE",
      })
      await loader.load()
      expect(loader.snapshot().data?.eventId).toBe("event")
    }
  })
  it("does not request an invalid custom range and ignores completion after unmount or account switch", async () => {
    const pending = deferred<EventAnalyticsResponse>(),
      read = vi.fn().mockReturnValue(pending.promise)
    const loader = new AnalyticsLoader("event", analyticsQuery({}), read)
    await loader.load({
      range: "custom",
      start: "2026-02-01",
      end: "2026-01-01",
    })
    expect(read).not.toHaveBeenCalled()
    const loading = loader.load({ range: "30" })
    loader.cancel()
    pending.resolve(report())
    await loading
    expect(loader.snapshot().data).toBeUndefined()
  })
})
