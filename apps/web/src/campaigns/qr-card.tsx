import { campaignResponseSchema } from "@elc/shared"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { api, EventApiError, segment } from "../events/api"
import { EventError, Field } from "../events/ui"
import { useCampaignText } from "./messages"
import { campaignQrSvg } from "./qr"

export function CampaignQrCard({
  eventId,
  campaignId,
  onDenied,
}: {
  eventId: string
  campaignId: string
  onDenied: (error: unknown) => void
}) {
  const { t } = useCampaignText()
  const [qr, setQr] = useState<ReturnType<typeof campaignQrSvg>>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [message, setMessage] = useState<
    "unsafe" | "copied" | "copyFailed" | null
  >(null)
  const controller = useRef<AbortController | null>(null)
  const downloads = useRef(new Set<string>())
  useEffect(
    () => () => {
      controller.current?.abort()
      for (const url of downloads.current) URL.revokeObjectURL(url)
      downloads.current.clear()
    },
    []
  )

  async function reveal(action: "show" | "copy" | "download") {
    if (controller.current && !controller.current.signal.aborted) return
    const request = new AbortController()
    controller.current = request
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      // Recheck manager permission and the current URL before sharing anything.
      const campaign = await api(
        `/events/${segment(eventId)}/campaigns/${segment(campaignId)}`,
        campaignResponseSchema,
        { signal: request.signal }
      )
      if (request.signal.aborted) return
      const next = campaignQrSvg({
        url: campaign.campaignUrl,
        code: campaign.code,
        eventId,
        origin: window.location.origin,
        allowLocalDevelopment: import.meta.env.DEV,
        name: campaign.name,
        promotionLabel: t("promotion"),
        notTicketLabel: t("notTicket"),
        localLabel: t("local"),
      })
      setQr(next)
      if (!next) {
        setMessage("unsafe")
        return
      }
      if (action === "copy") {
        try {
          await navigator.clipboard.writeText(next.url)
          if (!request.signal.aborted) setMessage("copied")
        } catch {
          if (!request.signal.aborted) setMessage("copyFailed")
        }
      } else if (action === "download") {
        const url = URL.createObjectURL(
          new Blob([next.svg], { type: "image/svg+xml;charset=utf-8" })
        )
        downloads.current.add(url)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = `campaign-${campaignId.replace(/[^a-zA-Z0-9_-]/g, "")}.svg`
        anchor.click()
        window.setTimeout(() => {
          URL.revokeObjectURL(url)
          downloads.current.delete(url)
        }, 1000)
      }
    } catch (failure) {
      if (!request.signal.aborted) {
        setQr(null)
        setError(failure)
        if (
          failure instanceof EventApiError &&
          [401, 403, 404].includes(failure.status)
        )
          onDenied(failure)
      }
    } finally {
      request.abort()
      if (controller.current === request) setPending(false)
    }
  }
  return (
    <section className="campaign-qr" aria-label={t("qr")}>
      <h3>{t("qr")}</h3>
      <p>
        <strong>{t("notTicket")}</strong>. {t("qrHint")}
      </p>
      <p className="field-hint">{t("inactiveHint")}</p>
      <div className="event-actions">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => void reveal("show")}
        >
          {t("showQr")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => void reveal("copy")}
        >
          {t("copy")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => void reveal("download")}
        >
          {t("download")}
        </Button>
      </div>
      {error ? <EventError error={error} /> : null}
      {message ? <p role="status">{t(message)}</p> : null}
      {qr ? (
        <>
          {qr.local ? (
            <p className="campaign-local" role="note">
              {t("local")}
            </p>
          ) : null}
          <Field
            label={t("link")}
            value={qr.url}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
          <img
            className="campaign-qr-image"
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.svg)}`}
            alt={`${t("qr")}. ${t("notTicket")}`}
            width={512}
            height={700}
          />
        </>
      ) : null}
    </section>
  )
}
