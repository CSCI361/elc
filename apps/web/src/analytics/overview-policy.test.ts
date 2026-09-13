import { describe, expect, it, vi } from "vite-plus/test"
import type { OrganizerAnalyticsOverviewResponse } from "@elc/shared"
import { EventApiError } from "../events/api"
import { OverviewLoader } from "./overview-loader"
import {
  overviewFilters,
  overviewMoney,
  overviewPage,
  overviewPath,
  overviewQuery,
} from "./overview-policy"

function pending<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function report(q = "", days = 30) {
  return {
    timeZone: "Asia/Almaty",
    scope: {
      q,
      basis: "all_currently_authorized_matching_events",
      eventCount: 40,
    },
    period: { dayCount: days },
    summary: { grossMinor: 123456 },
    events: [{ id: "one" }],
  } as OrganizerAnalyticsOverviewResponse
}

describe("organizer overview dates and exact display", () => {
  it("uses server-resolved Almaty presets and accepts at most 180 inclusive civil dates", () => {
    expect(overviewQuery({})).toEqual({ range: "30", limit: 20 })
    expect(overviewQuery({ range: "7" })).toEqual({ range: "7", limit: 20 })
    expect(
      overviewQuery({ range: "custom", start: "2026-01-01", end: "2026-06-29" })
        .end
    ).toBe("2026-06-29")
    expect(
      overviewQuery({ range: "custom", start: "2024-02-29", end: "2024-02-29" })
        .start
    ).toBe("2024-02-29")
    for (const raw of [
      { range: "custom", start: "2026-01-01", end: "2026-06-30" },
      { range: "custom", start: "2026-02-29", end: "2026-03-01" },
      { range: "custom", start: "2026-03-01", end: "2026-02-28" },
      { range: "7", start: "2026-01-01" },
    ])
      expect(() => overviewQuery(raw)).toThrow()
  })
  it("resets only the event cursor for changed filters and preserves a literal title query", () => {
    const query = overviewQuery({
      range: "7",
      q: " %_ & / концерт ",
      cursor: "old-page",
      limit: 1,
    })
    expect(overviewFilters(query)).toEqual({
      range: "7",
      q: "%_ & / концерт",
      limit: 1,
    })
    expect(overviewPage(query, "next-page")).toEqual({
      ...query,
      cursor: "next-page",
    })
    expect(overviewPage(query, null).cursor).toBeUndefined()
    const url = new URL(overviewPath(query), "https://example.test")
    expect(url.searchParams.get("q")).toBe("%_ & / концерт")
    expect(url.pathname).toBe("/organizer/analytics/overview")
  })
  it("preserves every minor unit and negative fractions in all three locales", () => {
    expect(
      overviewMoney(Number.MAX_SAFE_INTEGER, "en").replace(/\s/g, " ")
    ).toBe("KZT 90,071,992,547,409.91")
    for (const locale of ["kk", "ru", "en"] as const) {
      expect(overviewMoney(Number.MAX_SAFE_INTEGER, locale)).toContain("91")
      expect(overviewMoney(Number.MAX_SAFE_INTEGER - 1, locale)).toContain("90")
      expect(overviewMoney(-1, locale)).toContain("-")
      expect(overviewMoney(-1, locale)).toContain("01")
      expect(overviewMoney(0, locale)).not.toContain("-")
    }
    expect(() => overviewMoney(Number.MAX_SAFE_INTEGER + 1, "en")).toThrow(
      "UNSAFE_MONEY"
    )
  })
})

describe("private organizer overview loading", () => {
  it("discards a late page and its failure after a new title and date scope wins", async () => {
    const first = pending<OrganizerAnalyticsOverviewResponse>(),
      second = pending<OrganizerAnalyticsOverviewResponse>()
    const read = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const loader = new OverviewLoader(read)
    const old = loader.load({ range: "30", cursor: "old-page" })
    const current = loader.load({ range: "7", q: "Music" })
    expect(read.mock.calls[0]![1].aborted).toBe(true)
    expect(loader.snapshot().data).toBeUndefined()
    second.resolve(report("Music", 7))
    await current
    first.reject(new EventApiError("FORBIDDEN", 403))
    await old
    expect(loader.snapshot()).toMatchObject({
      loading: false,
      data: {
        scope: { q: "Music", eventCount: 40 },
        summary: { grossMinor: 123456 },
      },
    })
    expect(loader.snapshot().error).toBeUndefined()
    // An event page can contain one row while canonical aggregate totals cover forty events.
    expect(loader.snapshot().data!.events).toHaveLength(1)
  })
  it("clears canonical data before refresh and after revoked access, network failure or scope mismatch", async () => {
    for (const failure of [
      new EventApiError("FORBIDDEN", 403),
      new Error("Network unavailable"),
    ]) {
      const next = pending<OrganizerAnalyticsOverviewResponse>()
      const read = vi
        .fn()
        .mockResolvedValueOnce(report())
        .mockReturnValueOnce(next.promise)
        .mockResolvedValueOnce(report())
      const loader = new OverviewLoader(read)
      await loader.load()
      expect(loader.snapshot().data).toBeDefined()
      const refresh = loader.load()
      expect(loader.snapshot().data).toBeUndefined()
      next.reject(failure)
      await refresh
      expect(loader.snapshot()).toMatchObject({
        loading: false,
        error: failure,
      })
      expect(loader.snapshot().data).toBeUndefined()
      await loader.load()
      expect(loader.snapshot().data).toBeDefined()
    }
    for (const mismatch of [
      report("different"),
      report("", 7),
      { ...report(), timeZone: "America/New_York" },
    ]) {
      const loader = new OverviewLoader(vi.fn().mockResolvedValue(mismatch))
      await loader.load()
      expect(loader.snapshot().data).toBeUndefined()
      expect(loader.snapshot().error).toMatchObject({
        code: "INVALID_RESPONSE",
      })
    }
  })
  it("does not send invalid dates and prevents an old account request from entering a new account loader", async () => {
    const old = pending<OrganizerAnalyticsOverviewResponse>(),
      read = vi.fn().mockReturnValue(old.promise)
    const firstAccount = new OverviewLoader(read)
    await firstAccount.load({
      range: "custom",
      start: "2026-03-01",
      end: "2026-02-01",
    })
    expect(read).not.toHaveBeenCalled()
    const loading = firstAccount.load({})
    firstAccount.cancel()
    const nextAccount = new OverviewLoader(
      vi.fn().mockResolvedValue(report("Owned"))
    )
    await nextAccount.load({ q: "Owned" })
    old.resolve(report())
    await loading
    expect(firstAccount.snapshot().data).toBeUndefined()
    expect(nextAccount.snapshot().data?.scope.q).toBe("Owned")
  })
})
