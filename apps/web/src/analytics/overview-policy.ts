import {
  organizerAnalyticsOverviewQuerySchema,
  type Locale,
  type OrganizerAnalyticsOverviewQuery,
  type OrganizerAnalyticsOverviewResponse,
} from "@elc/shared"

export function overviewQuery(raw: unknown): OrganizerAnalyticsOverviewQuery {
  const query = organizerAnalyticsOverviewQuerySchema.parse(raw)
  if (query.range === "custom") {
    const days =
      (Date.parse(`${query.end}T00:00:00Z`) -
        Date.parse(`${query.start}T00:00:00Z`)) /
        86400000 +
      1
    if (!Number.isInteger(days) || days < 1 || days > 180)
      throw new Error("INVALID_REPORT_PERIOD")
  }
  return query
}
export function overviewPath(raw: unknown) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(overviewQuery(raw)))
    if (value !== undefined) params.set(key, String(value))
  return `/organizer/analytics/overview?${params}`
}
export function overviewFilters(raw: unknown) {
  const { cursor: _cursor, ...query } = overviewQuery(raw)
  return query
}
export function overviewPage(
  query: OrganizerAnalyticsOverviewQuery,
  cursor: string | null
) {
  return overviewQuery({
    ...overviewFilters(query),
    ...(cursor ? { cursor } : {}),
  })
}
export function matchingOverview(
  query: OrganizerAnalyticsOverviewQuery,
  data: OrganizerAnalyticsOverviewResponse
) {
  return (
    data.timeZone === "Asia/Almaty" &&
    data.scope.q === (query.q ?? "") &&
    data.scope.basis === "all_currently_authorized_matching_events" &&
    (query.range === "custom"
      ? data.period.start === query.start && data.period.end === query.end
      : data.period.dayCount === Number(query.range))
  )
}
/** Format every minor unit, including values whose division by 100 would round a cent. */
export function overviewMoney(minor: number, locale: Locale) {
  if (!Number.isSafeInteger(minor)) throw new Error("UNSAFE_MONEY")
  const absolute = BigInt(minor) < 0n ? -BigInt(minor) : BigInt(minor)
  const whole = new Intl.NumberFormat(locale).format(absolute / 100n)
  const fraction = String(absolute % 100n).padStart(2, "0")
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "KZT",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .formatToParts(minor < 0 ? -1n : 1n)
    .map((part) =>
      part.type === "integer"
        ? whole
        : part.type === "fraction"
          ? fraction
          : part.value
    )
    .join("")
}
