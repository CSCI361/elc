import { useId } from "react"
import type { OrganizerAnalyticsOverviewResponse } from "@elc/shared"
import { DailyLine } from "./charts"
import { useAnalyticsText } from "./messages"
import { currentMeasures, summaryMeasures } from "./policies"
import { useOverviewText, type OverviewTextKey } from "./overview-messages"
import { overviewMoney } from "./overview-policy"

type Report = OrganizerAnalyticsOverviewResponse
const otherMeasures = [
  "activationFeesMinor",
  "activationRefundsMinor",
  "unfulfilledCompensationMinor",
  "attendeeProcessingChargesMinor",
  "refundedAttendeeChargesMinor",
] as const
const payoutMeasures = [
  "completedCount",
  "completedMinor",
  "adjustmentCount",
  "adjustmentMinor",
  "netMinor",
] as const

export function OverviewValue({
  metric,
  value,
}: {
  metric: string
  value: number
}) {
  const { locale } = useOverviewText()
  return (
    <>
      {metric.endsWith("Minor")
        ? overviewMoney(value, locale)
        : new Intl.NumberFormat(locale).format(value)}
    </>
  )
}
export function OverviewSummary({ data }: { data: Report }) {
  const { t } = useAnalyticsText()
  return (
    <>
      <dl className="analytics-metrics">
        {summaryMeasures.map((metric) => (
          <div
            key={metric}
            className={
              metric === "netTicketRevenueMinor" ||
              metric === "estimatedPayoutMinor"
                ? "analytics-key-metric"
                : undefined
            }
          >
            <dt>{t(metric)}</dt>
            <dd data-overview-metric={metric}>
              <OverviewValue metric={metric} value={data.summary[metric]} />
            </dd>
          </div>
        ))}
      </dl>
      <p className="field-hint">{t("basis")}</p>
      <p className="field-hint">{t("feeHint")}</p>
    </>
  )
}
export function OverviewCurrent({ data }: { data: Report }) {
  const { t, locale } = useAnalyticsText(),
    { t: text } = useOverviewText(),
    id = useId(),
    current = data.current
  const percent = (value: number) =>
    new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(value / 100)
  return (
    <section aria-labelledby={id}>
      <h2 id={id}>{text("current")}</h2>
      <p>{text("currentHint")}</p>
      <p className="field-hint">
        <time dateTime={current.asOf}>
          {new Intl.DateTimeFormat(locale, {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Asia/Almaty",
          }).format(new Date(current.asOf))}
        </time>{" "}
        · Asia/Almaty
      </p>
      <div className="analytics-two-columns">
        <section className="event-panel">
          <h3>{t("capacityTitle")}</h3>
          <p className="analytics-progress-label">
            {t("soldPercent")} <strong>{percent(current.soldPercent)}</strong>
          </p>
          <progress
            max={100}
            value={Math.min(100, current.soldPercent)}
            aria-label={t("soldPercent")}
            aria-valuetext={percent(current.soldPercent)}
          />
          {!current.capacity ? <p>{t("zeroCapacity")}</p> : null}
          <dl className="analytics-counts">
            {currentMeasures.slice(0, 8).map((metric) => (
              <div key={metric}>
                <dt>{t(metric)}</dt>
                <dd data-overview-current={metric}>
                  <OverviewValue metric={metric} value={current[metric]} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="event-panel">
          <h3>{t("attendanceTitle")}</h3>
          <p className="analytics-progress-label">
            {t("attendancePercent")}{" "}
            <strong>{percent(current.attendancePercent)}</strong>
          </p>
          <progress
            max={100}
            value={current.attendancePercent}
            aria-label={t("attendancePercent")}
            aria-valuetext={percent(current.attendancePercent)}
          />
          {!current.eligibleAttendance ? <p>{t("noEligible")}</p> : null}
          <dl className="analytics-counts">
            {currentMeasures.slice(8).map((metric) => (
              <div key={metric}>
                <dt>{t(metric)}</dt>
                <dd data-overview-current={metric}>
                  <OverviewValue metric={metric} value={current[metric]} />
                </dd>
              </div>
            ))}
          </dl>
          <p className="field-hint">{t("attendanceHint")}</p>
          <h4>{t("offline")}</h4>
          <dl className="analytics-counts">
            <div>
              <dt>{t("unresolvedOfflineReports")}</dt>
              <dd>
                <OverviewValue
                  metric="unresolvedOfflineReports"
                  value={current.unresolvedOfflineReports}
                />
              </dd>
            </div>
            <div>
              <dt>{t("unsynchronized")}</dt>
              <dd>{t("unknown")}</dd>
            </div>
          </dl>
          <p className="field-hint">{t("offlineHint")}</p>
        </section>
      </div>
    </section>
  )
}
export function OverviewPayments({ data }: { data: Report }) {
  const { t } = useAnalyticsText(),
    { t: text } = useOverviewText()
  return (
    <div className="analytics-two-columns">
      <section className="event-panel">
        <h2>{t("otherPayments")}</h2>
        <p className="field-hint">{text("otherHint")}</p>
        <dl className="analytics-counts">
          {otherMeasures.map((metric) => (
            <div key={metric}>
              <dt>{t(metric)}</dt>
              <dd data-overview-other={metric}>
                <OverviewValue
                  metric={metric}
                  value={data.otherPayments[metric]}
                />
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="event-panel">
        <h2>{text("payouts")}</h2>
        <p className="field-hint">{text("payoutHint")}</p>
        <dl className="analytics-counts">
          {payoutMeasures.map((metric) => (
            <div key={metric}>
              <dt>{text(metric)}</dt>
              <dd data-overview-payout={metric}>
                <OverviewValue metric={metric} value={data.payouts[metric]} />
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}

export function OverviewDaily({ data }: { data: Report }) {
  const { t } = useAnalyticsText(),
    id = useId()
  const rows = data.daily.map((row) => ({ date: row.date, ...row.summary }))
  return (
    <section className="event-panel" aria-label={t("dailyTable")}>
      <div className="analytics-two-columns">
        <DailyLine rows={rows} metric="grossMinor" />
        <DailyLine rows={rows} metric="netTicketRevenueMinor" />
      </div>
      <details className="analytics-table-details">
        <summary>{t("dailyTable")}</summary>
        <p id={id} className="field-hint">
          {t("horizontal")}
        </p>
        <div
          className="analytics-table-region"
          role="region"
          tabIndex={0}
          aria-label={t("dailyTable")}
          aria-describedby={id}
        >
          <table>
            <caption className="sr-only">
              {t("dailyTable")} · Asia/Almaty
            </caption>
            <thead>
              <tr>
                <th scope="col">{t("date")}</th>
                {summaryMeasures.map((metric) => (
                  <th scope="col" key={metric}>
                    {t(metric)}
                    {metric.endsWith("Minor") ? " · KZT" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date}>
                  <th scope="row">
                    <time dateTime={row.date}>{row.date}</time>
                  </th>
                  {summaryMeasures.map((metric) => (
                    <td key={metric}>
                      <OverviewValue metric={metric} value={row[metric]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

export function OverviewEvents({ data }: { data: Report }) {
  const { t } = useAnalyticsText(),
    { t: text } = useOverviewText(),
    id = useId()
  const recorded = [
    "completedMinor",
    "adjustmentMinor",
    "netMinor",
  ] as const satisfies readonly OverviewTextKey[]
  return (
    <>
      <p>{text("byEventHint")}</p>
      <p className="field-hint">{text("scopeHint")}</p>
      {data.events.length ? (
        <>
          <p id={id} className="field-hint">
            {t("horizontal")}
          </p>
          <div
            className="analytics-table-region overview-events-table"
            role="region"
            tabIndex={0}
            aria-label={text("byEvent")}
            aria-describedby={id}
          >
            <table>
              <caption className="sr-only">
                {text("byEvent")} · Asia/Almaty
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t("selectEvent")}</th>
                  {summaryMeasures.map((metric) => (
                    <th scope="col" key={metric}>
                      {t(metric)}
                      {metric.endsWith("Minor") ? " · KZT" : ""}
                    </th>
                  ))}
                  {recorded.map((metric) => (
                    <th scope="col" key={metric}>
                      {text(metric)} · KZT
                    </th>
                  ))}
                  <th scope="col">{t("capacity")}</th>
                  <th scope="col">{t("confirmedAttendance")}</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((event) => (
                  <tr key={event.id} data-overview-event={event.id}>
                    <th scope="row">
                      <a
                        href={`/events/${encodeURIComponent(event.id)}/analytics`}
                      >
                        {event.title}
                      </a>
                      <small>{event.timeZone}</small>
                    </th>
                    {summaryMeasures.map((metric) => (
                      <td key={metric}>
                        <OverviewValue
                          metric={metric}
                          value={event.summary[metric]}
                        />
                      </td>
                    ))}
                    {recorded.map((metric) => (
                      <td key={metric}>
                        <OverviewValue
                          metric={metric}
                          value={event.payouts[metric]}
                        />
                      </td>
                    ))}
                    <td>
                      <OverviewValue
                        metric="capacity"
                        value={event.current.capacity}
                      />
                    </td>
                    <td>
                      <OverviewValue
                        metric="confirmedAttendance"
                        value={event.current.confirmedAttendance}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p>{t("noReports")}</p>
      )}
    </>
  )
}
