import { useState, type FormEvent } from "react"
import {
  operationsResponseSchema,
  type OperationsKind,
  type OperationsResponse,
} from "@elc/shared"
import { EventApiError, useResource } from "../events/api"
import { useEventText } from "../events/messages"
import { money } from "../events/policies"
import { EventError, Field, Loading, SelectField } from "../events/ui"
import { useHistoryText } from "../history/messages"
import { useAdministrationText } from "./messages"
import { useOperationsText } from "./operations-messages"
import { OperationsExport } from "./operations-export"

type Item = OperationsResponse["items"][number]
function Record({ item }: { item: Item }) {
  const { t, locale } = useOperationsText(),
    { t: stateText } = useEventText(),
    { t: adminText } = useAdministrationText(),
    { t: historyText } = useHistoryText()
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Almaty",
    }).format(new Date(value))
  return (
    <article
      className="event-panel administration-record"
      data-operation-id={item.id}
    >
      <h3>{"action" in item ? item.action : item.id}</h3>
      {"action" in item ? <p>{item.id}</p> : null}
      <dl>
        <dt>{t("created")}</dt>
        <dd>
          <time dateTime={item.createdAt}>{date(item.createdAt)}</time>
        </dd>
        {item.eventId ? (
          <>
            <dt>{t("eventId")}</dt>
            <dd>{item.eventId}</dd>
          </>
        ) : null}
        <dt>{"accountId" in item ? t("accountId") : t("actor")}</dt>
        <dd>
          {("accountId" in item ? item.accountId : item.actorId) ?? t("none")}
        </dd>
        {"state" in item ? (
          <>
            <dt>{adminText("status")}</dt>
            <dd>{stateText(item.state)}</dd>
          </>
        ) : null}
        {"totalMinor" in item ? (
          <>
            <dt>{t("total")}</dt>
            <dd>{money(item.totalMinor, locale)}</dd>
            <dt>{t("discount")}</dt>
            <dd>{money(item.discountMinor, locale)}</dd>
            <dt>{t("fee")}</dt>
            <dd>{money(item.processingFeeMinor, locale)}</dd>
          </>
        ) : null}
        {"purpose" in item ? (
          <>
            <dt>{t("purpose")}</dt>
            <dd>{t(item.purpose)}</dd>
            <dt>{t("subject")}</dt>
            <dd>{item.subjectId}</dd>
            <dt>{t("amount")}</dt>
            <dd>{money(item.amountMinor, locale)}</dd>
            <dt>{t("dispatch")}</dt>
            <dd>{t(item.dispatchState)}</dd>
            <dt>{t("providerPayment")}</dt>
            <dd>{item.providerPaymentId ?? t("none")}</dd>
            <dt>{t("providerOrder")}</dt>
            <dd>{item.providerOrderId ?? t("none")}</dd>
            {item.refundState ? (
              <>
                <dt>{t("refundStatus")}</dt>
                <dd>{stateText(item.refundState)}</dd>
                <dt>{t("refunded")}</dt>
                <dd>{money(item.refundAmountMinor ?? 0, locale)}</dd>
              </>
            ) : null}
          </>
        ) : null}
        {"action" in item ? (
          <>
            <dt>{t("subject")}</dt>
            <dd>{item.entityId}</dd>
            <dt>{t("correlation")}</dt>
            <dd>{item.correlationId}</dd>
          </>
        ) : null}
        <dt>{historyText("expires")}</dt>
        <dd>
          <time dateTime={item.retention.expiresAt}>
            {date(item.retention.expiresAt)}
          </time>
        </dd>
      </dl>
      {"description" in item ? (
        <p className="preserve-lines">{item.description}</p>
      ) : null}
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
    </article>
  )
}
export function OperationsRecords() {
  const { t } = useOperationsText(),
    { t: adminText } = useAdministrationText()
  const [kind, setKind] = useState<OperationsKind>("orders"),
    [q, setQ] = useState(""),
    [eventId, setEventId] = useState(""),
    [accountId, setAccountId] = useState("")
  const [search, setSearch] = useState({
      kind,
      q: "",
      eventId: "",
      accountId: "",
      after: "",
    }),
    [denied, setDenied] = useState(false)
  const parameters = new URLSearchParams({
    kind: search.kind,
    q: search.q,
    limit: "20",
  })
  for (const key of ["eventId", "accountId", "after"] as const)
    if (search[key]) parameters.set(key, search[key])
  const query = parameters.toString(),
    resource = useResource(
      `/admin/operations?${query}`,
      operationsResponseSchema,
      15000
    )
  function submit(event: FormEvent) {
    event.preventDefault()
    setDenied(false)
    setSearch({
      kind,
      q: q.trim(),
      eventId: eventId.trim(),
      accountId: accountId.trim(),
      after: "",
    })
    resource.reload()
  }
  const navigate = (after = "") => {
    setDenied(false)
    setSearch({ ...search, after })
  }
  return (
    <>
      <h2>{t("title")}</h2>
      <form className="event-panel" onSubmit={submit}>
        <SelectField
          label={t("kind")}
          value={kind}
          onChange={(event) => setKind(event.target.value as OperationsKind)}
        >
          {(["orders", "payments", "audit"] as const).map((value) => (
            <option key={value} value={value}>
              {t(value)}
            </option>
          ))}
        </SelectField>
        <Field
          label={t("query")}
          maxLength={200}
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <p className="field-hint">{t("hint")}</p>
        <Field
          label={t("eventId")}
          maxLength={128}
          value={eventId}
          onChange={(event) => setEventId(event.target.value)}
        />
        <Field
          label={t("accountId")}
          maxLength={128}
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
        />
        <button type="submit" className="primary-link">
          {adminText("search")}
        </button>
      </form>
      {denied || resource.error ? (
        <EventError
          error={resource.error ?? new EventApiError("FORBIDDEN", 403)}
          retry={() => {
            setDenied(false)
            resource.reload()
          }}
        />
      ) : !resource.data ? (
        <Loading />
      ) : (
        <>
          <p>{t("zone")}</p>
          <OperationsExport
            key={query}
            query={query}
            kind={search.kind}
            onDenied={() => setDenied(true)}
          />
          <div className="analytics-actions">
            <button
              type="button"
              className="text-action"
              disabled={!search.after}
              onClick={() => navigate()}
            >
              {adminText("first")}
            </button>
            <button
              type="button"
              className="text-action"
              disabled={!resource.data.nextCursor}
              onClick={() => navigate(resource.data!.nextCursor!)}
            >
              {adminText("next")}
            </button>
          </div>
          {resource.data.items.length ? (
            resource.data.items.map((item) => (
              <Record key={item.id} item={item} />
            ))
          ) : (
            <p>{adminText("empty")}</p>
          )}
        </>
      )}
    </>
  )
}
