import { useEffect, useRef, useState, type FormEvent } from "react"
import { ChartBarIcon, MagnifyingGlassIcon } from "@phosphor-icons/react"
import { analyticsEventsResponseSchema } from "@elc/shared"
import { useAccount } from "../auth/context"
import { Button } from "../components/ui/button"
import { EmptyState } from "../components/ui/empty-state"
import { useResource } from "../events/api"
import { EventError, Field, Protected, SectionLoading } from "../events/ui"
import { useAnalyticsText } from "./messages"
import { OrganizerOverview } from "./overview-page"
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
    <section
      className="analytics-page analytics-discovery"
      aria-label={t("availableEvents")}
    >
      <header>
        <h2 tabIndex={-1} ref={heading}>
          {t("availableEvents")}
        </h2>
        <p>{t("reportsIntro")}</p>
      </header>
      <form className="analytics-filters" onSubmit={search}>
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
        <SectionLoading />
      ) : result.data ? (
        <>
          {result.data.items.length ? (
            <ul className="analytics-report-list">
              {result.data.items.map((event) => (
                <li className="event-panel" key={event.id}>
                  <h3>
                    <a
                      href={`/events/${encodeURIComponent(event.id)}/analytics`}
                    >
                      {event.title}
                    </a>
                  </h3>
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
          ) : query.search ? (
            <EmptyState
              icon={MagnifyingGlassIcon}
              title={t("noReports")}
              action={
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    requestedFocus.current = true
                    setDraft("")
                    setQuery({ search: "", after: "" })
                  }}
                >
                  {t("clearSearch")}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={ChartBarIcon}
              title={t("noReportsFirst")}
              inline
            />
          )}
          {query.after || result.data.nextCursor ? (
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
          ) : null}
        </>
      ) : null}
    </section>
  )
}
export function AnalyticsIndexPage() {
  const { account } = useAccount()
  return (
    <Protected>
      <div className="events-page analytics-page" key={account?.user.id}>
        <OrganizerOverview />
        <AvailableReports />
      </div>
    </Protected>
  )
}
