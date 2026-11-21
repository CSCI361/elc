import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react"
import type {
  OrganizerAnalyticsOverviewQuery,
  OrganizerAnalyticsOverviewResponse,
} from "@elc/shared"
import { Button } from "../components/ui/button"
import { EventApiError } from "../events/api"
import { EventError, Field, SectionLoading, SelectField } from "../events/ui"
import { useAnalyticsText } from "./messages"
import { useOverviewText } from "./overview-messages"
import { OverviewLoader } from "./overview-loader"
import { overviewFilters, overviewPage } from "./overview-policy"
import {
  OverviewCurrent,
  OverviewDaily,
  OverviewEvents,
  OverviewPayments,
  OverviewSummary,
  OverviewValue,
} from "./overview-panels"
import "./overview.css"

function OverviewFilters({
  query,
  data,
  apply,
}: {
  query: OrganizerAnalyticsOverviewQuery
  data?: OrganizerAnalyticsOverviewResponse
  apply: (query: OrganizerAnalyticsOverviewQuery) => void
}) {
  const { t } = useAnalyticsText(),
    { t: text } = useOverviewText()
  const [range, setRange] = useState(query.range),
    [start, setStart] = useState(query.start ?? ""),
    [end, setEnd] = useState(query.end ?? ""),
    [q, setQ] = useState(query.q ?? ""),
    [invalid, setInvalid] = useState(false)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const next = overviewFilters({
        range,
        ...(range === "custom" ? { start, end } : {}),
        q: q.trim(),
        limit: 20,
      })
      setInvalid(false)
      apply(next)
    } catch {
      setInvalid(true)
    }
  }
  return (
    <form
      className="analytics-filters"
      onSubmit={submit}
      aria-label={text("title")}
    >
      <SelectField
        label={t("range")}
        value={range}
        onValueChange={(value) => {
          setRange(value as OrganizerAnalyticsOverviewQuery["range"])
          if (value === "custom") {
            if (!start) setStart(data?.period.start ?? "")
            if (!end) setEnd(data?.period.end ?? "")
          }
        }}
      >
        <option value="30">{t("days30")}</option>
        <option value="7">{t("days7")}</option>
        <option value="custom">{t("custom")}</option>
      </SelectField>
      {range === "custom" ? (
        <>
          <Field
            label={t("start")}
            type="date"
            required
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
          <Field
            label={t("end")}
            type="date"
            required
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </>
      ) : null}
      <Field
        label={t("searchEvents")}
        value={q}
        maxLength={200}
        onChange={(event) => setQ(event.target.value)}
      />
      <Button type="submit">{t("apply")}</Button>
      <p className="field-hint analytics-filter-hint">{text("dates")}</p>
      {invalid ? (
        <p role="alert" className="analytics-filter-hint">
          {t("invalidPeriod")}
        </p>
      ) : null}
    </form>
  )
}

export function OrganizerOverview() {
  const { t, locale } = useAnalyticsText(),
    { t: text } = useOverviewText()
  const [loader] = useState(() => new OverviewLoader()),
    [initial] = useState(() =>
      Object.fromEntries(new URLSearchParams(window.location.search))
    )
  const state = useSyncExternalStore(loader.subscribe, loader.snapshot)
  const periodHeading = useRef<HTMLHeadingElement>(null),
    eventsHeading = useRef<HTMLHeadingElement>(null),
    focus = useRef<"period" | "events" | null>(null)
  useEffect(() => {
    void loader.load(initial)
    const refresh = () => {
      if (!loader.snapshot().loading) void loader.load()
    }
    window.addEventListener("focus", refresh)
    return () => {
      loader.cancel()
      window.removeEventListener("focus", refresh)
    }
  }, [loader, initial])
  useEffect(() => {
    if (state.data && focus.current) {
      ;(focus.current === "events"
        ? eventsHeading
        : periodHeading
      ).current?.focus()
      focus.current = null
    }
  }, [state.data])
  function navigate(
    query: OrganizerAnalyticsOverviewQuery,
    target: "period" | "events" = "period"
  ) {
    focus.current = target
    void loader.load(query)
  }
  const data = state.data,
    filtersKey = JSON.stringify(overviewFilters(state.query))
  return (
    <section
      className="analytics-page organizer-overview"
      aria-labelledby="organizer-overview-title"
    >
      <header className="event-page-heading">
        <div>
          <h1 id="organizer-overview-title">{text("title")}</h1>
          <p>{text("intro")}</p>
        </div>
        <button
          type="button"
          className="text-action"
          onClick={() => navigate(overviewPage(state.query, null))}
        >
          {text("refresh")}
        </button>
      </header>
      <OverviewFilters
        key={filtersKey}
        query={state.query}
        data={data}
        apply={navigate}
      />
      {state.error ? (
        <div>
          {state.error instanceof EventApiError &&
          [400, 409].includes(state.error.status) ? (
            <p role="alert">
              {text(state.error.status === 409 ? "narrow" : "invalid")}
            </p>
          ) : null}
          <EventError
            error={state.error}
            retry={() => navigate(overviewPage(state.query, null))}
          />
        </div>
      ) : null}
      {state.loading ? <SectionLoading /> : null}
      {data ? (
        <>
          <section aria-labelledby="overview-period-title">
            <h2 id="overview-period-title" tabIndex={-1} ref={periodHeading}>
              {t("periodSummary")}
            </h2>
            <p>
              <time dateTime={data.period.start}>{data.period.start}</time> –{" "}
              <time dateTime={data.period.end}>{data.period.end}</time> ·{" "}
              {t("reportingZone")}: Asia/Almaty
            </p>
            <p className="overview-scope">
              {text("scope")}:{" "}
              <strong data-overview-event-count>
                <OverviewValue metric="count" value={data.scope.eventCount} />
              </strong>
              {data.scope.q ? (
                <>
                  {" "}
                  · {t("searchEvents")}: {data.scope.q}
                </>
              ) : null}
            </p>
            <p className="field-hint">{text("scopeHint")}</p>
            <p className="field-hint">
              {t("generatedAt")}:{" "}
              <time dateTime={data.generatedAt}>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Asia/Almaty",
                }).format(new Date(data.generatedAt))}
              </time>{" "}
              · Asia/Almaty
            </p>
            <OverviewSummary data={data} />
          </section>
          <OverviewDaily data={data} />
          <OverviewCurrent data={data} />
          <OverviewPayments data={data} />
          <section aria-labelledby="overview-events-title">
            <h2 id="overview-events-title" tabIndex={-1} ref={eventsHeading}>
              {text("byEvent")}
            </h2>
            <OverviewEvents data={data} />
            <nav className="analytics-actions" aria-label={text("byEvent")}>
              <button
                className="text-action"
                type="button"
                disabled={!state.query.cursor}
                onClick={() =>
                  navigate(overviewPage(state.query, null), "events")
                }
              >
                {t("firstEvents")}
              </button>
              <button
                className="text-action"
                type="button"
                disabled={!data.nextCursor}
                onClick={() =>
                  navigate(overviewPage(state.query, data.nextCursor), "events")
                }
              >
                {t("moreEvents")}
              </button>
            </nav>
          </section>
        </>
      ) : null}
    </section>
  )
}
