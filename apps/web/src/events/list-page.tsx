import { eventListResponseSchema, type EventApi } from "@elc/shared"
import {
  ArrowRightIcon,
  CalendarBlankIcon,
  MapPinIcon,
  PlusIcon,
  TicketIcon,
} from "@phosphor-icons/react"
import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { segment, useResource } from "./api"
import { useEventText } from "./messages"
import { EventImageCover } from "./image-gallery"
import { dateText } from "./policies"
import { EventError, Field, Loading } from "./ui"
import { useDirectoryAnalytics } from "@/analytics/collection"

export function EventCard({
  event,
  organizer = false,
}: {
  event: EventApi
  organizer?: boolean
}) {
  const { locale, t } = useEventText()
  return (
    <article className="event-card">
      {event.images.length ? (
        <EventImageCover event={event} />
      ) : (
        <div className="event-card-art" aria-hidden>
          <TicketIcon size={72} weight="thin" />
          <span>{event.category}</span>
        </div>
      )}
      <div className="event-card-body">
        <div className="event-badges">
          <span>{t(event.phase)}</span>
          {organizer ? <span>{t(event.publicationState)}</span> : null}
        </div>
        <h2>
          <a
            href={
              organizer
                ? `/organizer/events/${segment(event.id)}`
                : `/events/${segment(event.id)}`
            }
          >
            {event.title}
          </a>
        </h2>
        <p>
          <CalendarBlankIcon aria-hidden size={18} />
          {dateText(event.startsAt, event.timeZone, locale)}
        </p>
        <p>
          <MapPinIcon aria-hidden size={18} />
          {event.venueName}
        </p>
        <a
          className="event-card-link"
          href={
            organizer
              ? `/organizer/events/${segment(event.id)}`
              : `/events/${segment(event.id)}`
          }
        >
          {t(organizer ? "editEvent" : "details")}
          <ArrowRightIcon size={18} aria-hidden />
        </a>
        {organizer ? (
          <a
            className="text-action"
            href={`/organizer/events/${segment(event.id)}/registrations`}
          >
            {t("registrations")}
          </a>
        ) : null}
      </div>
    </article>
  )
}

export function EventListPage({ organizer = false }: { organizer?: boolean }) {
  useDirectoryAnalytics(!organizer)
  const { t } = useEventText()
  const initial = new URLSearchParams(window.location.search)
  const [query, setQuery] = useState(initial.get("q") ?? "")
  const [category, setCategory] = useState(initial.get("category") ?? "")
  const params = new URLSearchParams({ limit: "12" })
  for (const key of ["q", "category", "cursor"]) {
    const value = initial.get(key)
    if (value) params.set(key, value)
  }
  const resource = useResource(
    `${organizer ? "/organizer" : ""}/events?${params}`,
    eventListResponseSchema
  )
  const path = organizer ? "/organizer/events" : "/events"
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = new URLSearchParams()
    if (query.trim()) next.set("q", query.trim())
    if (category.trim()) next.set("category", category.trim())
    window.location.assign(`${path}?${next}`)
  }
  const next = new URLSearchParams(params)
  if (resource.data?.nextCursor) next.set("cursor", resource.data.nextCursor)
  return (
    <div className="events-page">
      <div className={organizer ? "event-page-heading" : "discovery-heading"}>
        <div>
          <span className="eyebrow">
            elc / {t(organizer ? "organize" : "discover")}
          </span>
          <h1>{t(organizer ? "organize" : "discoverTitle")}</h1>
          <p>{t(organizer ? "organizerIntro" : "discoverIntro")}</p>
        </div>
        {organizer ? (
          <a className="primary-link" href="/organizer/events/new">
            <PlusIcon size={20} aria-hidden />
            {t("newEvent")}
          </a>
        ) : null}
      </div>
      <form className="event-search" onSubmit={search}>
        <Field
          label={t("search")}
          name="q"
          placeholder={t("searchHint")}
          maxLength={200}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Field
          label={t("category")}
          name="category"
          maxLength={80}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        />
        <Button type="submit">{t("search")}</Button>
      </form>
      {resource.error ? (
        <EventError error={resource.error} retry={resource.reload} />
      ) : null}
      {resource.loading ? (
        <Loading />
      ) : resource.data?.items.length === 0 ? (
        <div className="event-empty">
          <TicketIcon size={40} aria-hidden />
          <h2>{t("noEvents")}</h2>
          <p>{t("noEventsHint")}</p>
        </div>
      ) : null}
      <div className="event-grid">
        {!resource.error &&
          resource.data?.items.map((event) => (
            <EventCard key={event.id} event={event} organizer={organizer} />
          ))}
      </div>
      <nav className="event-pagination" aria-label={t("more")}>
        {initial.has("cursor") ? (
          <a className="secondary-link" href={path}>
            {t("firstPage")}
          </a>
        ) : null}
        {resource.data?.nextCursor ? (
          <a className="primary-link" href={`${path}?${next}`}>
            {t("more")}
            <ArrowRightIcon size={18} aria-hidden />
          </a>
        ) : null}
      </nav>
    </div>
  )
}
