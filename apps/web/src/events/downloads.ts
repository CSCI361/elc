import {
  apiErrorSchema,
  type CalendarExportResponse,
  type Locale,
} from "@elc/shared"
import { EventApiError } from "./api"

export type DownloadFormat = "pdf" | "ics"
export function ticketPdfPath(ticketId: string, locale: Locale) {
  return `/api/tickets/${encodeURIComponent(ticketId)}/pdf?locale=${locale}`
}
export function calendarDownloadPath(
  value: string,
  eventId: string,
  locale: Locale,
  origin: string
): string | null {
  try {
    const url = new URL(value)
    const expected = `/api/events/${encodeURIComponent(eventId)}/calendar.ics`
    return url.origin === origin &&
      !url.username &&
      !url.password &&
      url.pathname === expected &&
      url.search === `?locale=${locale}` &&
      !url.hash
      ? `${url.pathname}${url.search}`
      : null
  } catch {
    return null
  }
}
export function calendarCreateLinks(
  data: CalendarExportResponse
): { google: string; outlook: string } | null {
  if (data.calendar.status === "CANCELLED" || !data.createLinks) return null
  const google = new URL(data.createLinks.google)
  const outlook = new URL(data.createLinks.outlook)
  const safe = (url: URL, origin: string, path: string) =>
    url.origin === origin &&
    url.pathname === path &&
    !url.username &&
    !url.password &&
    !url.hash
  return safe(google, "https://calendar.google.com", "/calendar/render") &&
    safe(outlook, "https://outlook.live.com", "/calendar/0/deeplink/compose")
    ? { google: google.href, outlook: outlook.href }
    : null
}

export async function loadDownload(
  path: string,
  format: DownloadFormat,
  signal: AbortSignal,
  request: typeof fetch = fetch
): Promise<Blob> {
  if (!path.startsWith("/api/") || path.includes("\\") || path.includes("#"))
    throw new EventApiError("INVALID_INPUT", 400)
  const response = await request(path, {
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal,
  })
  signal.throwIfAborted()
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(
      await response.json().catch(() => null)
    )
    throw new EventApiError(
      parsed.success ? parsed.data.error.code : "INTERNAL_ERROR",
      response.status,
      parsed.success ? parsed.data.error.requestId : undefined
    )
  }
  const expected = format === "pdf" ? "application/pdf" : "text/calendar"
  if (
    response.headers
      .get("Content-Type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() !== expected
  )
    throw new EventApiError("INTERNAL_ERROR", 502)
  const blob = await response.blob()
  const signature = await blob.slice(0, 15).text()
  signal.throwIfAborted()
  if (!signature.startsWith(format === "pdf" ? "%PDF-" : "BEGIN:VCALENDAR"))
    throw new EventApiError("INTERNAL_ERROR", 502)
  return blob
}
