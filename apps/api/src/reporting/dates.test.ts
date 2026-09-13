import { describe, expect, it } from "vite-plus/test"
import { eventAnalyticsQuerySchema } from "@elc/shared"
import { calendarDayStart, reportingPeriod } from "./dates"

describe("reporting civil dates", () => {
  it("includes today in the event zone across UTC midnight", () => {
    const result = reportingPeriod(
      eventAnalyticsQuerySchema.parse({}),
      "Asia/Almaty",
      Date.parse("2026-09-12T20:00:00Z")
    )
    expect(result).toMatchObject({
      start: "2026-08-15",
      end: "2026-09-13",
      dayCount: 30,
    })
    expect(new Date(result.startAt).toISOString()).toBe(
      "2026-08-14T19:00:00.000Z"
    )
    expect(new Date(result.endExclusive).toISOString()).toBe(
      "2026-09-13T19:00:00.000Z"
    )
  })
  it.each([
    ["2026-03-08", "2026-03-09", 23],
    ["2026-11-01", "2026-11-02", 25],
  ])("uses the true duration of %s in New York", (start, end, hours) => {
    expect(
      calendarDayStart(end as string, "America/New_York") -
        calendarDayStart(start as string, "America/New_York")
    ).toBe(Number(hours) * 3_600_000)
  })
  it("handles a midnight gap and a skipped date", () => {
    expect(
      new Date(
        calendarDayStart("2018-11-04", "America/Sao_Paulo")
      ).toISOString()
    ).toBe("2018-11-04T03:00:00.000Z")
    expect(calendarDayStart("2011-12-30", "Pacific/Apia")).toBe(
      calendarDayStart("2011-12-31", "Pacific/Apia")
    )
  })
  it("bounds inclusive ranges and validates leap days", () => {
    const query = (start: string, end: string) =>
      eventAnalyticsQuerySchema.parse({ range: "custom", start, end })
    expect(
      reportingPeriod(query("2024-02-29", "2024-02-29"), "UTC", 0).dayCount
    ).toBe(1)
    expect(
      reportingPeriod(query("2026-01-01", "2026-06-29"), "UTC", 0).dayCount
    ).toBe(180)
    expect(() =>
      reportingPeriod(query("2026-01-01", "2026-06-30"), "UTC", 0)
    ).toThrow(/180/)
    expect(() =>
      reportingPeriod(query("2026-01-02", "2026-01-01"), "UTC", 0)
    ).toThrow()
    expect(() => query("2026-02-29", "2026-03-01")).toThrow()
    expect(() =>
      eventAnalyticsQuerySchema.parse({ range: "7", start: "2026-01-01" })
    ).toThrow()
    expect(() =>
      eventAnalyticsQuerySchema.parse({ range: "custom", start: "2026-01-01" })
    ).toThrow()
    expect(() => eventAnalyticsQuerySchema.parse({ limit: 51 })).toThrow()
  })
})
