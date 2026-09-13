import {
  analyticsEventsResponseSchema,
  eventAnalyticsResponseSchema,
  type EventAnalyticsQuery,
  type EventAnalyticsResponse,
} from "@elc/shared"
import { useEffect, useState, type FormEvent } from "react"
import { Button } from "../components/ui/button"
import { EventApiError, useResource } from "../events/api"
import { EventError, Field, SelectField } from "../events/ui"
import { analyticsPath, applyAnalyticsFilters } from "./policies"
import { useAnalyticsText } from "./messages"

export function EventChoices({
  eventId,
  title,
  onDenied,
}: {
  eventId: string
  title?: string
  onDenied: (error: unknown) => void
}) {
  const { t } = useAnalyticsText(),
    [after, setAfter] = useState("")
  const choices = useResource(
    `/organizer/analytics/events?limit=50${after ? `&after=${encodeURIComponent(after)}` : ""}`,
    analyticsEventsResponseSchema
  )
  useEffect(() => {
    if (
      choices.error instanceof EventApiError &&
      [401, 403].includes(choices.error.status)
    )
      onDenied(choices.error)
  }, [choices.error, onDenied])
  return (
    <section
      className="analytics-event-select"
      aria-label={t("availableEvents")}
    >
      {choices.error ? (
        <EventError error={choices.error} retry={choices.reload} />
      ) : null}
      <SelectField
        label={t("selectEvent")}
        value={eventId}
        onChange={(event) =>
          window.location.assign(
            `/events/${encodeURIComponent(event.target.value)}/analytics`
          )
        }
      >
        {!choices.data?.items.some((item) => item.id === eventId) ? (
          <option value={eventId}>{title ?? t("title")}</option>
        ) : null}
        {choices.data?.items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.title}
          </option>
        ))}
      </SelectField>
      <div className="analytics-actions">
        {after ? (
          <button
            type="button"
            className="text-action"
            onClick={() => setAfter("")}
          >
            {t("firstEvents")}
          </button>
        ) : null}
        {choices.data?.nextCursor ? (
          <button
            type="button"
            className="text-action"
            onClick={() => setAfter(choices.data!.nextCursor!)}
          >
            {t("moreEvents")}
          </button>
        ) : null}
      </div>
    </section>
  )
}

export function AnalyticsFilters({
  eventId,
  query,
  data,
  apply,
  onDenied,
}: {
  eventId: string
  query: EventAnalyticsQuery
  data?: EventAnalyticsResponse
  apply: (query: EventAnalyticsQuery) => void
  onDenied: (error: unknown) => void
}) {
  const { t } = useAnalyticsText()
  const [range, setRange] = useState(query.range),
    [start, setStart] = useState(query.start ?? data?.period.start ?? ""),
    [end, setEnd] = useState(query.end ?? data?.period.end ?? ""),
    [type, setType] = useState(query.ticketTypeId ?? ""),
    [invalid, setInvalid] = useState(false),
    [after, setAfter] = useState("")
  // The report endpoint also supplies an access-checked, paged ticket-type catalog.
  const types = useResource(
    analyticsPath(eventId, {
      range: "7",
      limit: 50,
      ...(after ? { typeAfter: after } : {}),
    }),
    eventAnalyticsResponseSchema
  )
  useEffect(() => {
    if (
      types.error instanceof EventApiError &&
      [401, 403, 404].includes(types.error.status)
    )
      onDenied(types.error)
  }, [types.error, onDenied])
  const selectedName =
    types.data?.ticketTypes.find((item) => item.id === type)?.name ??
    data?.ticketTypes.find((item) => item.id === type)?.name ??
    t("ticketType")
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const next = applyAnalyticsFilters({
        range,
        ...(range === "custom" ? { start, end } : {}),
        ...(type ? { ticketTypeId: type } : {}),
        limit: 20,
      })
      setInvalid(false)
      apply(next)
    } catch {
      setInvalid(true)
    }
  }
  return (
    <form className="event-panel analytics-filters" onSubmit={submit}>
      <SelectField
        label={t("range")}
        value={range}
        onChange={(event) => {
          setRange(event.target.value as EventAnalyticsQuery["range"])
          if (event.target.value === "custom") {
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
      <div>
        <SelectField
          label={t("ticketType")}
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          <option value="">{t("allTypes")}</option>
          {type && !types.data?.ticketTypes.some((item) => item.id === type) ? (
            <option value={type}>{selectedName}</option>
          ) : null}
          {types.data?.ticketTypes.map((item) => (
            <option value={item.id} key={item.id}>
              {item.name}
            </option>
          ))}
        </SelectField>
        {types.error ? (
          <EventError error={types.error} retry={types.reload} />
        ) : null}
        <div className="analytics-actions">
          {after ? (
            <button
              type="button"
              className="text-action"
              onClick={() => setAfter("")}
            >
              {t("firstTypes")}
            </button>
          ) : null}
          {types.data?.nextTypeCursor ? (
            <button
              type="button"
              className="text-action"
              onClick={() => setAfter(types.data!.nextTypeCursor!)}
            >
              {t("moreTypes")}
            </button>
          ) : null}
        </div>
      </div>
      <Button type="submit">{t("apply")}</Button>
      <p className="field-hint analytics-filter-hint">
        {t("calendarHint")}
        {data ? ` ${data.timeZone}.` : ""}
      </p>
      {invalid ? (
        <p role="alert" className="analytics-filter-hint">
          {t("invalidPeriod")}
        </p>
      ) : null}
    </form>
  )
}
