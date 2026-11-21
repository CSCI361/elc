import { accountOrdersResponseSchema } from "@elc/shared"
import { ArrowRightIcon, TicketIcon } from "@phosphor-icons/react"
import { useState } from "react"
import { Bar, SkeletonRegion } from "@/components/ui/skeleton"
import { useEventText } from "./messages"
import { segment, serverNow, useResource } from "./api"
import { dateParts, priceText } from "./date-parts"
import { DateStub } from "./date-stub"
import { groupOrders } from "./order-groups"
import { EventError } from "./ui"

const viewerTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

function OrderListSkeleton({ label }: { label: string }) {
  return (
    <SkeletonRegion label={label}>
      <div className="account-order-list">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="order-row-skeleton">
            <Bar width={44} height={48} radius={8} />
            <div>
              <Bar width="45%" height={16} />
              <Bar width="25%" height={12} style={{ marginTop: 8 }} />
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}

type OrderItem = ReturnType<
  typeof accountOrdersResponseSchema.parse
>["items"][number]

function OrderList({ items }: { items: OrderItem[] }) {
  const { locale, t } = useEventText()
  return (
    <div className="account-order-list">
      {items.map((order) => {
        const when = dateParts(order.eventStartsAt, viewerTimeZone, locale)
        return (
          <a href={`/orders/${segment(order.id)}`} key={order.id}>
            <DateStub
              iso={order.eventStartsAt}
              timeZone={viewerTimeZone}
              locale={locale}
            />
            <div>
              <h2>{order.eventTitle}</h2>
              <span>
                {when.weekday}, {when.time}
                {order.state === "completed" ? null : (
                  <span className="badge">{t(order.state)}</span>
                )}
              </span>
            </div>
            <strong>{priceText(order.totalMinor, locale)}</strong>
            <ArrowRightIcon size={20} aria-hidden />
          </a>
        )
      })}
    </div>
  )
}

export function OrdersPage() {
  const { t } = useEventText()
  const [cursor, setCursor] = useState("")
  const result = useResource(
    `/me/orders?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    accountOrdersResponseSchema
  )
  const [now] = useState(serverNow)
  const groups = groupOrders(result.data?.items ?? [], now)
  return (
    <div className="events-page">
      <div className="event-page-heading">
        <h1>{t("myTickets")}</h1>
        <a className="secondary-link" href="/events">
          {t("discover")}
        </a>
      </div>
      {result.error ? (
        <EventError error={result.error} retry={result.reload} />
      ) : null}
      {result.loading ? <OrderListSkeleton label={t("loading")} /> : null}
      {result.data?.items.length === 0 ? (
        <div className="event-empty">
          <TicketIcon size={32} aria-hidden />
          <h2>{t("emptyOrders")}</h2>
          <a className="btn btn-primary" href="/events">
            {t("discover")}
          </a>
        </div>
      ) : null}
      {groups.upcoming.length ? (
        <section className="order-group">
          {groups.past.length ? <h2>{t("upcoming")}</h2> : null}
          <OrderList items={groups.upcoming} />
        </section>
      ) : null}
      {groups.past.length ? (
        <section className="order-group">
          <h2>{t("pastOrders")}</h2>
          <OrderList items={groups.past} />
        </section>
      ) : null}
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
