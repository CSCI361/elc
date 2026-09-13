import { createBrowserAnalytics } from "@elc/shared/analytics-browser"
import { publicTrafficContextSchema, type EventApi } from "@elc/shared"
import { useEffect, useRef, useSyncExternalStore } from "react"
import { useAccount } from "../auth/context"
import { api } from "../events/api"

export const browserAnalytics = createBrowserAnalytics(
  import.meta.env.VITE_GA4_MEASUREMENT_ID
)
export function useAnalyticsConsent() {
  return useSyncExternalStore(
    browserAnalytics.subscribe,
    browserAnalytics.snapshot
  )
}
export function useDirectoryAnalytics(enabled: boolean) {
  const consent = useAnalyticsConsent(),
    { locale } = useAccount()
  useEffect(() => {
    browserAnalytics.setPage(
      enabled && consent === "granted" ? { kind: "directory", locale } : null
    )
    return browserAnalytics.stop
  }, [consent, enabled, locale])
}
export function usePublicEventAnalytics(event?: EventApi) {
  const consent = useAnalyticsConsent(),
    { locale } = useAccount()
  const active = useRef<{ id: string; campaignCode: string } | null>(null)
  const id = event?.id,
    reportingId = event?.reportingId,
    visibility = event?.visibility,
    publication = event?.publicationState,
    suspended = event?.suspendedAt
  useEffect(() => {
    browserAnalytics.stop()
    active.current = null
    if (
      !id ||
      consent !== "granted" ||
      visibility !== "public" ||
      publication !== "published" ||
      suspended
    )
      return
    const controller = new AbortController()
    const campaignCode = (
      new URLSearchParams(window.location.search).get("campaign") ?? ""
    ).trim()
    void api(
      `/events/${encodeURIComponent(id)}/traffic-context`,
      publicTrafficContextSchema,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          campaignCode && campaignCode.length <= 64 ? { campaignCode } : {}
        ),
      }
    )
      .then((context) => {
        if (
          controller.signal.aborted ||
          context.eventReportingId !== reportingId
        )
          return
        active.current = { id, campaignCode }
        browserAnalytics.setPage({
          kind: "event",
          locale,
          eventReportingId: context.eventReportingId,
          ...(context.campaignReportingId
            ? { campaignReportingId: context.campaignReportingId }
            : {}),
        })
      })
      .catch(() => {
        if (!controller.signal.aborted) browserAnalytics.stop()
      })
    return () => {
      controller.abort()
      active.current = null
      browserAnalytics.stop()
    }
  }, [id, reportingId, visibility, publication, suspended, locale, consent])
  return (valueMinor: number, quantity: number, campaignCode: string) => {
    if (active.current && active.current.id === id)
      browserAnalytics.checkout(
        valueMinor,
        quantity,
        active.current.campaignCode === campaignCode.trim()
      )
  }
}
