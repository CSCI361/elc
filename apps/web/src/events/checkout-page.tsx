import { navigate } from "@/lib/navigation"
import {
  checkoutResponseSchema,
  completedOrderResponseSchema,
  paymentResponseSchema,
  orderTicketsResponseSchema,
  type CheckoutResponse,
} from "@elc/shared"
import { useState } from "react"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ClockIcon,
  TicketIcon,
} from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { segment, useCommand, useResource, useServerNow } from "./api"
import { useEventText } from "./messages"
import { clockText, money, remainingSeconds } from "./policies"
import { priceText } from "./date-parts"
import { EventError, Loading, SectionLoading } from "./ui"
import { CalendarActions, TicketPdfDownload } from "./exports"
import { RefundPanel } from "@/support/refund-panel"
import { useSupportText } from "@/support/messages"
import { supportHref } from "@/support/policies"

function OrderTickets({ orderId }: { orderId: string }) {
  const { t } = useEventText()
  const [cursor, setCursor] = useState("")
  const result = useResource(
    `/orders/${segment(orderId)}/tickets${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    orderTicketsResponseSchema
  )
  return (
    <section className="event-panel">
      <h2>{t("tickets")}</h2>
      {result.error ? (
        <EventError error={result.error} retry={result.reload} />
      ) : null}
      {result.loading ? <SectionLoading /> : null}
      <div className="order-ticket-list">
        {result.data?.items.map((ticket) => (
          <article className="order-ticket-item" key={ticket.id}>
            <a href={`/tickets/${segment(ticket.id)}`}>
              <TicketIcon size={24} aria-hidden />
              <span>
                <strong>{ticket.attendeeName}</strong>
                <small>
                  {ticket.seat
                    ? `${ticket.seat.section} ${ticket.seat.row}${ticket.seat.number}`
                    : t("general_admission")}{" "}
                  · {t(ticket.state)}
                </small>
              </span>
              <ArrowRightIcon size={20} aria-hidden />
            </a>
            {!result.error ? <TicketPdfDownload ticketId={ticket.id} /> : null}
          </article>
        ))}
      </div>
      <div className="event-pagination">
        {cursor ? (
          <button className="text-action" onClick={() => setCursor("")}>
            {t("firstPage")}
          </button>
        ) : null}
        {result.data?.nextCursor ? (
          <button
            className="text-action"
            onClick={() => setCursor(result.data?.nextCursor ?? "")}
          >
            {t("more")}
          </button>
        ) : null}
      </div>
    </section>
  )
}

function CheckoutActions({
  data,
  reload,
}: {
  data: CheckoutResponse
  reload: () => void
}) {
  const { t, locale } = useEventText()
  const command = useCommand()
  const now = useServerNow()
  const remaining = remainingSeconds(data.reservation.expiresAt, now)
  const active =
    data.order.state === "pending" &&
    data.reservation.state === "active" &&
    remaining > 0
  const paymentId = data.reservation.paymentAttemptId
  return (
    <section className="event-panel checkout-actions">
      {command.error ? (
        <EventError error={command.error} retry={reload} />
      ) : null}
      {active ? (
        <>
          <div className="reservation-clock">
            <ClockIcon size={24} aria-hidden />
            <div>
              <span>{t("remaining")}</span>
              <strong aria-live="off">{clockText(remaining)}</strong>
              <time dateTime={data.reservation.expiresAt}>
                {new Intl.DateTimeFormat(locale, {
                  timeStyle: "short",
                }).format(new Date(data.reservation.expiresAt))}
              </time>
            </div>
          </div>
          {data.order.totalMinor === 0 && !paymentId ? (
            <Button
              className="auth-button"
              disabled={command.pending}
              onClick={() => {
                void command
                  .send(
                    `/orders/${segment(data.order.id)}/complete`,
                    completedOrderResponseSchema,
                    { expectedRevision: data.revision }
                  )
                  .then((result) => {
                    if (result) reload()
                  })
              }}
            >
              {command.pending ? t("loading") : t("completeFree")}
            </Button>
          ) : paymentId ? (
            <a
              className="primary-link"
              href={`/payments/${segment(paymentId)}`}
            >
              {t("paymentTitle")}
              <ArrowRightIcon size={18} aria-hidden />
            </a>
          ) : (
            <>
              <p>{t("paymentNote")}</p>
              <Button
                className="auth-button"
                disabled={command.pending}
                onClick={() => {
                  void command
                    .send(
                      `/orders/${segment(data.order.id)}/payment`,
                      paymentResponseSchema,
                      { expectedRevision: data.revision }
                    )
                    .then((result) => {
                      if (result)
                        navigate(`/payments/${segment(result.payment.id)}`)
                    })
                }}
              >
                {command.pending ? t("paymentPending") : t("pay")}
              </Button>
            </>
          )}
          <Button
            variant="outline"
            className="auth-button"
            disabled={command.pending}
            onClick={() => {
              void command
                .send(
                  `/orders/${segment(data.order.id)}/abandon`,
                  checkoutResponseSchema,
                  { expectedRevision: data.revision }
                )
                .then((result) => {
                  if (result) reload()
                })
            }}
          >
            {t("abandon")}
          </Button>
        </>
      ) : (
        <>
          <h2>
            {t(data.order.state === "pending" ? "expired" : data.order.state)}
          </h2>
          {data.order.state === "expired" || data.order.state === "pending" ? (
            <p>{t("expiredHint")}</p>
          ) : null}
          <a
            className="secondary-link"
            href={`/events/${segment(data.order.eventId)}`}
          >
            {t("details")}
          </a>
        </>
      )}
    </section>
  )
}

export function CheckoutPage({ orderId }: { orderId: string }) {
  const { t: supportText } = useSupportText()
  const { locale, t } = useEventText()
  const resource = useResource(
    `/orders/${segment(orderId)}`,
    checkoutResponseSchema,
    5000
  )
  if (!resource.data)
    return resource.error ? (
      <EventError error={resource.error} retry={resource.reload} />
    ) : (
      <Loading />
    )
  const { order } = resource.data
  return (
    <div className="events-page">
      <a className="back-link" href={`/events/${segment(order.eventId)}`}>
        <ArrowLeftIcon size={18} aria-hidden />
        {t("details")}
      </a>
      <div className="event-page-heading">
        <div>
          <h1>
            {t(
              order.state === "completed"
                ? "ticketReady"
                : order.completedAt
                  ? "order"
                  : "checkout"
            )}
          </h1>
        </div>
        {!resource.error ? (
          <a
            className="secondary-link"
            href={supportHref({
              orderId: order.id,
              eventId: order.eventId,
              audience: "attendee",
            })}
          >
            {supportText("help")}
          </a>
        ) : null}
      </div>
      {resource.error ? (
        <EventError error={resource.error} retry={resource.reload} />
      ) : null}
      <div className="event-detail-grid">
        <div>
          <section className="event-panel">
            <h2>{t("orderSummary")}</h2>
            {order.items.map((item) => (
              <article className="order-line" key={item.id}>
                <div>
                  <h3>{item.ticketTypeName}</h3>
                  <p>
                    {t("quantity")}: {item.quantity}
                  </p>
                  {item.seats.map((seat) => (
                    <span className="seat-chip" key={seat.seatId}>
                      {seat.section} {seat.row}
                      {seat.number}
                    </span>
                  ))}
                  <p>
                    {resource.data?.attendees
                      .find((attendees) => attendees.orderItemId === item.id)
                      ?.names.join(", ")}
                  </p>
                </div>
                <strong>{priceText(item.totalMinor, locale)}</strong>
              </article>
            ))}
            <dl className="order-totals">
              <div>
                <dt>{t("subtotal")}</dt>
                <dd>{priceText(order.subtotalMinor, locale)}</dd>
              </div>
              {order.discountMinor > 0 ? (
                <div>
                  <dt>{t("discount")}</dt>
                  <dd>−{money(order.discountMinor, locale)}</dd>
                </div>
              ) : null}
              <div className="order-total">
                <dt>{t("total")}</dt>
                <dd>{priceText(order.totalMinor, locale)}</dd>
              </div>
            </dl>
          </section>
          {order.completedAt && !resource.error ? (
            <RefundPanel orderId={order.id} onChanged={resource.reload} />
          ) : (
            <section className="event-panel">
              <h2>{t("refundPolicy")}</h2>
              <p>{t("refundHint")}</p>
              <p className="preserve-lines">
                {resource.data.refundPolicy.instructions}
              </p>
            </section>
          )}
        </div>
        <div>
          {order.completedAt !== null ? (
            <OrderTickets orderId={order.id} />
          ) : (
            <CheckoutActions data={resource.data} reload={resource.reload} />
          )}
          {order.completedAt ? (
            <CalendarActions eventId={order.eventId} />
          ) : null}
        </div>
      </div>
    </div>
  )
}
