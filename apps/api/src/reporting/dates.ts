import { calendarDateSchema, type EventAnalyticsQuery } from "@elc/shared"
import { ApiFailure } from "../db/transitions"

const dayMs = 86_400_000

export function addCalendarDays(date: string, days: number): string {
  calendarDateSchema.parse(date)
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * dayMs)
    .toISOString()
    .slice(0, 10)
}

function formatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
}

function formattedDate(format: Intl.DateTimeFormat, timestamp: number) {
  const parts = format.formatToParts(timestamp)
  const get = (type: string) => parts.find((part) => part.type === type)!.value
  return `${get("year")}-${get("month")}-${get("day")}`
}

export function calendarDateAt(timestamp: number, timeZone: string) {
  return formattedDate(formatter(timeZone), timestamp)
}

/** First instant of a civil date, including midnight gaps and repeated hours. */
export function calendarDayStart(date: string, timeZone: string) {
  calendarDateSchema.parse(date)
  const format = formatter(timeZone)
  const nominal = Date.parse(`${date}T00:00:00Z`)
  let lower = nominal - 2 * dayMs
  let upper = nominal + 2 * dayMs
  // A civil date is monotone across ordinary offset changes. A skipped date
  // has the same boundary as its successor and therefore a zero-length bucket.
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2)
    if (formattedDate(format, middle) < date) lower = middle + 1
    else upper = middle
  }
  return lower
}

export function reportingPeriod(
  query: EventAnalyticsQuery,
  timeZone: string,
  now: number
) {
  const end =
    query.range === "custom" ? query.end! : calendarDateAt(now, timeZone)
  const start =
    query.range === "custom"
      ? query.start!
      : addCalendarDays(end, -(Number(query.range) - 1))
  const dayCount =
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
      dayMs +
    1
  if (!Number.isSafeInteger(dayCount) || dayCount < 1 || dayCount > 180)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Choose an inclusive report period of at most 180 calendar days."
    )
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = addCalendarDays(start, index)
    return { date, start: calendarDayStart(date, timeZone) }
  })
  const endExclusive = calendarDayStart(addCalendarDays(end, 1), timeZone)
  return {
    start,
    end,
    dayCount,
    startAt: days[0]!.start,
    endExclusive,
    days: days.map((day, index) => ({
      ...day,
      end: days[index + 1]?.start ?? endExclusive,
    })),
  }
}
