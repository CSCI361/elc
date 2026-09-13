import { describe, expect, it } from "vite-plus/test"
import { eventApiSchema } from "@elc/shared"
import {
  canResetRejectedRequest,
  duplicateEligible,
  duplicationInput,
  historyFilters,
  historyRoute,
  localDateTime,
  localDateTimeToUtc,
  newPending,
  pageHref,
  parsePending,
  pendingKey,
} from "./policies"
import { historyText } from "./messages"
const now = Date.parse("2026-09-13T06:00:00Z")
const event = eventApiSchema.parse({
  id: "event",
  organizerId: "owner",
  title: "Past event",
  description: "Description",
  category: "Education",
  venueName: "Hall",
  venueAddress: "Address",
  startsAt: "2026-09-10T06:00:00Z",
  endsAt: "2026-09-10T08:00:00Z",
  timeZone: "Asia/Almaty",
  visibility: "private",
  seatingMode: "general_admission",
  capacity: 20,
  registrationOpensAt: "2026-09-01T00:00:00Z",
  registrationClosesAt: "2026-09-10T06:00:00Z",
  maxTicketsPerOrder: 6,
  publicationState: "published",
  paidSalesState: "active",
  suspendedAt: null,
  cancelledAt: null,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-10T00:00:00Z",
  revision: 7,
  reportingId: "rpt_historyfixture",
  refundInstructions: "",
  phase: "completed",
  calendar: {
    uid: "event@elc",
    sequence: 3,
    status: "CONFIRMED",
    updatedAt: "2026-09-10T00:00:00Z",
  },
})
const dates = {
  startsAt: "2026-09-20T11:00",
  endsAt: "2026-09-20T13:00",
  registrationOpensAt: "2026-09-14T09:00",
  registrationClosesAt: "2026-09-20T11:00",
}
describe("history navigation, civil time and duplication recovery", () => {
  it("matches only the explicit lazy history routes and rejects malformed identifiers", () => {
    expect(historyRoute("/organizer/history")).toEqual({ kind: "list" })
    expect(historyRoute("/organizer/events/example/history")).toEqual({
      kind: "timeline",
      eventId: "example",
    })
    expect(historyRoute("/organizer/events/example/duplicate")).toEqual({
      kind: "duplicate",
      eventId: "example",
    })
    for (const path of [
      "/organizer/events/example",
      "/events/example/history",
      "/organizer/events/%2f/duplicate",
      "/organizer/events/%ZZ/history",
    ])
      expect(historyRoute(path)).toBeNull()
  })
  it("preserves filters while paging and binds custom date input to its explicit range", () => {
    expect(
      pageHref(
        "/organizer/history",
        "q=Campus&phase=cancelled&cursor=old",
        "new"
      )
    ).toBe("/organizer/history?q=Campus&phase=cancelled&cursor=new")
    expect(pageHref("/organizer/history", "q=Campus&cursor=old")).toBe(
      "/organizer/history?q=Campus"
    )
    expect(
      historyFilters(
        "?range=custom&start=2026-09-01&end=2026-09-13&activityType=refund",
        true
      ).success
    ).toBe(true)
    expect(historyFilters("?start=2026-09-01", false).success).toBe(false)
    expect(
      historyFilters("?range=30&start=2026-09-01&end=2026-09-13", true).success
    ).toBe(false)
    expect(historyFilters("?activityType=platform.private", true).success).toBe(
      false
    )
  })
  it("converts event-zone inputs independently of browser time and rejects DST gaps/repeats", () => {
    expect(localDateTime(now, "Asia/Almaty")).toBe("2026-09-13T11:00")
    expect(localDateTimeToUtc("2026-09-20T11:00", "Asia/Almaty")).toBe(
      "2026-09-20T06:00:00.000Z"
    )
    expect(
      localDateTimeToUtc("2026-03-08T02:30", "America/New_York")
    ).toBeNull()
    expect(
      localDateTimeToUtc("2026-11-01T01:30", "America/New_York")
    ).toBeNull()
    expect(localDateTimeToUtc("2026-03-08T03:30", "America/New_York")).toBe(
      "2026-03-08T07:30:00.000Z"
    )
    expect(localDateTimeToUtc("2026-02-30T10:00", "Asia/Almaty")).toBeNull()
  })
  it("sends only allowed dates and the current source revision with future deadlines", () => {
    const input = duplicationInput(event, dates, now)!
    expect(input.expectedRevision).toBe(7)
    expect(Object.keys(input).sort()).toEqual([
      "endsAt",
      "expectedRevision",
      "registrationClosesAt",
      "registrationOpensAt",
      "requestId",
      "startsAt",
    ])
    expect(
      duplicationInput(
        event,
        { ...dates, registrationClosesAt: "2026-09-21T11:00" },
        now
      )
    ).toBeNull()
    expect(
      duplicationInput(event, dates, Date.parse("2026-09-21T00:00:00Z"))
    ).toBeNull()
    expect(duplicateEligible(event, now)).toBe(true)
    expect(
      duplicateEligible({ ...event, suspendedAt: event.updatedAt }, now)
    ).toBe(false)
    expect(
      duplicateEligible(
        {
          ...event,
          endsAt: "2026-10-01T00:00:00Z",
          cancelledAt: event.updatedAt,
        },
        now
      )
    ).toBe(true)
  })
  it("preserves one exact account-bound operation across reload and unknown outcomes", () => {
    const operation = newPending(
      "owner",
      "event",
      duplicationInput(event, dates, now)!,
      "one-operation"
    )
    const stored = JSON.stringify(operation)
    expect(parsePending(stored, "owner", "event")).toEqual(operation)
    expect(parsePending(stored, "different", "event")).toBeNull()
    expect(parsePending(stored, "owner", "other-event")).toBeNull()
    expect(parsePending('{"input":{}}', "owner", "event")).toBeNull()
    expect(pendingKey("owner", "event")).not.toBe(
      pendingKey("different", "event")
    )
    expect(canResetRejectedRequest(false, 400)).toBe(true)
    expect(canResetRejectedRequest(false, 409)).toBe(true)
    for (const status of [undefined, 401, 403, 404, 500, 503])
      expect(canResetRejectedRequest(false, status)).toBe(false)
    for (const status of [undefined, 400, 401, 403, 404, 409, 500, 503])
      expect(canResetRejectedRequest(true, status)).toBe(false)
  })
  it("provides all new workflow states in each required locale", () => {
    for (const locale of ["kk", "ru", "en"] as const)
      for (const key of [
        "title",
        "duplicate",
        "uncertain",
        "duplicateDenied",
        "held",
        "invalidTimes",
        "dateHint",
        "activation",
        "periodHint",
      ] as const)
        expect(historyText(locale, key).length).toBeGreaterThan(5)
  })
})
