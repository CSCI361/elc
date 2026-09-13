import { useEffect, useRef } from "react"
import { AuthNotice } from "@/auth/notice"
import { EventApiError } from "@/events/api"
import { EventError } from "@/events/ui"
import { useEventText } from "@/events/messages"
import { useHistoryText } from "./messages"
import type { historyRetentionSchema } from "@elc/shared"
export function HistoryHeading({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <h1 ref={ref} tabIndex={-1}>
      {children}
    </h1>
  )
}
export function HistoryFailure({
  error,
  retry,
  duplicate = false,
}: {
  error: unknown
  retry: () => void
  duplicate?: boolean
}) {
  const { t } = useHistoryText(),
    { t: et } = useEventText()
  return error instanceof EventApiError &&
    [401, 403, 404].includes(error.status) ? (
    <AuthNotice>
      {t(duplicate ? "duplicateDenied" : "denied")}{" "}
      <button type="button" className="text-action" onClick={retry}>
        {et("reload")}
      </button>
    </AuthNotice>
  ) : (
    <EventError error={error} retry={retry} />
  )
}
export function Retention({
  value,
  timeZone,
}: {
  value: ReturnType<typeof historyRetentionSchema.parse>
  timeZone: string
}) {
  const { t, locale } = useHistoryText()
  return (
    <div className="history-retention">
      <p>
        <strong>{t("expires")}</strong>:{" "}
        <time dateTime={value.expiresAt}>
          {new Intl.DateTimeFormat(locale, {
            timeZone,
            dateStyle: "long",
          }).format(new Date(value.expiresAt))}
        </time>
      </p>
      {value.held ? (
        <p>
          {t("held")}: {value.holdReasons.map((reason) => t(reason)).join(", ")}
        </p>
      ) : null}
    </div>
  )
}
export function FiltersInvalid({ resetHref }: { resetHref: string }) {
  const { t } = useHistoryText()
  return (
    <AuthNotice>
      {t("invalidFilters")}{" "}
      <a className="text-action" href={resetHref}>
        {t("reset")}
      </a>
    </AuthNotice>
  )
}
