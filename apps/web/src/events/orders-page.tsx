import { accountOrdersResponseSchema } from "@elc/shared"
import { ArrowRightIcon, TicketIcon } from "@phosphor-icons/react"
import { useState } from "react"
import { useEventText } from "./messages"
import { segment, useResource } from "./api"
import { money } from "./policies"
import { EventError, Loading } from "./ui"

export function OrdersPage() {
  const { locale, t } = useEventText()
  const [cursor, setCursor] = useState("")
  const result = useResource(
    `/me/orders?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    accountOrdersResponseSchema
  )
  return (
    <div className="events-page">
      <div className="event-page-heading">
        <h1>{t("orders")}</h1>
        <a className="secondary-link" href="/events">
          {t("discover")}
        </a>
      </div>
      {result.error ? (
        <EventError error={result.error} retry={result.reload} />
      ) : null}
      {result.loading ? <Loading /> : null}
      {result.data?.items.length === 0 ? (
        <p className="event-empty">{t("emptyOrders")}</p>
      ) : null}
      <div className="account-order-list">
        {result.data?.items.map((order) => (
          <a href={`/orders/${segment(order.id)}`} key={order.id}>
            <TicketIcon size={26} aria-hidden />
            <div>
              <h2>{order.eventTitle}</h2>
              <span>{t(order.state)}</span>
            </div>
            <strong>{money(order.totalMinor, locale)}</strong>
            <ArrowRightIcon size={20} aria-hidden />
          </a>
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
    </div>
  )
}
