import {
  eventHistoryResponseSchema,
  historyActivityTypeSchema,
} from "@elc/shared"
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { segment, useResource } from "@/events/api"
import { useEventText } from "@/events/messages"
import { Field, SectionLoading, SelectField } from "@/events/ui"
import { useHistoryText } from "./messages"
import { eventHistoryHref, historyFilters, pageHref } from "./policies"
import { FiltersInvalid, HistoryFailure, HistoryHeading, Retention } from "./ui"
function TimelineFilters({ eventId }: { eventId: string }) {
  const { t } = useHistoryText(),
    params = new URLSearchParams(window.location.search)
  const [range, setRange] = useState(params.get("range") ?? "30")
  return (
    <form
      className="history-filters"
      action={eventHistoryHref(eventId)}
      method="get"
    >
      <SelectField
        name="range"
        aria-label={t("range")}
        label={t("range")}
        value={range}
        onValueChange={(value) => setRange(value)}
      >
        <option value="30">{t("thirty")}</option>
        <option value="7">{t("seven")}</option>
        <option value="custom">{t("custom")}</option>
      </SelectField>
      <SelectField
        name="activityType"
        aria-label={t("activityType")}
        label={t("activityType")}
        defaultValue={params.get("activityType") ?? ""}
      >
        <option value="">{t("all")}</option>
        {historyActivityTypeSchema.options.map((type) => (
          <option value={type} key={type}>
            {t(type === "activation" ? "activationType" : type)}
          </option>
        ))}
      </SelectField>
      {range === "custom" ? (
        <>
          <Field
            name="start"
            type="date"
            label={t("start")}
            defaultValue={params.get("start") ?? ""}
            required
          />
          <Field
            name="end"
            type="date"
            label={t("end")}
            defaultValue={params.get("end") ?? ""}
            required
          />
        </>
      ) : null}
      <div className="history-filter-actions">
        <Button type="submit">{t("apply")}</Button>
        <a className="text-action" href={eventHistoryHref(eventId)}>
          {t("reset")}
        </a>
      </div>
    </form>
  )
}
function CurrentTimeline({
  eventId,
  query,
}: {
  eventId: string
  query: string
}) {
  const { t, locale } = useHistoryText(),
    { t: et } = useEventText()
  const resource = useResource(
    `/events/${segment(eventId)}/history?${query}`,
    eventHistoryResponseSchema,
    15000
  )
  if (resource.error)
    return (
      <>
        <HistoryHeading>{t("timeline")}</HistoryHeading>
        <HistoryFailure error={resource.error} retry={resource.reload} />
      </>
    )
  if (!resource.data)
    return (
      <>
        <HistoryHeading>{t("timeline")}</HistoryHeading>
        <SectionLoading rows={5} />
      </>
    )
  const data = resource.data,
    date = new Intl.DateTimeFormat(locale, {
      timeZone: data.timeZone,
      dateStyle: "long",
      timeStyle: "medium",
    })
  return (
    <>
      <HistoryHeading>{t("timeline")}</HistoryHeading>
      <p>{t("periodHint")}</p>
      <p className="history-period">
        {data.period.start} – {data.period.end} · {data.timeZone}
      </p>
      <section className="event-panel">
        <Retention value={data.retention} timeZone={data.timeZone} />
        <p className="field-hint">{t("retentionHint")}</p>
      </section>
      <TimelineFilters eventId={eventId} />
      {data.items.length ? (
        <ol className="history-timeline">
          {data.items.map((item) => (
            <li key={item.id} className="event-panel history-entry">
              <time dateTime={item.createdAt}>
                {date.format(new Date(item.createdAt))}
              </time>
              <h3>
                {t(
                  item.activityType === "activation"
                    ? "activationType"
                    : item.activityType
                )}
              </h3>
              <p>
                {item.actorType === "system"
                  ? t("system")
                  : (item.actorName ?? t("unknown"))}
              </p>
              <p className="history-description">{item.description}</p>
              <details>
                <summary>{t("original")}</summary>
                <dl className="history-identifiers">
                  <dt>{t("activityType")}</dt>
                  <dd>{item.action}</dd>
                  <dt>{t("reference")}</dt>
                  <dd>{item.entityId}</dd>
                  <dt>{et("reference")}</dt>
                  <dd>{item.correlationId}</dd>
                </dl>
              </details>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          icon={ClockCounterClockwiseIcon}
          title={t("emptyTimeline")}
          hint={t("emptyTimelineHint")}
        />
      )}
      <nav className="event-pagination" aria-label={t("timeline")}>
        {new URLSearchParams(query).has("cursor") ? (
          <a
            className="text-action"
            href={pageHref(eventHistoryHref(eventId), query)}
          >
            {et("firstPage")}
          </a>
        ) : null}
        {data.nextCursor ? (
          <a
            className="text-action"
            href={pageHref(eventHistoryHref(eventId), query, data.nextCursor)}
          >
            {et("more")}
          </a>
        ) : null}
      </nav>
    </>
  )
}
export function HistoryTimelinePage({ eventId }: { eventId: string }) {
  const { t } = useHistoryText(),
    parsed = historyFilters(window.location.search, true)
  const query = parsed.success
    ? new URLSearchParams(
        Object.entries(parsed.data).flatMap(([key, value]) =>
          value === undefined ? [] : [[key, String(value)]]
        )
      ).toString()
    : ""
  return (
    <div className="events-page history-page">
      {parsed.success ? (
        <CurrentTimeline
          key={`${eventId}:${query}`}
          eventId={eventId}
          query={query}
        />
      ) : (
        <>
          <HistoryHeading>{t("timeline")}</HistoryHeading>
          <FiltersInvalid resetHref={eventHistoryHref(eventId)} />
        </>
      )}
    </div>
  )
}
