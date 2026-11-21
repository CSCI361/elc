import {
  eventPayoutsResponseSchema,
  type EventPayoutsResponse,
} from "@elc/shared"
import { useEffect, useRef, useState } from "react"
import { AuthNotice } from "@/auth/notice"
import { useAccount } from "@/auth/context"
import { EventApiError, useResource } from "@/events/api"
import { useEventText } from "@/events/messages"
import { money } from "@/events/policies"
import { EventError, Protected, SectionLoading } from "@/events/ui"
import { usePayoutText } from "./messages"
import { payoutCursor, payoutPath, summaryMeasures } from "./policies"
import "./payouts.css"

type Payout = EventPayoutsResponse["payouts"][number]
function PayoutRecord({
  payout,
  timeZone,
}: {
  payout: Payout
  timeZone: string
}) {
  const { locale, t } = usePayoutText()
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "long",
    timeZone,
  })
  return (
    <article className="event-panel payout-record">
      <h3>
        {t("recordedAt")}:{" "}
        <time dateTime={payout.completedAt}>
          {date.format(new Date(payout.completedAt))}
        </time>
      </h3>
      <p className="payout-reference">
        {t("reference")}: {payout.id}
      </p>
      <dl className="order-totals">
        <div>
          <dt>{t("amount")}</dt>
          <dd>{money(payout.amountMinor, locale)}</dd>
        </div>
        <div>
          <dt>{t("orderCount")}</dt>
          <dd>{new Intl.NumberFormat(locale).format(payout.orderCount)}</dd>
        </div>
      </dl>
      <details>
        <summary>{t("breakdown")}</summary>
        <p className="field-hint">{t("horizontal")}</p>
        <div
          className="payout-table-region"
          tabIndex={0}
          role="region"
          aria-label={t("breakdown")}
        >
          <table className="payout-items">
            <caption className="sr-only">
              {t("breakdown")} · {date.format(new Date(payout.completedAt))}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t("orderReference")}</th>
                <th scope="col">{t("paidMinor")}</th>
                <th scope="col">{t("processingFeeMinor")}</th>
                <th scope="col">{t("contributionMinor")}</th>
                <th scope="col">{t("adjustment")}</th>
                <th scope="col">{t("adjustmentDate")}</th>
              </tr>
            </thead>
            <tbody>
              {payout.items.map((item) => (
                <tr key={item.orderId}>
                  <th scope="row">{item.orderId}</th>
                  <td>{money(item.paidMinor, locale)}</td>
                  <td>{money(item.processingFeeMinor, locale)}</td>
                  <td>{money(item.contributionMinor, locale)}</td>
                  <td>
                    {item.adjustment
                      ? money(item.adjustment.amountMinor, locale)
                      : t("none")}
                  </td>
                  <td>
                    {item.adjustment ? (
                      <time dateTime={item.adjustment.createdAt}>
                        {date.format(new Date(item.adjustment.createdAt))}
                      </time>
                    ) : (
                      t("none")
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  )
}
function CurrentPayoutPage({ eventId }: { eventId: string }) {
  const { locale, t } = usePayoutText(),
    { t: eventText } = useEventText()
  const [before, setBefore] = useState(() =>
    payoutCursor(window.location.search)
  )
  const resource = useResource(
    payoutPath(eventId, before),
    eventPayoutsResponseSchema,
    15000
  )
  const historyHeading = useRef<HTMLHeadingElement>(null)
  const focusHistory = useRef(false)
  useEffect(() => {
    if (resource.data && !resource.error && focusHistory.current) {
      focusHistory.current = false
      historyHeading.current?.focus()
    }
  }, [resource.data, resource.error])
  const changePage = (cursor: string) => {
    focusHistory.current = true
    setBefore(cursor)
  }
  const reload = () => {
    setBefore("")
    resource.reload()
  }
  if (resource.error)
    return (
      <div className="events-page">
        <h1>{t("title")}</h1>
        {resource.error instanceof EventApiError &&
        [401, 403, 404].includes(resource.error.status) ? (
          <AuthNotice>
            {t("denied")}{" "}
            <button type="button" className="text-action" onClick={reload}>
              {eventText("reload")}
            </button>
          </AuthNotice>
        ) : (
          <EventError error={resource.error} retry={reload} />
        )}
      </div>
    )
  if (!resource.data)
    return (
      <div className="events-page payout-page">
        <div className="event-page-heading">
          <div>
            <h1>{t("title")}</h1>
          </div>
        </div>
        <SectionLoading rows={3} />
      </div>
    )
  const data = resource.data
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeStyle: "long",
    timeZone: data.timeZone,
  })
  return (
    <div className="events-page payout-page">
      <div className="event-page-heading">
        <div>
          <h1>{t("title")}</h1>
        </div>
        <button type="button" className="text-action" onClick={resource.reload}>
          {eventText("reload")}
        </button>
      </div>
      <div className="payout-layout">
        <section className="event-panel">
          <div
            className="payout-table-region"
            tabIndex={0}
            role="region"
            aria-label={t("summary")}
          >
            <table className="payout-summary">
              <caption>{t("summary")}</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">{t("metric")}</th>
                  <th scope="col">{t("amount")}</th>
                </tr>
              </thead>
              <tbody>
                {summaryMeasures.map((measure) => (
                  <tr key={measure}>
                    <th scope="row">{t(measure)}</th>
                    <td>{money(data.summary[measure], locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <aside className="event-panel payout-info">
          <h2>{t("eligibility")}</h2>
          <p>
            <time dateTime={data.eligibleAt}>
              {date.format(new Date(data.eligibleAt))}
            </time>
          </p>
          <p>{data.timeZone}</p>
          <p>{t("eligibilityHint")}</p>
          <p>{t("holdsHint")}</p>
        </aside>
      </div>
      <section className="payout-history">
        <h2 ref={historyHeading} tabIndex={-1}>
          {t("records")}
        </h2>
        <p>{t("recordsHint")}</p>
        {!data.payouts.length ? (
          <p className="event-panel">{t("empty")}</p>
        ) : (
          <div className="payout-records">
            {data.payouts.map((payout) => (
              <PayoutRecord
                key={payout.id}
                payout={payout}
                timeZone={data.timeZone}
              />
            ))}
          </div>
        )}
      </section>
      <div className="event-pagination">
        {before ? (
          <button
            type="button"
            className="text-action"
            onClick={() => changePage("")}
          >
            {eventText("firstPage")}
          </button>
        ) : null}
        {data.nextCursor ? (
          <button
            type="button"
            className="text-action"
            onClick={() => changePage(data.nextCursor!)}
          >
            {eventText("more")}
          </button>
        ) : null}
      </div>
    </div>
  )
}
export function PayoutPage({ eventId }: { eventId: string }) {
  const { account } = useAccount()
  return (
    <Protected>
      <CurrentPayoutPage
        key={`${eventId}:${account?.user.id}`}
        eventId={eventId}
      />
    </Protected>
  )
}
