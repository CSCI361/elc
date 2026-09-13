import { useEffect, useRef, useState, type FormEvent } from "react"
import { analyticsEventsResponseSchema } from "@elc/shared"
import { useAccount } from "../auth/context"
import { Button } from "../components/ui/button"
import { useResource } from "../events/api"
import { EventError, Field, Loading, Protected } from "../events/ui"
import { useAnalyticsText } from "./messages"
import "./analytics.css"

function AvailableReports() {
  const { t, locale } = useAnalyticsText()
  const [draft, setDraft] = useState("")
  const [query, setQuery] = useState({ search: "", after: "" })
  const heading = useRef<HTMLHeadingElement>(null)
  const requestedFocus = useRef(false)
  const params = new URLSearchParams({ limit: "20" })
  if (query.search) params.set("q", query.search)
  if (query.after) params.set("after", query.after)
  const result = useResource(
    `/organizer/analytics/events?${params}`,
    analyticsEventsResponseSchema
  )
  useEffect(() => {
    if (result.data && !result.error && requestedFocus.current) {
      requestedFocus.current = false
      heading.current?.focus()
    }
  }, [result.data, result.error])
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    requestedFocus.current = true
    setQuery({ search: draft.trim(), after: "" })
  }
  function page(after: string) {
    requestedFocus.current = true
    setQuery({ ...query, after })
  }
  return (
    <div className="events-page analytics-page">
      <header>
        <h1 tabIndex={-1} ref={heading}>
          {t("availableEvents")}
        </h1>
        <p>{t("reportsIntro")}</p>
      </header>
      <form className="event-panel analytics-filters" onSubmit={search}>
        <Field
          label={t("searchEvents")}
          value={draft}
          maxLength={200}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit">{t("search")}</Button>
      </form>
      {result.error ? (
        <EventError error={result.error} retry={result.reload} />
      ) : result.loading ? (
        <Loading />
      ) : result.data ? (
        <>
          {result.data.items.length ? (
            <ul className="analytics-report-list">
              {result.data.items.map((event) => (
                <li className="event-panel" key={event.id}>
                  <h2>
                    <a
                      href={`/events/${encodeURIComponent(event.id)}/analytics`}
                    >
                      {event.title}
                    </a>
                  </h2>
                  <p>
                    <time dateTime={event.startsAt}>
                      {new Intl.DateTimeFormat(locale, {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: event.timeZone,
                      }).format(new Date(event.startsAt))}
                    </time>{" "}
                    · {event.timeZone}
                  </p>
                  <a
                    className="text-action"
                    href={`/events/${encodeURIComponent(event.id)}/analytics`}
                    aria-label={`${t("openReport")}: ${event.title}`}
                  >
                    {t("openReport")}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t("noReports")}</p>
          )}
          <div className="analytics-actions">
            <button
              className="text-action"
              type="button"
              disabled={!query.after}
              onClick={() => page("")}
            >
              {t("first")}
            </button>
            <button
              className="text-action"
              type="button"
              disabled={!result.data.nextCursor}
              onClick={() => page(result.data!.nextCursor!)}
            >
              {t("next")}
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
export function AnalyticsIndexPage() {
  const { account } = useAccount()
  return (
    <Protected>
      <AvailableReports key={account?.user.id} />
    </Protected>
  )
}
