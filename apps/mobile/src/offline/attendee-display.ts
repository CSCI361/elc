import { seatSnapshotSchema } from "@elc/shared"
import type { SnapshotTicket } from "./model"
import { guestStatus } from "../model"

export function cachedAttendeeDisplay(ticket: SnapshotTicket) {
  const seat = seatSnapshotSchema.safeParse(ticket.seat)
  return {
    status: guestStatus(ticket),
    seat: seat.success ? seat.data : null,
  }
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
