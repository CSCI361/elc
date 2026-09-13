import { useId } from "react"
import type { EventAnalyticsResponse, SalesMetrics } from "@elc/shared"
import { money } from "../events/policies"
import { useAnalyticsText, type AnalyticsTextKey } from "./messages"
import { summaryMeasures } from "./policies"

export function MetricValue({
  metric,
  value,
}: {
  metric: string
  value: number
}) {
  const { locale } = useAnalyticsText()
  return (
    <>
      {metric.endsWith("Minor")
        ? money(value, locale)
        : new Intl.NumberFormat(locale).format(value)}
    </>
  )
}
export function DailyLine({
  rows,
  metric,
}: {
  rows: EventAnalyticsResponse["daily"]
  metric: "grossMinor" | "netTicketRevenueMinor"
}) {
  const { locale, t } = useAnalyticsText(),
    id = useId()
  const values = rows.map((row) => row[metric]),
    min = Math.min(0, ...values),
    max = Math.max(0, ...values),
    span = max - min || 1
  const x = (index: number) => 72 + (index * 552) / Math.max(1, rows.length - 1)
  const y = (value: number) => 158 - ((value - min) * 132) / span
  const label = metric === "grossMinor" ? "dailySales" : "dailyNet"
  const compact = (value: number) =>
    new Intl.NumberFormat(locale, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value / 100)
  return (
    <figure className="analytics-line">
      <figcaption id={id}>{t(label)} · KZT</figcaption>
      <svg
        viewBox="0 0 640 200"
        role="img"
        aria-labelledby={id}
        aria-describedby={`${id}-table`}
      >
        <line x1="72" x2="624" y1={y(0)} y2={y(0)} className="analytics-axis" />
        {[min, max]
          .filter((value, index, array) => array.indexOf(value) === index)
          .map((value) => (
            <g key={value}>
              <line
                x1="72"
                x2="624"
                y1={y(value)}
                y2={y(value)}
                className="analytics-grid-line"
              />
              <text x="62" y={y(value) + 4} textAnchor="end">
                {compact(value)}
              </text>
            </g>
          ))}
        <polyline
          fill="none"
          points={values
            .map((value, index) => `${x(index)},${y(value)}`)
            .join(" ")}
          className={
            metric === "grossMinor"
              ? "analytics-sales-line"
              : "analytics-net-line"
          }
        />
        {rows.length === 1 ? (
          <circle
            cx={x(0)}
            cy={y(values[0]!)}
            r="4"
            className="analytics-point"
          />
        ) : null}
        <text x="72" y="188">
          {rows[0]?.date}
        </text>
        <text x="624" y="188" textAnchor="end">
          {rows.at(-1)?.date}
        </text>
      </svg>
      <p id={`${id}-table`} className="field-hint">
        {t("dailyTable")}
      </p>
    </figure>
  )
}
type NamedMetrics = SalesMetrics & { id: string; name: string }
export function HorizontalBars({
  rows,
  metric,
  title,
}: {
  rows: NamedMetrics[]
  metric: "ticketsIssued" | "committedRedemptions"
  title: AnalyticsTextKey
}) {
  const { t } = useAnalyticsText()
  const maximum = Math.max(1, ...rows.map((row) => row[metric]))
  return (
    <div
      className="analytics-bars"
      role="img"
      aria-label={`${t(title)} · ${t(metric)}`}
    >
      {rows.map((row) => (
        <div className="analytics-bar-row" key={row.id} aria-hidden="true">
          <span title={row.name}>{row.name}</span>
          <span className="analytics-bar-track">
            <span style={{ width: `${(row[metric] * 100) / maximum}%` }} />
          </span>
          <strong>
            <MetricValue metric={metric} value={row[metric]} />
          </strong>
        </div>
      ))}
    </div>
  )
}
export function MetricsTable({
  rows,
  caption,
  daily = false,
}: {
  rows: (SalesMetrics & { id?: string; name?: string; date?: string })[]
  caption: AnalyticsTextKey
  daily?: boolean
}) {
  const { t } = useAnalyticsText(),
    id = useId()
  return (
    <details className="analytics-table-details">
      <summary>{t(caption)}</summary>
      <p id={`${id}-hint`} className="field-hint">
        {t("horizontal")}
      </p>
      <div
        className="analytics-table-region"
        role="region"
        tabIndex={0}
        aria-label={t(caption)}
        aria-describedby={`${id}-hint`}
      >
        <table>
          <caption className="sr-only">{t(caption)}</caption>
          <thead>
            <tr>
              <th scope="col">{t(daily ? "date" : "name")}</th>
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
              <tr key={row.id ?? row.date}>
                <th scope="row">
                  {row.date ? (
                    <time dateTime={row.date}>{row.date}</time>
                  ) : (
                    row.name
                  )}
                </th>
                {summaryMeasures.map((metric) => (
                  <td key={metric}>
                    <MetricValue metric={metric} value={row[metric]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
