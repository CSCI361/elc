import {
  organizerRecordsResponseSchema,
  type OrganizerRecordsQuery,
} from "@elc/shared"
import { useAccount } from "@/auth/context"
import { AuthNotice } from "@/auth/notice"
import { Button } from "@/components/ui/button"
import { EventApiError, segment, useResource } from "@/events/api"
import { EventError, Field, Loading, Protected } from "@/events/ui"
import { HistoryHeading, Retention } from "@/history/ui"
import { CheckinRecord, OrderRecord, RecordTime, TicketRecord } from "./cards"
import { useRecordsText } from "./messages"
import {
  recordsBase,
  recordsHref,
  recordsLinks,
  recordsPage,
  recordsQuery,
  recordsReset,
  recordsSearch,
  recordsTab,
} from "./policies"
import "./records.css"

function RecordFilters({
  eventId,
  query,
}: {
  eventId: string
  query: OrganizerRecordsQuery
}) {
  const { t } = useRecordsText()
  return (
    <>
      <nav className="records-tabs" aria-label={t("navigation")}>
        {(["tickets", "orders", "checkins"] as const).map((kind) => (
          <a
            key={kind}
            href={recordsHref(eventId, recordsTab(query, kind))}
            aria-current={query.kind === kind ? "page" : undefined}
          >
            {t(kind)}
          </a>
        ))}
      </nav>
      <form
        className="event-panel records-filters"
        method="get"
        action={recordsBase(eventId)}
      >
        <input type="hidden" name="kind" value={query.kind} />
        <input type="hidden" name="limit" value={query.limit} />
        {query.orderId ? (
          <input type="hidden" name="orderId" value={query.orderId} />
        ) : null}
        {query.ticketId ? (
          <input type="hidden" name="ticketId" value={query.ticketId} />
        ) : null}
        <Field
          name="q"
          label={t("search")}
          hint={t("searchHint")}
          defaultValue={query.q}
          maxLength={200}
        />
        <div className="records-links">
          <Button type="submit">{t("apply")}</Button>
          <a
            className="text-action"
            href={recordsHref(eventId, recordsReset(query))}
          >
            {t("reset")}
          </a>
        </div>
        {query.orderId ? (
          <p>
            {t("orderId")}: {query.orderId}{" "}
            <a
              className="text-action"
              href={recordsHref(eventId, {
                ...query,
                orderId: undefined,
                cursor: undefined,
              })}
            >
              {t("removeOrder")}
            </a>
          </p>
        ) : null}
        {query.ticketId ? (
          <p>
            {t("ticketId")}: {query.ticketId}{" "}
            <a
              className="text-action"
              href={recordsHref(eventId, {
                ...query,
                ticketId: undefined,
                cursor: undefined,
              })}
            >
              {t("removeTicket")}
            </a>
          </p>
        ) : null}
      </form>
    </>
  )
}

function CurrentRecords({
  eventId,
  query,
}: {
  eventId: string
  query: OrganizerRecordsQuery
}) {
  const { t, locale } = useRecordsText()
  const resource = useResource(
    `/events/${segment(eventId)}/records?${recordsSearch(query)}`,
    organizerRecordsResponseSchema,
    15000
  )
  if (resource.error)
    return (
      <>
        <HistoryHeading>{t("title")}</HistoryHeading>
        {resource.error instanceof EventApiError &&
        [401, 403, 404].includes(resource.error.status) ? (
          <AuthNotice>
            {t("denied")}{" "}
            <button
              type="button"
              className="text-action"
              onClick={resource.reload}
            >
              {t("reload")}
            </button>
          </AuthNotice>
        ) : (
          <EventError error={resource.error} retry={resource.reload} />
        )}
      </>
    )
  if (!resource.data) return <Loading />
  const data = resource.data
  if (data.event.id !== eventId || data.kind !== query.kind)
    return (
      <EventError
        error={new EventApiError("INTERNAL_ERROR", 500)}
        retry={resource.reload}
      />
    )
  const props = { eventId, query, timeZone: data.event.timeZone }
  return (
    <>
      <HistoryHeading>{data.event.title}</HistoryHeading>
      <h2 className="records-title">{t("title")}</h2>
      <div className="records-links">
        {recordsLinks(eventId, data.capabilities).map((link) => (
          <a className="text-action" key={link.label} href={link.href}>
            {t(link.label)}
          </a>
        ))}
      </div>
      <section className="event-panel records-summary">
        <Retention value={data.retention} timeZone={data.event.timeZone} />
        <p className="field-hint">{t("retentionHint")}</p>
        <p>
          {t("snapshot")}:{" "}
          <RecordTime value={data.generatedAt} timeZone={data.event.timeZone} />{" "}
          · {data.event.timeZone}
        </p>
        <p className="field-hint">{t("snapshotHint")}</p>
        <button type="button" className="text-action" onClick={resource.reload}>
          {t("reload")}
        </button>
      </section>
      <RecordFilters eventId={eventId} query={query} />
      <p className="field-hint">
        {t("rows")}: {data.items.length.toLocaleString(locale)}
      </p>
      <div className="records-list">
        {data.kind === "orders"
          ? data.items.map((item) => (
              <OrderRecord
                key={item.id}
                item={item}
                capabilities={data.capabilities}
                {...props}
              />
            ))
          : data.kind === "tickets"
            ? data.items.map((item) => (
                <TicketRecord key={item.id} item={item} {...props} />
              ))
            : data.items.map((item) => (
                <CheckinRecord key={item.id} item={item} {...props} />
              ))}
      </div>
      {!data.items.length ? (
        <p className="event-panel" role="status">
          {t("empty")}
        </p>
      ) : null}
      <nav className="records-links" aria-label={t("pagination")}>
        {query.cursor ? (
          <a
            className="text-action"
            href={recordsHref(eventId, recordsPage(query))}
          >
            {t("first")}
          </a>
        ) : null}
        {data.nextCursor ? (
          <a
            className="text-action"
            href={recordsHref(eventId, recordsPage(query, data.nextCursor))}
          >
            {t("next")}
          </a>
        ) : null}
      </nav>
    </>
  )
}

function RecordsWorkspace({ eventId }: { eventId: string }) {
  const { t } = useRecordsText()
  const query = recordsQuery(window.location.search)
  return (
    <div className="events-page registrations-page">
      {query ? (
        <CurrentRecords
          key={recordsSearch(query)}
          eventId={eventId}
          query={query}
        />
      ) : (
        <>
          <HistoryHeading>{t("title")}</HistoryHeading>
          <AuthNotice>
            {t("invalid")}{" "}
            <a className="text-action" href={recordsBase(eventId)}>
              {t("reset")}
            </a>
          </AuthNotice>
        </>
      )}
    </div>
  )
}

export function OrganizerRecordsPage({ eventId }: { eventId: string }) {
  const { account } = useAccount()
  return (
    <Protected>
      <RecordsWorkspace
        key={`${account?.user.id}:${eventId}`}
        eventId={eventId}
      />
    </Protected>
  )
}
