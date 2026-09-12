import { requireEventReadAccess } from "../auth/permissions"
import { findEvent, type EventRow } from "../events/store"
import { calendarNotes, type ExportLocale } from "./labels"

const utc = (instant: number) =>
  new Date(instant)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")

function local(instant: number, zone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)!.value
  return `${part("year")}${part("month")}${part("day")}T${part("hour")}${part("minute")}${part("second")}`
}

function offsetMinutes(instant: number, formatter: Intl.DateTimeFormat) {
  const value = formatter
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")!.value
  if (value === "GMT") return 0
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new Error("Unsupported event time-zone offset")
  return (
    (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "-" ? -1 : 1)
  )
}

function offset(value: number) {
  const absolute = Math.abs(value)
  return `${value < 0 ? "-" : "+"}${String(Math.floor(absolute / 60)).padStart(2, "0")}${String(absolute % 60).padStart(2, "0")}`
}

/** Escape content before folding; organizer text cannot introduce ICS properties. */
export function calendarText(value: string) {
  return Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0)!
      return (
        (code >= 32 && code !== 127) ||
        character === "\n" ||
        character === "\r" ||
        character === "\t"
      )
    })
    .join("")
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
}

/** RFC 5545's 75-octet limit must count UTF-8 bytes, not JavaScript characters. */
export function foldCalendarLine(value: string) {
  const encoder = new TextEncoder()
  let output = ""
  let count = 0
  for (const character of value) {
    const length = encoder.encode(character).length
    if (count + length > 75) {
      output += "\r\n "
      count = 1
    }
    output += character
    count += length
  }
  return output
}

function timeZoneComponent(event: EventRow) {
  const zone = event.time_zone
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone: zone,
    timeZoneName: "longOffset",
  })
  const yearStart = (year: number) => {
    const date = new Date(0)
    date.setUTCFullYear(year, 0, 1)
    return date.getTime()
  }
  // This is one event snapshot, not a recurring calendar. Cover both endpoints
  // and their adjacent years, with at most six years of work even for a long event.
  const intervals = [event.starts_at, event.ends_at].map((instant) => {
    const year = new Date(instant).getUTCFullYear()
    return { start: yearStart(year - 1), end: yearStart(year + 2) }
  })
  if (intervals[0]!.end >= intervals[1]!.start) {
    intervals[0]!.end = intervals[1]!.end
    intervals.pop()
  }
  const values = [
    "BEGIN:VTIMEZONE",
    `TZID:${calendarText(zone)}`,
    `X-LIC-LOCATION:${calendarText(zone)}`,
  ]
  for (const { start, end } of intervals) {
    let previous = offsetMinutes(start, formatter)
    values.push(
      "BEGIN:STANDARD",
      `DTSTART:${local(start, zone)}`,
      `TZOFFSETFROM:${offset(previous)}`,
      `TZOFFSETTO:${offset(previous)}`,
      "END:STANDARD"
    )
    for (let day = start + 86400000; day <= end; day += 86400000) {
      const next = offsetMinutes(day, formatter)
      if (next === previous) continue
      let left = day - 86400000
      let right = day
      while (right - left > 60000) {
        const middle = Math.floor((left + right) / 120000) * 60000
        if (offsetMinutes(middle, formatter) === previous) left = middle
        else right = middle
      }
      const kind = next > previous ? "DAYLIGHT" : "STANDARD"
      values.push(
        `BEGIN:${kind}`,
        `DTSTART:${utc(right + previous * 60000).slice(0, -1)}`,
        `TZOFFSETFROM:${offset(previous)}`,
        `TZOFFSETTO:${offset(next)}`,
        `END:${kind}`
      )
      previous = next
    }
  }
  values.push("END:VTIMEZONE")
  return values
}

function dateProperty(name: string, instant: number, zone: string) {
  const value = local(instant, zone)
  // The second occurrence during a DST fall-back cannot be expressed unambiguously as local time.
  for (let delta = 30; delta <= 180; delta += 30)
    if (local(instant - delta * 60000, zone) === value)
      return `${name}:${utc(instant)}`
  return `${name};TZID=${zone}:${value}`
}

export function renderCalendar(event: EventRow, appOrigin: string) {
  const url = new URL(`/events/${encodeURIComponent(event.id)}`, appOrigin).href
  const values = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//elc//Event export 1//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-TIMEZONE:${calendarText(event.time_zone)}`,
    ...timeZoneComponent(event),
    "BEGIN:VEVENT",
    `UID:${calendarText(event.calendar_uid)}`,
    `SEQUENCE:${event.calendar_sequence}`,
    `DTSTAMP:${utc(event.updated_at)}`,
    `CREATED:${utc(event.created_at)}`,
    `LAST-MODIFIED:${utc(event.updated_at)}`,
    dateProperty("DTSTART", event.starts_at, event.time_zone),
    dateProperty("DTEND", event.ends_at, event.time_zone),
    `SUMMARY:${calendarText(event.title)}`,
    `LOCATION:${calendarText(`${event.venue_name}, ${event.venue_address}`)}`,
    `DESCRIPTION:${calendarText(event.description)}`,
    `URL:${url}`,
    `STATUS:${event.cancelled_at === null ? "CONFIRMED" : "CANCELLED"}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
  return values.map(foldCalendarLine).join("\r\n") + "\r\n"
}

export async function readCalendarExport(
  db: D1Database,
  appOrigin: string,
  eventId: string,
  actorId: string | undefined,
  locale: ExportLocale
) {
  await requireEventReadAccess(db, eventId, actorId)
  const event = await findEvent(db, eventId)
  await requireEventReadAccess(db, eventId, actorId)
  const url = new URL(`/events/${encodeURIComponent(eventId)}`, appOrigin).href
  const description = `${event.description}\n${event.time_zone}\n${url}`
  const google = new URL("https://calendar.google.com/calendar/render")
  google.search = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${utc(event.starts_at)}/${utc(event.ends_at)}`,
    ctz: event.time_zone,
    location: `${event.venue_name}, ${event.venue_address}`,
    details: description,
  }).toString()
  const outlook = new URL(
    "https://outlook.live.com/calendar/0/deeplink/compose"
  )
  outlook.search = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
    startdt: new Date(event.starts_at).toISOString(),
    enddt: new Date(event.ends_at).toISOString(),
    location: `${event.venue_name}, ${event.venue_address}`,
    body: description,
  }).toString()
  // A cancelled file updates a snapshot; a new event-creation URL is never an update action.
  return {
    calendar: {
      uid: event.calendar_uid,
      sequence: event.calendar_sequence,
      status:
        event.cancelled_at === null
          ? ("CONFIRMED" as const)
          : ("CANCELLED" as const),
      timeZone: event.time_zone,
      updatedAt: new Date(event.updated_at).toISOString(),
    },
    downloadUrl: new URL(
      `/api/events/${encodeURIComponent(eventId)}/calendar.ics?locale=${locale}`,
      appOrigin
    ).href,
    createLinks:
      event.cancelled_at === null
        ? { google: google.href, outlook: outlook.href }
        : null,
    replacementNote: calendarNotes[locale],
    ics: renderCalendar(event, appOrigin),
  }
}
