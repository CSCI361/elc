import {
  resolveCampaignResponseSchema,
  type ResolvedCampaign,
} from "@elc/shared"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { api, EventApiError, segment, useServerNow } from "./api"
import { useEventText } from "./messages"
import { dateText, money } from "./policies"

import { useCampaignNoticeText } from "./campaign-notice-messages"

export function CampaignNotice({
  eventId,
  code,
  timeZone,
  ticketTypes,
  onClear,
}: {
  eventId: string
  code: string
  timeZone: string
  ticketTypes: { id: string; name: string }[]
  onClear: () => void
}) {
  const { locale } = useEventText()
  const { t } = useCampaignNoticeText()
  const now = useServerNow()
  const normalized = code.trim()
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<{
    eventId: string
    code: string
    version: number
    data?: ResolvedCampaign
    error?: unknown
  } | null>(null)
  useEffect(() => {
    if (!normalized || normalized.length > 64) return
    const controller = new AbortController()
    let pending = false
    const read = async () => {
      if (pending) return
      pending = true
      try {
        const data = await api(
          `/events/${segment(eventId)}/campaigns/resolve`,
          resolveCampaignResponseSchema,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: normalized }),
            signal: controller.signal,
          }
        )
        if (data.eventId !== eventId)
          throw new EventApiError("INVALID_RESPONSE", 502)
        if (!controller.signal.aborted)
          setResult({ eventId, code: normalized, version, data })
      } catch (error) {
        if (!controller.signal.aborted)
          setResult({ eventId, code: normalized, version, error })
      } finally {
        pending = false
      }
    }
    const debounce = window.setTimeout(() => void read(), 300)
    const timer = window.setInterval(() => void read(), 15000)
    return () => {
      controller.abort()
      window.clearTimeout(debounce)
      window.clearInterval(timer)
    }
  }, [eventId, normalized, version])
  if (!normalized) return null
  const current =
    result?.eventId === eventId &&
    result.code === normalized &&
    result.version === version
      ? result
      : null
  const campaign = current?.data?.campaign
  const invalid =
    normalized.length > 64 ||
    (campaign && Date.parse(campaign.endsAt) <= now) ||
    (current?.error instanceof EventApiError && current.error.status < 500)
  const error = invalid || current?.error
  return (
    <div className="event-inline-note campaign-terms" aria-live="polite">
      {error ? (
        <p role="alert">{t(invalid ? "invalid" : "failed")}</p>
      ) : campaign ? (
        <>
          <p>
            <strong>
              {t("title")}: {campaign.name}
            </strong>
          </p>
          <p>
            {campaign.discount.kind === "percentage"
              ? `${new Intl.NumberFormat(locale).format(campaign.discount.basisPoints / 100)}%`
              : money(campaign.discount.amountMinor, locale)}
          </p>
          <p>
            {t("eligible")}:{" "}
            {ticketTypes
              .filter((type) =>
                campaign.applicableTicketTypeIds.includes(type.id)
              )
              .map((type) => type.name)
              .join(", ")}
          </p>
          <p>
            {t("until")}: {dateText(campaign.endsAt, timeZone, locale)}
          </p>
          <p>{t("final")}</p>
        </>
      ) : (
        <p role="status">{t("checking")}</p>
      )}
      {error ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => setVersion((value) => value + 1)}
        >
          {t("retry")}
        </Button>
      ) : null}
      <Button type="button" variant="outline" onClick={onClear}>
        {t("clear")}
      </Button>
    </div>
  )
}
