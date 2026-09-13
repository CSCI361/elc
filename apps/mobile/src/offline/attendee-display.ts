import { seatSnapshotSchema } from "@elc/shared"
import type { SnapshotTicket } from "./model"

/** These labels describe the signed snapshot, never a new admission decision. */
export function cachedAttendeeDisplay(ticket: SnapshotTicket) {
  const seat = seatSnapshotSchema.safeParse(ticket.seat)
  const state = ticket.admissionBlocked
    ? "blocked"
    : ticket.state === "refunded"
      ? "refundedState"
      : ticket.state === "cancelled"
        ? "cancelledState"
        : ticket.state === "checked_in" || ticket.activeCheckInId
          ? "alreadyUsed"
          : "valid"
  return { state, seat: seat.success ? seat.data : null } as const
}

export type CachedAttendeePage = {
  accountId: string
  eventId: string
  snapshotId: string
  query: string
  items: SnapshotTicket[]
}
export function currentCachedAttendees(
  page: CachedAttendeePage | null,
  scope: Omit<CachedAttendeePage, "items">
) {
  return page &&
    page.accountId === scope.accountId &&
    page.eventId === scope.eventId &&
    page.snapshotId === scope.snapshotId &&
    page.query === scope.query
    ? page.items
    : []
}
