import { calendarExportResponseSchema } from "@elc/shared"
import { ArrowSquareOutIcon, DownloadSimpleIcon } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"
import { useAccount } from "@/auth/context"
import { Button } from "@/components/ui/button"
import { segment, useResource } from "./api"
import {
  calendarCreateLinks,
  calendarDownloadPath,
  loadDownload,
  ticketPdfPath,
  type DownloadFormat,
} from "./downloads"
import { useEventText } from "./messages"
import { EventError, Loading } from "./ui"

function DownloadButton({
  path,
  format,
  label,
}: {
  path: string
  format: DownloadFormat
  label: string
}) {
  const { t, locale } = useEventText()
  const controller = useRef<AbortController | null>(null)
  const objectUrls = useRef(new Map<string, number>())
  const [pending, setPending] = useState(false)
  const [started, setStarted] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    const urls = objectUrls.current
    return () => {
      controller.current?.abort()
      for (const [url, timer] of urls) {
        window.clearTimeout(timer)
        URL.revokeObjectURL(url)
      }
      urls.clear()
    }
  }, [])
  async function download() {
    if (controller.current) return
    const active = new AbortController()
    controller.current = active
    setPending(true)
    setError(null)
    setStarted(false)
    try {
      const blob = await loadDownload(path, format, active.signal)
      if (active.signal.aborted) return
      const url = URL.createObjectURL(blob)
      const timer = window.setTimeout(() => {
        URL.revokeObjectURL(url)
        objectUrls.current.delete(url)
      }, 60_000)
      objectUrls.current.set(url, timer)
      const link = document.createElement("a")
      link.href = url
      link.download = `elc-${format === "pdf" ? "ticket" : "event"}-${locale}.${format}`
      link.hidden = true
      document.body.append(link)
      link.click()
      link.remove()
      setStarted(true)
    } catch (failure) {
      if (!active.signal.aborted) setError(failure)
    } finally {
      if (!active.signal.aborted) {
        controller.current = null
        setPending(false)
      }
    }
  }
  return (
    <div className="export-download">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => void download()}
      >
        <DownloadSimpleIcon size={18} aria-hidden />
        {pending ? t("preparingDownload") : label}
      </Button>
      {started ? <small role="status">{t("downloadStarted")}</small> : null}
      {error ? <EventError error={error} /> : null}
    </div>
  )
}

export function TicketPdfDownload({ ticketId }: { ticketId: string }) {
  const { account, status } = useAccount()
  const { locale, t } = useEventText()
  return status === "active" ? (
    <DownloadButton
      key={`${ticketId}:${locale}:${account?.user.id}`}
      path={ticketPdfPath(ticketId, locale)}
      format="pdf"
      label={t("ticketPdf")}
    />
  ) : null
}

function CurrentCalendar({ eventId }: { eventId: string }) {
  const { locale, t } = useEventText()
  const resource = useResource(
    `/events/${segment(eventId)}/calendar?locale=${locale}`,
    calendarExportResponseSchema,
    15_000
  )
  if (resource.error)
    return <EventError error={resource.error} retry={resource.reload} />
  if (!resource.data) return <Loading />
  const { data } = resource
  const path = calendarDownloadPath(
    data.downloadUrl,
    eventId,
    locale,
    window.location.origin
  )
  const links = calendarCreateLinks(data)
  return (
    <>
      {data.calendar.status === "CANCELLED" ? (
        <p role="status">{t("calendarCancelled")}</p>
      ) : null}
      <div className="export-actions">
        {path ? (
          <DownloadButton path={path} format="ics" label={t("calendarIcs")} />
        ) : null}
        {links ? (
          <>
            <a
              className="secondary-link"
              href={links.google}
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Calendar
              <ArrowSquareOutIcon size={18} aria-hidden />
              <span className="sr-only">{t("newTab")}</span>
            </a>
            <a
              className="secondary-link"
              href={links.outlook}
              target="_blank"
              rel="noopener noreferrer"
            >
              Outlook
              <ArrowSquareOutIcon size={18} aria-hidden />
              <span className="sr-only">{t("newTab")}</span>
            </a>
          </>
        ) : null}
      </div>
      <p className="calendar-note">{data.replacementNote}</p>
      {links ? (
        <small className="calendar-provider-note">
          {t("calendarProviderNote")}
        </small>
      ) : null}
    </>
  )
}

export function CalendarActions({ eventId }: { eventId: string }) {
  const { account, status } = useAccount()
  const { locale, t } = useEventText()
  return (
    <section className="event-panel calendar-panel">
      <h2>{t("addCalendar")}</h2>
      <CurrentCalendar
        key={`${eventId}:${locale}:${account?.user.id ?? status}`}
        eventId={eventId}
      />
    </section>
  )
}
