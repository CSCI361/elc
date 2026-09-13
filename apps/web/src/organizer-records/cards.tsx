import type {
  OrganizerRecordsQuery,
  OrganizerRecordsResponse,
} from "@elc/shared"
import type { ReactNode } from "react"
import { money } from "@/events/policies"
import { recordsDrilldown, recordsHref, recordsLinks } from "./policies"
import { useRecordsText } from "./messages"

type RecordProps = {
  eventId: string
  timeZone: string
  query: OrganizerRecordsQuery
}
type Order = Extract<
  OrganizerRecordsResponse,
  { kind: "orders" }
>["items"][number]
type Ticket = Extract<
  OrganizerRecordsResponse,
  { kind: "tickets" }
>["items"][number]
type Checkin = Extract<
  OrganizerRecordsResponse,
  { kind: "checkins" }
>["items"][number]

export function RecordFact({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
export function RecordTime({
  value,
  timeZone,
}: {
  value: string
  timeZone: string
}) {
  const { locale } = useRecordsText()
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat(locale, {
        timeZone,
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(new Date(value))}
    </time>
  )
}
function Seat({ value }: { value: Ticket["seat"] }) {
  const { t } = useRecordsText()
  return value ? (
    <>
      {value.section} · {value.row} · {value.number}
      {value.accessible ? ` · ${t("accessible")}` : ""}
    </>
  ) : (
    <>{t("generalAdmission")}</>
  )
}

export function OrderRecord({
  item,
  capabilities,
  eventId,
  timeZone,
  query,
}: RecordProps & {
  item: Order
  capabilities: OrganizerRecordsResponse["capabilities"]
}) {
  const { t, locale } = useRecordsText()
  const href = (kind: "orders" | "tickets") =>
    recordsHref(eventId, recordsDrilldown(query, { kind, orderId: item.id }))
  const refundLink = recordsLinks(eventId, capabilities, item.id).find(
    (link) => link.label === "refundAction"
  )
  return (
    <article className="event-panel records-card">
      <h2>
        {t("orderId")} <a href={href("orders")}>{item.id}</a>
      </h2>
      <p className="records-state">{t(item.state)}</p>
      {item.admissionBlocked ? (
        <p className="records-notice">{t("blocked")}</p>
      ) : null}
      <dl className="records-facts">
        <RecordFact label={t("created")}>
          <RecordTime value={item.createdAt} timeZone={timeZone} />
        </RecordFact>
        {item.completedAt ? (
          <RecordFact label={t("completedAt")}>
            <RecordTime value={item.completedAt} timeZone={timeZone} />
          </RecordFact>
        ) : null}
        <RecordFact label={t("quantity")}>
          {item.quantity.toLocaleString(locale)}
        </RecordFact>
        <RecordFact label={t("ticketCount")}>
          {item.ticketCount.toLocaleString(locale)}
        </RecordFact>
        {item.campaignId ? (
          <RecordFact label={t("campaign")}>
            {item.campaignName ? `${item.campaignName} · ` : ""}
            {item.campaignId}
          </RecordFact>
        ) : null}
        <RecordFact label={t("revision")}>{item.revision}</RecordFact>
      </dl>
      <h3>{t("originalAmounts")}</h3>
      <p className="field-hint">{t("amountsHint")}</p>
      <dl className="records-facts">
        <RecordFact label={t("subtotal")}>
          {money(item.subtotalMinor, locale)}
        </RecordFact>
        <RecordFact label={t("discount")}>
          {money(item.discountMinor, locale)}
        </RecordFact>
        <RecordFact label={t("total")}>
          {money(item.totalMinor, locale)}
        </RecordFact>
        <RecordFact label={t("fee")}>
          {money(item.processingFeeMinor, locale)}
        </RecordFact>
        <RecordFact label={t("refund")}>
          {item.refundState ? t(`refund_${item.refundState}`) : t("noRefund")}
        </RecordFact>
        {item.refundAmountMinor !== null ? (
          <RecordFact label={t("refundAmount")}>
            {money(item.refundAmountMinor, locale)}
          </RecordFact>
        ) : null}
      </dl>
      <div className="records-links">
        <a className="text-action" href={href("tickets")}>
          {t("orderTickets")}
        </a>
        {refundLink ? (
          <a className="text-action" href={refundLink.href}>
            {t(refundLink.label)}
          </a>
        ) : null}
      </div>
    </article>
  )
}

export function TicketRecord({
  item,
  eventId,
  timeZone,
  query,
}: RecordProps & { item: Ticket }) {
  const { t } = useRecordsText()
  const href = (kind: "tickets" | "checkins") =>
    recordsHref(eventId, recordsDrilldown(query, { kind, ticketId: item.id }))
  return (
    <article className="event-panel records-card">
      <h2>{item.attendeeName}</h2>
      <p className="records-state">{t(item.state)}</p>
      {item.admissionBlocked ? (
        <p className="records-notice">{t("blocked")}</p>
      ) : null}
      {item.unresolvedOfflineAdmission ? (
        <p className="records-notice">{t("offline")}</p>
      ) : null}
      <dl className="records-facts">
        <RecordFact label={t("ticketId")}>
          <a href={href("tickets")}>{item.id}</a>
        </RecordFact>
        <RecordFact label={t("orderId")}>
          <a
            href={recordsHref(
              eventId,
              recordsDrilldown(query, { kind: "orders", orderId: item.orderId })
            )}
          >
            {item.orderId}
          </a>
        </RecordFact>
        <RecordFact label={t("ticketType")}>{item.ticketTypeName}</RecordFact>
        <RecordFact label={t("seat")}>
          <Seat value={item.seat} />
        </RecordFact>
        <RecordFact label={t("created")}>
          <RecordTime value={item.createdAt} timeZone={timeZone} />
        </RecordFact>
        {item.activeCheckinId ? (
          <RecordFact label={t("activeCheckin")}>
            <a href={href("checkins")}>{item.activeCheckinId}</a>
            {item.activeCheckinAt ? (
              <>
                {" "}
                ·{" "}
                <RecordTime value={item.activeCheckinAt} timeZone={timeZone} />
              </>
            ) : null}
          </RecordFact>
        ) : null}
      </dl>
      <div className="records-links">
        <a className="text-action" href={href("tickets")}>
          {t("ticketDetail")}
        </a>
        <a className="text-action" href={href("checkins")}>
          {t("ticketCheckins")}
        </a>
        <a
          className="text-action"
          href={recordsHref(
            eventId,
            recordsDrilldown(query, { kind: "orders", orderId: item.orderId })
          )}
        >
          {t("orderDetail")}
        </a>
      </div>
    </article>
  )
}

export function CheckinRecord({
  item,
  eventId,
  timeZone,
  query,
}: RecordProps & { item: Checkin }) {
  const { t } = useRecordsText()
  return (
    <article className="event-panel records-card">
      <h2>{item.attendeeName}</h2>
      <p className="records-state">
        {t(item.reversedAt ? "reversed" : "activeCheckin")}
      </p>
      <dl className="records-facts">
        <RecordFact label={t("checkinId")}>{item.id}</RecordFact>
        <RecordFact label={t("ticketId")}>
          <a
            href={recordsHref(
              eventId,
              recordsDrilldown(query, {
                kind: "tickets",
                ticketId: item.ticketId,
              })
            )}
          >
            {item.ticketId}
          </a>
        </RecordFact>
        <RecordFact label={t("orderId")}>
          <a
            href={recordsHref(
              eventId,
              recordsDrilldown(query, { kind: "orders", orderId: item.orderId })
            )}
          >
            {item.orderId}
          </a>
        </RecordFact>
        <RecordFact label={t("seat")}>
          <Seat value={item.seat} />
        </RecordFact>
        <RecordFact label={t("capturedAt")}>
          <RecordTime value={item.capturedAt} timeZone={timeZone} />
        </RecordFact>
        <RecordFact label={t("committedAt")}>
          <RecordTime value={item.committedAt} timeZone={timeZone} />
        </RecordFact>
        {item.reversedAt ? (
          <RecordFact label={t("reversedAt")}>
            <RecordTime value={item.reversedAt} timeZone={timeZone} />
          </RecordFact>
        ) : null}
        {item.reversedBy ? (
          <RecordFact label={t("reversedBy")}>{item.reversedBy}</RecordFact>
        ) : null}
        {item.reversalReason ? (
          <RecordFact label={t("reversalReason")}>
            <span className="preserve-lines">{item.reversalReason}</span>
          </RecordFact>
        ) : null}
      </dl>
      <div className="records-links">
        <a
          className="text-action"
          href={recordsHref(
            eventId,
            recordsDrilldown(query, {
              kind: "tickets",
              ticketId: item.ticketId,
            })
          )}
        >
          {t("ticketDetail")}
        </a>
        <a
          className="text-action"
          href={recordsHref(
            eventId,
            recordsDrilldown(query, { kind: "orders", orderId: item.orderId })
          )}
        >
          {t("orderDetail")}
        </a>
      </div>
    </article>
  )
}
