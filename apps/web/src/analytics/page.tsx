import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { EventAnalyticsQuery, EventAnalyticsResponse } from "@elc/shared"
import { useAccount } from "../auth/context"
import { EventApiError } from "../events/api"
import { EventError, Loading, Protected } from "../events/ui"
import { useEventText } from "../events/messages"
import { AnalyticsLoader } from "./loader"
import {
  analyticsPage,
  analyticsQuery,
  currentMeasures,
  summaryMeasures,
} from "./policies"
import { AnalyticsFilters, EventChoices } from "./filters"
import { DailyLine, HorizontalBars, MetricValue, MetricsTable } from "./charts"
import { useAnalyticsText } from "./messages"
import { TrafficPanel } from "./traffic"
import "./analytics.css"

function CurrentState({ data }: { data: EventAnalyticsResponse }) {
  const { t, locale } = useAnalyticsText(),
    current = data.current
  const percent = (value: number) =>
    new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(value / 100)
  return (
    <section
      className="analytics-current"
      aria-labelledby="analytics-current-title"
    >
      <h2 id="analytics-current-title">{t("current")}</h2>
      <p>{t("currentHint")}</p>
      <p className="field-hint">
        <time dateTime={current.asOf}>
          {new Intl.DateTimeFormat(locale, {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: data.timeZone,
          }).format(new Date(current.asOf))}
        </time>{" "}
        · {data.timeZone}
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
                <dd>
                  <MetricValue metric={metric} value={current[metric]} />
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
                <dd>
                  <MetricValue metric={metric} value={current[metric]} />
                </dd>
              </div>
            ))}
          </dl>
          <p className="field-hint">{t("attendanceHint")}</p>
          <h4>{t("offline")}</h4>
          <dl className="analytics-counts">
            <div>
              <dt>{t("unresolvedOfflineReports")}</dt>
              <dd>{current.unresolvedOfflineReports}</dd>
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
function Breakdown({
  data,
  kind,
  query,
  navigate,
}: {
  data: EventAnalyticsResponse
  kind: "type" | "campaign"
  query: EventAnalyticsQuery
  navigate: (query: EventAnalyticsQuery) => void
}) {
  const { t } = useAnalyticsText(),
    title = kind === "type" ? "byType" : "byCampaign"
  const rows = kind === "type" ? data.ticketTypes : data.campaigns,
    metric = kind === "type" ? "ticketsIssued" : "committedRedemptions"
  const cursor =
      kind === "type" ? data.nextTypeCursor : data.nextCampaignCursor,
    after = kind === "type" ? query.typeAfter : query.campaignAfter
  return (
    <section className="event-panel analytics-breakdown" aria-label={t(title)}>
      <h2>{t(title)}</h2>
      <p className="field-hint">{t(metric)}</p>
      {rows.length ? (
        <>
          <HorizontalBars rows={rows} metric={metric} title={title} />
          <MetricsTable rows={rows} caption="table" />
        </>
      ) : (
        <p>{t("empty")}</p>
      )}
      <p className="field-hint">{t("pageHint")}</p>
      <div className="analytics-actions">
        <button
          type="button"
          className="text-action"
          disabled={!after}
          aria-label={`${t("first")}: ${t(title)}`}
          onClick={() => navigate(analyticsPage(query, kind, null))}
        >
          {t("first")}
        </button>
        <button
          type="button"
          className="text-action"
          disabled={!cursor}
          aria-label={`${t("next")}: ${t(title)}`}
          onClick={() => navigate(analyticsPage(query, kind, cursor))}
        >
          {t("next")}
        </button>
      </div>
    </section>
  )
}
function AnalyticsWorkspace({ eventId }: { eventId: string }) {
  const { t, locale } = useAnalyticsText(),
    { t: eventText } = useEventText()
  const [loader] = useState(
    () => new AnalyticsLoader(eventId, analyticsQuery({}))
  )
  const [initial] = useState(() =>
    Object.fromEntries(new URLSearchParams(window.location.search))
  )
  const state = useSyncExternalStore(loader.subscribe, loader.snapshot)
  const heading = useRef<HTMLHeadingElement>(null),
    focusRequested = useRef(false)
  useEffect(() => {
    void loader.load(initial)
    const refresh = () => {
      if (
        loader.snapshot().data ||
        loader.snapshot().error instanceof EventApiError
      )
        void loader.load()
    }
    window.addEventListener("focus", refresh)
    return () => {
      loader.cancel()
      window.removeEventListener("focus", refresh)
    }
  }, [loader, initial])
  useEffect(() => {
    if (state.data && focusRequested.current) {
      focusRequested.current = false
      heading.current?.focus()
    }
  }, [state.data])
  const navigate = (query: EventAnalyticsQuery) => {
    focusRequested.current = true
    void loader.load(query)
  }
  const data = state.data
  const denied =
    state.error instanceof EventApiError &&
    [401, 403, 404].includes(state.error.status)
  const filtersKey = JSON.stringify({
    range: state.query.range,
    start: state.query.start,
    end: state.query.end,
    ticketTypeId: state.query.ticketTypeId,
  })
  return (
    <div className="events-page analytics-page">
      <a href="/organizer/analytics" className="back-link">
        {t("availableEvents")}
      </a>
      <div className="event-page-heading">
        <div>
          <p className="eyebrow">{t("title")}</p>
          <h1>{data?.eventTitle ?? t("title")}</h1>
        </div>
        <button
          type="button"
          className="text-action"
          onClick={() => navigate(state.query)}
        >
          {eventText("reload")}
        </button>
      </div>
      <p className="analytics-simulation">{t("simulation")}</p>
      {state.error ? (
        <EventError error={state.error} retry={() => navigate(state.query)} />
      ) : null}
      {!denied ? (
        <>
          <EventChoices
            eventId={eventId}
            title={data?.eventTitle}
            onDenied={loader.deny}
          />
          <AnalyticsFilters
            key={filtersKey}
            eventId={eventId}
            query={state.query}
            data={data}
            apply={navigate}
            onDenied={loader.deny}
          />
        </>
      ) : null}
      {state.loading ? <Loading /> : null}
      {data ? (
        <>
          <section aria-labelledby="analytics-period-title">
            <h2 id="analytics-period-title" tabIndex={-1} ref={heading}>
              {t("periodSummary")}
            </h2>
            <p>
              <time dateTime={data.period.start}>{data.period.start}</time> –{" "}
              <time dateTime={data.period.end}>{data.period.end}</time> ·{" "}
              {t("reportingZone")}: {data.timeZone}
            </p>
            <p className="field-hint">
              {t("generatedAt")}:{" "}
              <time dateTime={data.generatedAt}>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: data.timeZone,
                }).format(new Date(data.generatedAt))}
              </time>
            </p>
            <dl className="analytics-metrics">
              {summaryMeasures.map((metric) => (
                <div
                  key={metric}
                  className={
                    metric === "netTicketRevenueMinor" ||
                    metric === "estimatedPayoutMinor"
                      ? "analytics-key-metric"
                      : ""
                  }
                >
                  <dt>{t(metric)}</dt>
                  <dd data-metric={metric}>
                    <MetricValue metric={metric} value={data.summary[metric]} />
                  </dd>
                </div>
              ))}
            </dl>
            <p className="field-hint">{t("basis")}</p>
            <p className="field-hint">{t("feeHint")}</p>
          </section>
          <CurrentState data={data} />
          <TrafficPanel
            key={data.generatedAt}
            data={data}
            query={state.query}
            onDenied={loader.deny}
          />
          <section className="event-panel" aria-label={t("dailyTable")}>
            <div className="analytics-two-columns">
              <DailyLine rows={data.daily} metric="grossMinor" />
              <DailyLine rows={data.daily} metric="netTicketRevenueMinor" />
            </div>
            <MetricsTable rows={data.daily} caption="dailyTable" daily />
          </section>
          <div className="analytics-two-columns">
            <Breakdown
              data={data}
              kind="type"
              query={state.query}
              navigate={navigate}
            />
            <Breakdown
              data={data}
              kind="campaign"
              query={state.query}
              navigate={navigate}
            />
          </div>
          <section className="event-panel">
            <h2>{t("otherPayments")}</h2>
            <p className="field-hint">{t("otherHint")}</p>
            <dl className="analytics-counts">
              {(
                [
                  "activationFeesMinor",
                  "activationRefundsMinor",
                  "unfulfilledCompensationMinor",
                  "attendeeProcessingChargesMinor",
                  "refundedAttendeeChargesMinor",
                ] as const
              ).map((metric) => (
                <div key={metric}>
                  <dt>{t(metric)}</dt>
                  <dd data-other-metric={metric}>
                    <MetricValue
                      metric={metric}
                      value={data.otherPayments[metric]}
                    />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      ) : null}
    </div>
  )
}
export function EventAnalyticsPage({ eventId }: { eventId: string }) {
  const { account } = useAccount()
  return (
    <Protected>
      <AnalyticsWorkspace
        key={`${account?.user.id}:${eventId}`}
        eventId={eventId}
      />
    </Protected>
  )
}
