import { useAccount } from "@/auth/context"
import { OfflineOperationsLink } from "@/offline-operations/navigation"
import { eventListResponseSchema, type EventApi } from "@elc/shared"
import {
  ArrowRightIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TicketIcon,
  XIcon,
} from "@phosphor-icons/react"
import { useEffect, useEffectEvent, useState, type FormEvent } from "react"
import { Bar, SkeletonRegion } from "@/components/ui/skeleton"
import { ChipRow } from "@/components/ui/chip-row"
import { EmptyState } from "@/components/ui/empty-state"
import { segment, useResource } from "./api"
import { useEventText } from "./messages"
import { EventImageCover } from "./image-gallery"
import { categoryLabel, dateParts, EVENT_CATEGORIES } from "./date-parts"
import { DateStub } from "./date-stub"
import { EventError } from "./ui"
import { useDirectoryAnalytics } from "@/analytics/collection"

export function EventCard({
  event,
  organizer = false,
}: {
  event: EventApi
  organizer?: boolean
}) {
  const { locale, t } = useEventText()
  const { account } = useAccount()
  const href = organizer
    ? `/organizer/events/${segment(event.id)}`
    : `/events/${segment(event.id)}`
  const when = dateParts(event.startsAt, event.timeZone, locale)
  return (
    <article className="event-card">
      <div className="event-card-media">
        {event.images.length ? (
          <EventImageCover event={event} />
        ) : (
          <div className="event-card-placeholder" aria-hidden>
            <TicketIcon size={40} weight="light" />
          </div>
        )}
        {event.phase !== "upcoming" || organizer ? (
          <div className="event-card-flags">
            {event.phase !== "upcoming" ? (
              <span className="badge">{t(event.phase)}</span>
            ) : null}
            {organizer ? (
              <span className="badge">{t(event.publicationState)}</span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="event-card-body">
        <DateStub
          iso={event.startsAt}
          timeZone={event.timeZone}
          locale={locale}
        />
        <div className="event-card-text">
          <h2>
            <a href={href} className="event-card-link">
              {event.title}
            </a>
          </h2>
          <p className="event-card-meta">
            {when.weekday}, {when.time} · {event.venueName}
          </p>
          <p className="event-card-category">
            {categoryLabel(event.category, locale)}
          </p>
        </div>
      </div>
      {organizer ? (
        <div className="event-card-actions">
          <a className="text-action" href={href}>
            {t("editEvent")}
          </a>
          <a
            className="text-action"
            href={`/organizer/events/${segment(event.id)}/registrations`}
          >
            {t("registrations")}
          </a>
          {account?.user.id === event.organizerId ? (
            <OfflineOperationsLink eventId={event.id} className="text-action" />
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function EventGridSkeleton({ label }: { label: string }) {
  return (
    <SkeletonRegion label={label} className="event-grid-skeleton">
      <div className="event-grid">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div key={item} className="event-card-skeleton">
            <Bar height="auto" radius={12} style={{ aspectRatio: "16 / 10" }} />
            <div className="event-card-skeleton-body">
              <Bar width={44} height={48} radius={8} />
              <div>
                <Bar width="80%" height={18} />
                <Bar width="55%" height={14} style={{ marginTop: 10 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}

function listHref(path: string, next: { q?: string; category?: string }) {
  const search = new URLSearchParams()
  if (next.q?.trim()) search.set("q", next.q.trim())
  if (next.category) search.set("category", next.category)
  const text = search.toString()
  return text ? `${path}?${text}` : path
}

export function EventListPage({ organizer = false }: { organizer?: boolean }) {
  useDirectoryAnalytics(!organizer)
  const { locale, t } = useEventText()
  const initial = new URLSearchParams(window.location.search)
  const initialQuery = (initial.get("q") ?? "").trim()
  const [query, setQuery] = useState(initial.get("q") ?? "")
  const [term, setTerm] = useState(initialQuery)
  const activeCategory = initial.get("category") ?? ""
  const path = organizer ? "/organizer/events" : "/events"
  const params = new URLSearchParams({ limit: "12" })
  if (term) params.set("q", term)
  if (activeCategory) params.set("category", activeCategory)
  const cursor = initial.get("cursor")
  if (cursor && term === initialQuery) params.set("cursor", cursor)
  const resource = useResource(
    `${organizer ? "/organizer" : ""}/events?${params}`,
    eventListResponseSchema,
    0,
    true
  )
  const hrefFor = (next: { q?: string; category?: string }) =>
    listHref(path, next)
  function applySearch(value: string) {
    const next = value.trim()
    setTerm(next)
    window.history.replaceState(
      null,
      "",
      listHref(path, { q: next, category: activeCategory })
    )
  }
  const applyTypedSearch = useEffectEvent(applySearch)
  useEffect(() => {
    if (query.trim() === term) return
    const timer = window.setTimeout(() => applyTypedSearch(query), 300)
    return () => window.clearTimeout(timer)
  }, [query, term])
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    applySearch(query)
  }
  const next = new URLSearchParams(params)
  if (resource.data?.nextCursor) next.set("cursor", resource.data.nextCursor)
  const items = resource.error ? [] : (resource.data?.items ?? [])
  return (
    <div className="events-page">
      <div className={organizer ? "event-page-heading" : "discovery-heading"}>
        <div>
          <h1>{t(organizer ? "organize" : "discoverTitle")}</h1>
          <p>{t(organizer ? "organizerIntro" : "discoverIntro")}</p>
        </div>
        {organizer ? (
          <a className="btn btn-primary" href="/organizer/events/new">
            <PlusIcon size={16} weight="bold" aria-hidden />
            {t("newEvent")}
          </a>
        ) : null}
      </div>
      <div className="discovery-tools">
        <form className="event-search" role="search" onSubmit={search}>
          <MagnifyingGlassIcon
            className="event-search-icon"
            size={18}
            aria-hidden
          />
          <input
            className="event-search-input"
            name="q"
            type="search"
            aria-label={t("search")}
            placeholder={t("searchHint")}
            maxLength={200}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="icon-button"
              aria-label={t("clearSearch")}
              onClick={() => setQuery("")}
            >
              <XIcon size={16} aria-hidden />
            </button>
          ) : null}
          <button className="btn btn-primary" type="submit">
            {t("search")}
          </button>
        </form>
        {organizer ? null : (
          <ChipRow label={t("category")}>
            <a
              href={hrefFor({ q: term })}
              aria-current={activeCategory ? undefined : "page"}
            >
              {t("allCategories")}
            </a>
            {EVENT_CATEGORIES.map((category) => (
              <a
                key={category}
                href={hrefFor({ q: term, category })}
                aria-current={activeCategory === category ? "page" : undefined}
              >
                {categoryLabel(category, locale)}
              </a>
            ))}
          </ChipRow>
        )}
      </div>
      {resource.error ? (
        <EventError error={resource.error} retry={resource.reload} />
      ) : null}
      {resource.loading ? (
        <EventGridSkeleton label={t("loading")} />
      ) : resource.data?.items.length === 0 ? (
        organizer && !term && !activeCategory ? (
          <EmptyState
            icon={TicketIcon}
            title={t("noOwnEvents")}
            titleAs="h2"
            hint={t("noOwnEventsHint")}
            action={
              <a className="btn btn-primary" href="/organizer/events/new">
                <PlusIcon size={16} weight="bold" aria-hidden />
                {t("newEvent")}
              </a>
            }
          />
        ) : (
          <EmptyState
            icon={MagnifyingGlassIcon}
            title={t("noEvents")}
            titleAs="h2"
            hint={t("noEventsHint")}
            action={
              term || activeCategory ? (
                <a className="btn btn-secondary" href={hrefFor({})}>
                  {t("clearSearch")}
                </a>
              ) : undefined
            }
          />
        )
      ) : (
        <div
          className="event-grid"
          data-refreshing={resource.refreshing || undefined}
          aria-busy={resource.refreshing || undefined}
        >
          {items.map((event) => (
            <EventCard key={event.id} event={event} organizer={organizer} />
          ))}
        </div>
      )}
      <p className="sr-only" role="status">
        {(term || activeCategory) && resource.data && !resource.refreshing
          ? `${t("eventsShown")}: ${items.length}`
          : ""}
      </p>
      <nav className="event-pagination" aria-label={t("more")}>
        {params.has("cursor") ? (
          <a className="secondary-link" href={path}>
            {t("firstPage")}
          </a>
        ) : null}
        {resource.data?.nextCursor &&
        !resource.refreshing &&
        !resource.error ? (
          <a className="secondary-link" href={`${path}?${next}`}>
            {t("more")}
            <ArrowRightIcon size={16} aria-hidden />
          </a>
        ) : null}
      </nav>
    </div>
  )
}
