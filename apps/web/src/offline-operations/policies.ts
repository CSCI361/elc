import { entityIdSchema } from "@elc/shared"
export const offlineHref = (eventId: string) =>
  `/organizer/events/${encodeURIComponent(eventId)}/offline`
export function offlineRoute(path: string): { eventId?: string } | null {
  if (path === "/offline") return {}
  const match = /^\/organizer\/events\/([^/]+)\/offline$/.exec(path)
  if (!match) return null
  try {
    const parsed = entityIdSchema.safeParse(decodeURIComponent(match[1]!))
    return parsed.success ? { eventId: parsed.data } : null
  } catch {
    return null
  }
}
export function offlineListPath(
  eventId: string,
  kind: "devices" | "admissions",
  cursor = ""
) {
  const query = new URLSearchParams({ limit: "20" })
  if (cursor) query.set("cursor", cursor)
  return `/events/${encodeURIComponent(eventId)}/offline/${kind}?${query}`
}
