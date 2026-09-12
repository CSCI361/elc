import {
  ticketCredentialResponseSchema,
  ticketDetailResponseSchema,
} from "@elc/shared"
import { ArrowLeftIcon, ShieldCheckIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"
import QRCode from "qrcode"
import { Button } from "@/components/ui/button"
import { segment, useResource } from "./api"
import { useEventText } from "./messages"
import { EventError, Loading } from "./ui"
import { TicketPdfDownload } from "./exports"
import { supportHref } from "@/support/policies"
import { useSupportText } from "@/support/messages"

function Credential({ ticketId }: { ticketId: string }) {
  const { t } = useEventText()
  const resource = useResource(
    `/tickets/${segment(ticketId)}/credential`,
    ticketCredentialResponseSchema,
    15000
  )
  if (!resource.data)
    return resource.error ? (
      <EventError error={resource.error} retry={resource.reload} />
    ) : (
      <Loading />
    )
  if (
    resource.data.ticket.admissionBlocked ||
    resource.data.ticket.state !== "valid"
  )
    return <p role="status">{t("blocked")}</p>
  const code = QRCode.create(JSON.stringify(resource.data.credential), {
    errorCorrectionLevel: "M",
  })
  const size = code.modules.size
  const squares = Array.from(code.modules.data)
    .flatMap((value, index) =>
      value
        ? [`M${(index % size) + 4} ${Math.floor(index / size) + 4}h1v1h-1z`]
        : []
    )
    .join("")
  return (
    <div className="ticket-credential">
      {resource.error ? (
        <EventError error={resource.error} retry={resource.reload} />
      ) : (
        <svg
          role="img"
          aria-label={t("showCredential")}
          viewBox={`0 0 ${size + 8} ${size + 8}`}
          shapeRendering="crispEdges"
        >
          <rect width={size + 8} height={size + 8} fill="#fff" />
          <path d={squares} fill="#000" />
        </svg>
      )}
      <p>{t("credentialHint")}</p>
    </div>
  )
}

export function TicketPage({ ticketId }: { ticketId: string }) {
  const { t: supportText } = useSupportText()
  const { t } = useEventText()
  const resource = useResource(
    `/tickets/${segment(ticketId)}`,
    ticketDetailResponseSchema,
    15000
  )
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const hide = () => setVisible(false)
    window.addEventListener("blur", hide)
    document.addEventListener("visibilitychange", hide)
    return () => {
      window.removeEventListener("blur", hide)
      document.removeEventListener("visibilitychange", hide)
    }
  }, [])
  if (!resource.data)
    return resource.error ? (
      <EventError error={resource.error} retry={resource.reload} />
    ) : (
      <Loading />
    )
  const { ticket } = resource.data
  return (
    <div className="events-page ticket-page">
      <a className="back-link" href={`/orders/${segment(ticket.orderId)}`}>
        <ArrowLeftIcon size={18} aria-hidden />
        {t("order")}
      </a>
      <section className="event-panel ticket-document">
        <span className="eyebrow">
          <ShieldCheckIcon size={20} aria-hidden />
          {t(ticket.state)}
        </span>
        <h1>{ticket.attendeeName}</h1>
        <p>
          {ticket.seat
            ? `${ticket.seat.section} · ${t("row")} ${ticket.seat.row} · ${t("seat")} ${ticket.seat.number}`
            : t("general_admission")}
        </p>
        <a
          className="secondary-link"
          href={`/events/${segment(ticket.eventId)}`}
        >
          {t("details")}
        </a>
        {!resource.error ? (
          <div className="ticket-pdf-action">
            <a
              className="secondary-link"
              href={supportHref({
                ticketId: ticket.id,
                orderId: ticket.orderId,
                eventId: ticket.eventId,
                audience: "attendee",
              })}
            >
              {supportText("help")}
            </a>
            <TicketPdfDownload ticketId={ticket.id} />
            <p>{t("pdfPrivacy")}</p>
          </div>
        ) : null}
        {resource.error ? (
          <EventError error={resource.error} retry={resource.reload} />
        ) : ticket.admissionBlocked || ticket.state !== "valid" ? (
          <p role="status">{t("blocked")}</p>
        ) : (
          <>
            <Button
              className="auth-button"
              onClick={() => setVisible((value) => !value)}
              aria-expanded={visible}
            >
              {t(visible ? "hideCredential" : "showCredential")}
            </Button>
            {visible ? <Credential ticketId={ticket.id} /> : null}
          </>
        )}
      </section>
    </div>
  )
}
