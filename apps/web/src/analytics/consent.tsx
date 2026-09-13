import { analyticsConsentText } from "@elc/shared/analytics-copy"
import { useAccount } from "../auth/context"
import { browserAnalytics, useAnalyticsConsent } from "./collection"
import "./consent.css"

export function AnalyticsConsent() {
  const { locale } = useAccount(),
    consent = useAnalyticsConsent()
  const t = (key: Parameters<typeof analyticsConsentText>[1]) =>
    analyticsConsentText(locale, key)
  return (
    <section
      className="analytics-consent"
      aria-labelledby="analytics-consent-title"
    >
      <h2 id="analytics-consent-title">{t("title")}</h2>
      <p>{t("detail")}</p>
      {consent !== "unset" ? <p role="status">{t(consent)}</p> : null}
      <div className="analytics-consent-actions">
        {consent !== "granted" ? (
          <button
            type="button"
            className="text-action"
            onClick={() => browserAnalytics.setConsent("granted")}
          >
            {t("allow")}
          </button>
        ) : null}
        <button
          type="button"
          className="text-action"
          onClick={() => browserAnalytics.setConsent("denied")}
        >
          {t(consent === "granted" ? "withdraw" : "deny")}
        </button>
      </div>
    </section>
  )
}
