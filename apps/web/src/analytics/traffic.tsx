import { useEffect } from "react"
import {
  trafficResponseSchema,
  type EventAnalyticsQuery,
  type EventAnalyticsResponse,
} from "@elc/shared"
import { EventApiError, useResource } from "../events/api"
import { matchingTraffic, trafficPath } from "./traffic-policy"
import { useTrafficText } from "./traffic-messages"

const fields = [
  "pageViews",
  "eventViews",
  "campaignVisits",
  "checkoutStarts",
] as const

export function TrafficPanel({
  data,
  query,
  onDenied,
}: {
  data: EventAnalyticsResponse
  query: EventAnalyticsQuery
  onDenied: (error: unknown) => void
}) {
  const { t, locale } = useTrafficText()
  const resource = useResource(trafficPath(data, query), trafficResponseSchema)
  const denied =
    resource.error instanceof EventApiError &&
    [401, 403, 404].includes(resource.error.status)
  useEffect(() => {
    if (denied) onDenied(resource.error)
  }, [denied, onDenied, resource.error])
  const response =
    !resource.error && resource.data && matchingTraffic(data, resource.data)
      ? resource.data
      : null
  const report =
    response?.result.status === "available" ? response.result : null
  const count = (value: number) => new Intl.NumberFormat(locale).format(value)
  if (denied) return null
  return (
    <section
      className="event-panel"
      aria-labelledby="traffic-title"
      data-traffic-panel
    >
      <h2 id="traffic-title">{t("title")}</h2>
      <p>{t("hint")}</p>
      <p>
        <time dateTime={data.period.start}>{data.period.start}</time> –{" "}
        <time dateTime={data.period.end}>{data.period.end}</time> · Asia/Almaty
      </p>
      {data.timeZone !== "Asia/Almaty" ? (
        <p className="field-hint">{t("zone")}</p>
      ) : null}
      {data.period.ticketTypeId ? (
        <p className="field-hint">{t("allTypes")}</p>
      ) : null}
      {resource.loading ? <p role="status">{t("loading")}</p> : null}
      {!resource.loading && !report ? (
        <p role="status">
          {response?.result.status === "unavailable" &&
          response.result.reason === "not_configured"
            ? t("missing")
            : t("unavailable")}
        </p>
      ) : null}
      {report ? (
        <>
          <p>
            {t("fetched")}:{" "}
            <time dateTime={report.fetchedAt}>
              {new Intl.DateTimeFormat(locale, {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Asia/Almaty",
              }).format(new Date(report.fetchedAt))}
            </time>{" "}
            · Asia/Almaty
          </p>
          <p className="field-hint">{t("delay")}</p>
          {Object.values(report.quality).some(Boolean) ? (
            <p>{t("quality")}</p>
          ) : null}
          <dl className="analytics-metrics">
            {fields.map((field) => (
              <div key={field}>
                <dt>{t(field)}</dt>
                <dd data-traffic-metric={field}>
                  {count(report.totals[field])}
                </dd>
              </div>
            ))}
            <div>
              <dt>{t("completedOrders")}</dt>
              <dd>{count(data.summary.completedOrders)}</dd>
            </div>
          </dl>
          <div
            className="analytics-table-region"
            tabIndex={0}
            role="region"
            aria-label={t("daily")}
          >
            <table className="analytics-table">
              <caption>{t("daily")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("date")}</th>
                  {fields.map((field) => (
                    <th scope="col" key={field}>
                      {t(field)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.daily.map((row) => (
                  <tr key={row.date}>
                    <th scope="row">{row.date}</th>
                    {fields.map((field) => (
                      <td key={field}>{count(row[field])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.campaigns.length ? (
            <div
              className="analytics-table-region"
              tabIndex={0}
              role="region"
              aria-label={t("campaigns")}
            >
              <table className="analytics-table">
                <caption>{t("campaigns")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("campaign")}</th>
                    {fields.map((field) => (
                      <th scope="col" key={field}>
                        {t(field)}
                      </th>
                    ))}
                    <th scope="col">{t("completedOrders")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.campaigns.map((row) => {
                    const campaign = data.campaigns.find(
                      (item) => item.reportingId === row.campaignReportingId
                    )!
                    return (
                      <tr key={row.campaignReportingId}>
                        <th scope="row">{campaign.name}</th>
                        {fields.map((field) => (
                          <td key={field}>{count(row[field])}</td>
                        ))}
                        <td>{count(campaign.completedOrders)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
      <button
        type="button"
        className="text-action"
        onClick={resource.reload}
        disabled={resource.loading}
      >
        {t("retry")}
      </button>
    </section>
  )
}
