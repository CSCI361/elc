import { useRef, useState, type FormEvent } from "react"
import {
  platformCampaignsResponseSchema,
  type PlatformCampaignsQuery,
  type PlatformCampaignsResponse,
} from "@elc/shared"
import { EventApiError, useResource } from "../events/api"
import { money } from "../events/policies"
import { EventError, Field, Loading, SelectField } from "../events/ui"
import { useHistoryText } from "../history/messages"
import {
  campaignAuditHref,
  campaignFilters,
  campaignOrdersHref,
  campaignPage,
  campaignSearch,
  campaignSubmission,
} from "./campaigns-policies"
import { useCampaignAdministrationText } from "./campaigns-messages"

function CampaignRecord({
  item,
}: {
  item: PlatformCampaignsResponse["items"][number]
}) {
  const { t, locale } = useCampaignAdministrationText()
  const { t: historyText } = useHistoryText()
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Almaty",
    }).format(new Date(value))
  return (
    <article
      className="event-panel administration-record"
      data-campaign-id={item.id}
    >
      <h3>{item.name}</h3>
      <p>{t(item.enabled ? "enabled" : "disabled")}</p>
      <dl>
        <dt>{t("campaignId")}</dt>
        <dd>{item.id}</dd>
        <dt>{t("event")}</dt>
        <dd>{item.eventTitle}</dd>
        <dt>{t("eventId")}</dt>
        <dd>{item.eventId}</dd>
        <dt>{t("organizerId")}</dt>
        <dd>{item.organizerId}</dd>
        <dt>{t("discount")}</dt>
        <dd>
          {item.discount.kind === "fixed"
            ? money(item.discount.amountMinor, locale)
            : new Intl.NumberFormat(locale, {
                style: "percent",
                maximumFractionDigits: 2,
              }).format(item.discount.basisPoints / 10000)}
        </dd>
        <dt>{t("starts")}</dt>
        <dd>
          <time dateTime={item.startsAt}>{date(item.startsAt)}</time>
        </dd>
        <dt>{t("ends")}</dt>
        <dd>
          <time dateTime={item.endsAt}>{date(item.endsAt)}</time>
        </dd>
        <dt>{t("limit")}</dt>
        <dd>{item.maxRedemptions.toLocaleString(locale)}</dd>
        <dt>{t("holds")}</dt>
        <dd>{item.activeHolds.toLocaleString(locale)}</dd>
        <dt>{t("committed")}</dt>
        <dd>{item.committedRedemptions.toLocaleString(locale)}</dd>
        <dt>{t("updated")}</dt>
        <dd>
          <time dateTime={item.updatedAt}>{date(item.updatedAt)}</time>
        </dd>
        <dt>{historyText("expires")}</dt>
        <dd>
          <time dateTime={item.retention.expiresAt}>
            {date(item.retention.expiresAt)}
          </time>
        </dd>
      </dl>
      {item.retention.held ? (
        <>
          <p>{historyText("held")}</p>
          <ul>
            {item.retention.holdReasons.map((reason) => (
              <li key={reason}>{historyText(reason)}</li>
            ))}
          </ul>
        </>
      ) : null}
      <nav
        className="analytics-actions"
        aria-label={`${t("title")}: ${item.name}`}
      >
        <a href={campaignOrdersHref(item.id, item.eventId)}>{t("orders")}</a>
        <a href={campaignAuditHref(item.id, item.eventId)}>{t("audit")}</a>
      </nav>
    </article>
  )
}
function CurrentCampaigns({ initial }: { initial: PlatformCampaignsQuery }) {
  const { t, locale } = useCampaignAdministrationText()
  const [query, setQuery] = useState(initial)
  const [q, setQ] = useState(initial.q)
  const [eventId, setEventId] = useState(initial.eventId ?? "")
  const [organizerId, setOrganizerId] = useState(initial.organizerId ?? "")
  const [enabled, setEnabled] = useState(initial.enabled)
  const [validation, setValidation] = useState<unknown>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const resource = useResource(
    `/admin/campaigns?${campaignSearch(query)}`,
    platformCampaignsResponseSchema,
    15000
  )
  function submit(event: FormEvent) {
    event.preventDefault()
    const next = campaignSubmission({ q, eventId, organizerId, enabled })
    if (!next) {
      setValidation(new EventApiError("INVALID_INPUT", 400))
      return
    }
    setValidation(null)
    setQuery(next)
    resource.reload()
    heading.current?.focus()
  }
  return (
    <>
      <h2 ref={heading} tabIndex={-1}>
        {t("title")}
      </h2>
      <p>{t("intro")}</p>
      <form className="event-panel" onSubmit={submit}>
        <Field
          label={t("q")}
          value={q}
          onChange={(event) => setQ(event.target.value)}
          maxLength={200}
        />
        <Field
          label={t("eventId")}
          value={eventId}
          onChange={(event) => setEventId(event.target.value)}
          maxLength={128}
        />
        <Field
          label={t("organizerId")}
          value={organizerId}
          onChange={(event) => setOrganizerId(event.target.value)}
          maxLength={128}
        />
        <SelectField
          label={t("enabledFilter")}
          value={enabled}
          onChange={(event) =>
            setEnabled(event.target.value as PlatformCampaignsQuery["enabled"])
          }
        >
          <option value="all">{t("all")}</option>
          <option value="yes">{t("enabled")}</option>
          <option value="no">{t("disabled")}</option>
        </SelectField>
        <div className="analytics-actions">
          <button type="submit" className="primary-link">
            {t("search")}
          </button>
          <a className="text-action" href="/admin/campaigns">
            {t("reset")}
          </a>
        </div>
      </form>
      {validation ? <EventError error={validation} /> : null}
      {resource.error ? (
        <EventError error={resource.error} retry={resource.reload} />
      ) : !resource.data ? (
        <Loading />
      ) : (
        <>
          <p>{t("zone")}</p>
          <p>
            {t("generated")}:{" "}
            <time dateTime={resource.data.generatedAt}>
              {new Intl.DateTimeFormat(locale, {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Asia/Almaty",
              }).format(new Date(resource.data.generatedAt))}
            </time>
          </p>
          <p>{t("usageHint")}</p>
          <p>{t("eligibilityHint")}</p>
          <nav className="analytics-actions" aria-label={t("pagination")}>
            <button
              type="button"
              className="text-action"
              disabled={!query.cursor}
              onClick={() => {
                setQuery(campaignPage(query))
                heading.current?.focus()
              }}
            >
              {t("first")}
            </button>
            <button
              type="button"
              className="text-action"
              disabled={!resource.data.nextCursor}
              onClick={() => {
                setQuery(campaignPage(query, resource.data!.nextCursor!))
                heading.current?.focus()
              }}
            >
              {t("next")}
            </button>
            <button
              type="button"
              className="text-action"
              onClick={resource.reload}
            >
              {t("reload")}
            </button>
          </nav>
          {resource.data.items.length ? (
            resource.data.items.map((item) => (
              <CampaignRecord key={item.id} item={item} />
            ))
          ) : (
            <p>{t("empty")}</p>
          )}
        </>
      )}
    </>
  )
}
export function PlatformCampaigns() {
  const { t } = useCampaignAdministrationText()
  const [initial] = useState(() => campaignFilters(window.location.search))
  return initial ? (
    <CurrentCampaigns initial={initial} />
  ) : (
    <>
      <h2>{t("title")}</h2>
      <p role="alert">{t("invalid")}</p>
      <a className="text-action" href="/admin/campaigns">
        {t("reset")}
      </a>
    </>
  )
}
