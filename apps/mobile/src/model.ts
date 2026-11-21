import {
  admissionPayloadSchema,
  scanResponseSchema,
  type ScanResponse,
  type ScannerEvent,
  type TicketState,
  localeSchema,
  type Locale,
} from "@elc/shared"

export type PendingScan = {
  eventId: string
  operationId: string
  credential: { kind: "elc_admission"; version: 1; token: string }
}
export function parseAdmissionQr(raw: string) {
  try {
    if (raw.length > 2048) return null
    const parsed = admissionPayloadSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
/** An uncertain transport outcome retains this exact request for explicit retry. */
export function prepareOnlineScan(
  eventId: string,
  raw: string,
  operationId: string
): PendingScan | null {
  const credential = parseAdmissionQr(raw)
  return credential ? { eventId, operationId, credential } : null
}
export function confirmedScanResponse(
  raw: unknown,
  operationId: string
): ScanResponse | null {
  const parsed = scanResponseSchema.safeParse(raw)
  if (
    !parsed.success ||
    parsed.data.operationId !== operationId ||
    (parsed.data.result === "checked_in" && !parsed.data.checkInId)
  )
    return null
  return parsed.data
}
export function eventCanScan(event: ScannerEvent, now: number): boolean {
  return (
    event.permissions.includes("ticket:scan") &&
    event.cancelledAt === null &&
    event.suspendedAt === null &&
    Date.parse(event.endsAt) > now
  )
}
export const canReverse = (event: ScannerEvent) =>
  event.permissions.includes("checkin:reverse")

export function selectDeviceLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const locale = localeSchema.safeParse(
      language.toLowerCase().split(/[-_]/)[0]
    )
    if (locale.success) return locale.data
  }
  return "kk"
}

export type EventPhase =
  | "cancelled"
  | "suspended"
  | "ended"
  | "live"
  | "today"
  | "upcoming"
const calendarDay = (time: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(time)
export function eventPhase(event: ScannerEvent, now: number): EventPhase {
  if (event.cancelledAt) return "cancelled"
  if (event.suspendedAt) return "suspended"
  if (Date.parse(event.endsAt) <= now) return "ended"
  const startsAt = Date.parse(event.startsAt)
  if (startsAt <= now) return "live"
  return calendarDay(startsAt, event.timeZone) ===
    calendarDay(now, event.timeZone)
    ? "today"
    : "upcoming"
}
export const checkInShare = (counts: ScannerEvent["counts"]) =>
  counts.registered ? Math.min(1, counts.checkedIn / counts.registered) : 0

export type GuestStatus =
  | "blocked"
  | "refunded"
  | "cancelled"
  | "checkedIn"
  | "notIn"
export function guestStatus(ticket: {
  state: TicketState
  admissionBlocked: boolean
  activeCheckInId: string | null
}): GuestStatus {
  if (ticket.admissionBlocked) return "blocked"
  if (ticket.state === "refunded") return "refunded"
  if (ticket.state === "cancelled") return "cancelled"
  return ticket.state === "checked_in" || ticket.activeCheckInId
    ? "checkedIn"
    : "notIn"
}

const activePhases: readonly EventPhase[] = ["live", "today", "upcoming"]
export function sortForStaff(events: readonly ScannerEvent[], now: number) {
  const active = (event: ScannerEvent) =>
    activePhases.includes(eventPhase(event, now))
  const start = (event: ScannerEvent) => Date.parse(event.startsAt)
  return [...events].sort((a, b) =>
    active(a) !== active(b)
      ? active(a)
        ? -1
        : 1
      : active(a)
        ? start(a) - start(b)
        : start(b) - start(a)
  )
}
