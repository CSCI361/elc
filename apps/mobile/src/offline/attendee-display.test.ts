import { describe, expect, it } from "vite-plus/test"
import {
  cachedAttendeeDisplay,
  currentCachedAttendees,
} from "./attendee-display"
import { offlineCopies } from "./copy"
import type { SnapshotTicket } from "./model"

const ticket: SnapshotTicket = {
  ticketId: "ticket",
  tokenHash: "a".repeat(64),
  attendeeName: "Guest",
  state: "valid",
  admissionBlocked: false,
  activeCheckInId: null,
  seat: null,
}
describe("cached attendee presentation", () => {
  it.each([
    [{ state: "valid" }, "valid"],
    [{ state: "checked_in" }, "alreadyUsed"],
    [{ state: "valid", activeCheckInId: "checkin" }, "alreadyUsed"],
    [{ state: "refunded", activeCheckInId: "historic" }, "refundedState"],
    [{ state: "cancelled", activeCheckInId: "historic" }, "cancelledState"],
    [{ state: "refunded", admissionBlocked: true }, "blocked"],
  ] as const)(
    "labels snapshot state without overriding invalidation %j",
    (changes, state) => {
      expect(cachedAttendeeDisplay({ ...ticket, ...changes }).state).toBe(state)
    }
  )
  it("keeps complete accessible seat snapshots and rejects incomplete cached seats", () => {
    const seat = {
      seatId: "seat",
      section: "North",
      row: "A",
      number: "12",
      accessible: true,
    }
    expect(cachedAttendeeDisplay({ ...ticket, seat }).seat).toEqual(seat)
    expect(
      cachedAttendeeDisplay({ ...ticket, seat: { number: "12" } }).seat
    ).toBeNull()
  })
  it.each(["accountId", "eventId", "snapshotId", "query"] as const)(
    "hides old attendee results when %s changes",
    (key) => {
      const scope = {
        accountId: "account",
        eventId: "event",
        snapshotId: "snapshot",
        query: "Guest",
      }
      const page = { ...scope, items: [ticket] }
      expect(currentCachedAttendees(page, scope)).toEqual([ticket])
      expect(
        currentCachedAttendees(page, { ...scope, [key]: "changed" })
      ).toEqual([])
      expect(currentCachedAttendees(null, scope)).toEqual([])
    }
  )
  it.each(["kk", "ru", "en"] as const)(
    "labels snapshot time and seat details in %s",
    (locale) => {
      const text = offlineCopies[locale]
      for (const key of [
        "snapshotState",
        "seat",
        "accessibleSeat",
        "generalAdmission",
        "offlineAttendees",
      ] as const)
        expect(text[key].trim()).not.toBe("")
    }
  )
})
