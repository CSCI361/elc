import type { Locale } from "@elc/shared"
import { dateParts } from "./date-parts"

export function DateStub({
  iso,
  timeZone,
  locale,
  size = "md",
}: {
  iso: string
  timeZone: string
  locale: Locale
  size?: "md" | "lg"
}) {
  const parts = dateParts(iso, timeZone, locale)
  return (
    <time className={`date-stub date-stub-${size}`} dateTime={iso}>
      <span className="date-stub-month">{parts.month.replace(".", "")}</span>
      <span className="date-stub-day">{parts.day}</span>
    </time>
  )
}
