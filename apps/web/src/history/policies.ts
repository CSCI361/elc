import {
  duplicatePastEventSchema,
  eventHistoryQuerySchema,
  organizerHistoryQuerySchema,
  type DuplicatePastEvent,
  type EventApi,
} from "@elc/shared"

export function historyRoute(
  path: string
):
  | { kind: "list" }
  | { kind: "timeline" | "duplicate"; eventId: string }
  | null {
  if (path === "/organizer/history") return { kind: "list" }
  const match = /^\/organizer\/events\/([^/]+)\/(history|duplicate)$/.exec(path)
  if (!match) return null
  try {
    const eventId = decodeURIComponent(match[1]!)
    return eventId && eventId.length <= 128 && !eventId.includes("/")
      ? { kind: match[2] === "history" ? "timeline" : "duplicate", eventId }
      : null
  } catch {
    return null
  }
}
export const isHistoryPath = (path: string) => historyRoute(path) !== null
export const eventHistoryHref = (id: string) =>
  `/organizer/events/${encodeURIComponent(id)}/history`
export const duplicateHref = (id: string) =>
  `/organizer/events/${encodeURIComponent(id)}/duplicate`
export function historyFilters(search: string, timeline: boolean) {
  const parameters = new URLSearchParams(search)
  const allowed = timeline
    ? ["range", "start", "end", "activityType", "cursor"]
    : ["q", "phase", "start", "end", "cursor"]
  const raw = Object.fromEntries(
    allowed.flatMap((key) =>
      parameters.get(key) ? [[key, parameters.get(key)!]] : []
    )
  )
  return timeline
    ? eventHistoryQuerySchema.safeParse(raw)
    : organizerHistoryQuerySchema.safeParse(raw)
}
export function pageHref(path: string, search: string, cursor?: string) {
  const params = new URLSearchParams(search)
  params.delete("cursor")
  if (cursor) params.set("cursor", cursor)
  return `${path}${params.size ? `?${params}` : ""}`
}
export function localDateTime(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at)
  const get = (name: string) => parts.find((part) => part.type === name)!.value
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`
}
/** Reject gaps and repeated local times instead of silently choosing a different instant. */
export function localDateTimeToUtc(
  value: string,
  timeZone: string
): string | null {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) return null
  const nominal = Date.parse(`${value}:00Z`)
  if (
    !Number.isFinite(nominal) ||
    new Date(nominal).toISOString().slice(0, 16) !== value
  )
    return null
  const matches = new Set<number>()
  for (const hours of [-36, 0, 36]) {
    const sample = nominal + hours * 3600000
    const offset = Date.parse(`${localDateTime(sample, timeZone)}:00Z`) - sample
    const candidate = nominal - offset
    if (localDateTime(candidate, timeZone) === value) matches.add(candidate)
  }
  return matches.size === 1 ? new Date([...matches][0]!).toISOString() : null
}
export function duplicateEligible(event: EventApi, now: number) {
  return (
    event.suspendedAt === null &&
    (event.cancelledAt !== null || Date.parse(event.endsAt) <= now)
  )
}
export function duplicationInput(
  event: EventApi,
  values: Record<string, string>,
  now: number
) {
  const converted = Object.fromEntries(
    ["startsAt", "endsAt", "registrationOpensAt", "registrationClosesAt"].map(
      (key) => [key, localDateTimeToUtc(values[key] ?? "", event.timeZone)]
    )
  )
  const parsed = duplicatePastEventSchema.safeParse({
    ...converted,
    requestId: "validate",
    expectedRevision: event.revision,
  })
  if (
    !parsed.success ||
    Date.parse(parsed.data.startsAt) <= now ||
    Date.parse(parsed.data.registrationClosesAt) <= now
  )
    return null
  return parsed.data
}
export type PendingDuplication = {
  version: 1
  accountId: string
  eventId: string
  input: DuplicatePastEvent
  uncertain: boolean
}
export const pendingKey = (accountId: string, eventId: string) =>
  `elc:duplicate:v1:${encodeURIComponent(accountId)}:${encodeURIComponent(eventId)}`
export function parsePending(
  value: string | null,
  accountId: string,
  eventId: string
): PendingDuplication | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<PendingDuplication>
    const input = duplicatePastEventSchema.safeParse(parsed.input)
    return parsed.version === 1 &&
      parsed.accountId === accountId &&
      parsed.eventId === eventId &&
      typeof parsed.uncertain === "boolean" &&
      input.success
      ? {
          version: 1,
          accountId,
          eventId,
          uncertain: parsed.uncertain,
          input: input.data,
        }
      : null
  } catch {
    return null
  }
}
export function newPending(
  accountId: string,
  eventId: string,
  input: DuplicatePastEvent,
  requestId: string = crypto.randomUUID()
): PendingDuplication {
  return {
    version: 1,
    accountId,
    eventId,
    input: { ...input, requestId },
    uncertain: true,
  }
}
/** Once a response was ambiguous, a later access error cannot prove the first request did not commit. */
export function canResetRejectedRequest(
  wasAlreadyUncertain: boolean,
  status: number | undefined
) {
  return !wasAlreadyUncertain && (status === 400 || status === 409)
}
