import { analyticsConsentText } from "@elc/shared/analytics-copy"
import { ChartLineUpIcon, XIcon } from "@phosphor-icons/react"
import { useEffect, useRef } from "react"
import { useAccount } from "../auth/context"
import { useEventText } from "@/events/messages"
import { browserAnalytics, useAnalyticsConsent } from "./collection"
import "./consent.css"

export function AnalyticsConsent({
  reopened,
  onClose,
}: {
  reopened: boolean
  onClose: () => void
}) {
  const { locale } = useAccount(),
    consent = useAnalyticsConsent(),
    banner = useRef<HTMLElement>(null),
    { t: eventText } = useEventText()
  const t = (key: Parameters<typeof analyticsConsentText>[1]) =>
    analyticsConsentText(locale, key)
  useEffect(() => {
    if (reopened) banner.current?.focus()
  }, [reopened])
  if (consent !== "unset" && !reopened) return null
  const choose = (value: "granted" | "denied") => {
    browserAnalytics.setConsent(value)
    onClose()
  }
  return (
    <section
      ref={banner}
      tabIndex={-1}
      className="analytics-consent"
      aria-labelledby="analytics-consent-title"
    >
      <div className="analytics-consent-head">
        <span className="analytics-consent-icon" aria-hidden>
          <ChartLineUpIcon size={18} weight="bold" />
        </span>
        <h2 id="analytics-consent-title">{t("title")}</h2>
        {consent !== "unset" ? (
          <button
            type="button"
            className="icon-button"
            aria-label={eventText("close")}
            onClick={onClose}
          >
            <XIcon size={16} aria-hidden />
          </button>
        ) : null}
      </div>
      <p>
        {t("detail")}
        {consent !== "unset" ? (
          <strong role="status"> {t(consent)}</strong>
        ) : null}
      </p>
      <div className="analytics-consent-actions">
        {consent !== "granted" ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => choose("granted")}
          >
            {t("allow")}
          </button>
        ) : null}
        {consent !== "denied" ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => choose("denied")}
          >
            {t(consent === "granted" ? "withdraw" : "deny")}
          </button>
        ) : null}
      </div>
    </section>
  )
}
