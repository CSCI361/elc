import { organizerHistoryResponseSchema } from "@elc/shared"
import { Button } from "@/components/ui/button"
import { segment, useResource } from "@/events/api"
import { useEventText } from "@/events/messages"
import { Field, SectionLoading, SelectField } from "@/events/ui"
import { useHistoryText } from "./messages"
import {
  duplicateHref,
  eventHistoryHref,
  historyFilters,
  pageHref,
} from "./policies"
import { FiltersInvalid, HistoryFailure, HistoryHeading, Retention } from "./ui"
function CurrentList({ query }: { query: string }) {
  const { t, locale } = useHistoryText(),
    { t: et } = useEventText()
  const resource = useResource(
    `/organizer/history?${query}`,
    organizerHistoryResponseSchema,
    15000
  )
  if (resource.error)
    return <HistoryFailure error={resource.error} retry={resource.reload} />
  if (!resource.data) return <SectionLoading />
  const data = resource.data,
    params = new URLSearchParams(query)
  const date = new Intl.DateTimeFormat(locale, {
    timeZone: data.timeZone,
    dateStyle: "long",
    timeStyle: "short",
  })
  return (
    <>
      <div className="history-events">
        {data.items.map(({ event, retention, canDuplicate }) => (
          <article className="event-panel history-event" key={event.id}>
            <div className="event-badges">
              <span>
                {t(event.phase === "cancelled" ? "cancelled" : "completed")}
              </span>
              <span>{event.category}</span>
            </div>
            <h2>
              <a href={eventHistoryHref(event.id)}>{event.title}</a>
            </h2>
            <p>
              <time dateTime={event.startsAt}>
                {date.format(new Date(event.startsAt))}
              </time>{" "}
              · {data.timeZone}
            </p>
            <p>{event.venueName}</p>
            <Retention value={retention} timeZone={data.timeZone} />
            <div className="history-links">
              <a
                className="text-action"
                href={`/organizer/events/${segment(event.id)}/registrations`}
              >
                {et("registrations")}
              </a>
              <a className="text-action" href={eventHistoryHref(event.id)}>
                {t("timeline")}
              </a>
              {canDuplicate ? (
                <a className="text-action" href={duplicateHref(event.id)}>
                  {t("duplicate")}
                </a>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {data.items.length === 0 ? (
        <p className="event-panel" role="status">
          {t("empty")}
        </p>
      ) : null}
      <nav className="event-pagination" aria-label={t("title")}>
        {params.has("cursor") ? (
          <a
            className="text-action"
            href={pageHref("/organizer/history", query)}
          >
            {et("firstPage")}
          </a>
        ) : null}
        {data.nextCursor ? (
          <a
            className="text-action"
            href={pageHref("/organizer/history", query, data.nextCursor)}
          >
            {et("more")}
          </a>
        ) : null}
      </nav>
    </>
  )
}
export function HistoryListPage() {
  const { t } = useHistoryText(),
    { t: et } = useEventText()
  const params = new URLSearchParams(window.location.search),
    parsed = historyFilters(window.location.search, false)
  const query = parsed.success
    ? new URLSearchParams(
        Object.entries(parsed.data).flatMap(([key, value]) =>
          value === undefined ? [] : [[key, String(value)]]
        )
      ).toString()
    : ""
  return (
    <div className="events-page history-page">
      <a className="back-link" href="/organizer/events">
        {et("organize")}
      </a>
      <HistoryHeading>{t("title")}</HistoryHeading>
      <p>{t("overviewHint")}</p>
      <form
        method="get"
        action="/organizer/history"
        className="history-filters"
      >
        <Field
          name="q"
          label={t("search")}
          defaultValue={params.get("q") ?? ""}
          maxLength={200}
        />
        <SelectField
          name="phase"
          aria-label={t("phase")}
          label={t("phase")}
          defaultValue={params.get("phase") ?? ""}
        >
          <option value="">{t("all")}</option>
          <option value="completed">{t("completed")}</option>
          <option value="cancelled">{t("cancelled")}</option>
        </SelectField>
        <Field
          name="start"
          type="date"
          label={t("start")}
          defaultValue={params.get("start") ?? ""}
        />
        <Field
          name="end"
          type="date"
          label={t("end")}
          defaultValue={params.get("end") ?? ""}
        />
        <div className="history-filter-actions">
          <Button type="submit">{t("apply")}</Button>
          <a className="text-action" href="/organizer/history">
            {t("reset")}
          </a>
        </div>
        <p className="field-hint history-wide">{t("listDateHint")}</p>
      </form>
      {parsed.success ? (
        <CurrentList key={query} query={query} />
      ) : (
        <FiltersInvalid resetHref="/organizer/history" />
      )}
    </div>
  )
}
