import { describe, expect, it } from "vite-plus/test"
import {
  scanResultSchema,
  revokeOfflineDeviceSchema,
  reviewOfflineAdmissionSchema,
} from "@elc/shared"
import { offlineHref, offlineListPath, offlineRoute } from "./policies"
import { offlineMessages } from "./messages"

describe("offline workspace routes and localized operations", () => {
  it("routes discovery and encoded event scope without matching unrelated routes", () => {
    expect(offlineRoute("/offline")).toEqual({})
    expect(offlineRoute(offlineHref("event ? #"))).toEqual({
      eventId: "event ? #",
    })
    for (const path of [
      "/offline/extra",
      "/organizer/events/a",
      "/organizer/events/a/offline/more",
      "/organizer/events/%/offline",
    ])
      expect(offlineRoute(path)).toBeNull()
  })
  it("keeps pagination bounded and encodes opaque cursor and event values", () => {
    const path = offlineListPath("event/a", "admissions", "a+b&next=true")
    const url = new URL(path, "https://example.test")
    expect(url.pathname).toBe("/events/event%2Fa/offline/admissions")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: "20",
      cursor: "a+b&next=true",
    })
    expect(offlineListPath("event", "devices")).not.toContain("cursor")
  })
  it("provides all server scan results and operation messages in KK/RU/EN", () => {
    for (const result of scanResultSchema.options)
      expect(offlineMessages[result]).toHaveLength(3)
    for (const translations of Object.values(offlineMessages)) {
      expect(translations).toHaveLength(3)
      expect(translations.every((value) => value.trim().length > 0)).toBe(true)
    }
    for (const key of [
      "lossHint",
      "reviewHint",
      "uncertain",
      "incident",
      "title",
    ] as const)
      expect(new Set(offlineMessages[key]).size).toBe(3)
  })
  it("validates required recorded reasons and explicit review outcomes with shared contracts", () => {
    expect(
      revokeOfflineDeviceSchema.safeParse({
        requestId: "request",
        expectedRevision: 0,
        reason: " ",
        lost: true,
      }).success
    ).toBe(false)
    expect(
      reviewOfflineAdmissionSchema.safeParse({
        requestId: "request",
        expectedRevision: 0,
        reason: "Verified",
        resolution: "",
      }).success
    ).toBe(false)
    expect(
      reviewOfflineAdmissionSchema.safeParse({
        requestId: "request",
        expectedRevision: 0,
        reason: "Verified",
        resolution: "admission_confirmed",
      }).success
    ).toBe(true)
  })
})
