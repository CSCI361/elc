import { useState, type FormEvent } from "react"
import { ListMagnifyingGlassIcon } from "@phosphor-icons/react"
import { EmptyState } from "@/components/ui/empty-state"
import {
  operationsResponseSchema,
  type OperationsKind,
  type OperationsResponse,
} from "@elc/shared"
import { EventApiError, useResource } from "../events/api"
import { useEventText } from "../events/messages"
import { dateText, money } from "../events/policies"
import { EventError, Field, SectionLoading, SelectField } from "../events/ui"
import { useHistoryText } from "../history/messages"
import { useAdministrationText } from "./messages"
import { useOperationsText } from "./operations-messages"
import {
  operationsFilters,
  operationsSearch,
  operationsSubmission,
  type OperationsQuery,
} from "./operations-policies"
import { OperationsExport } from "./operations-export"

type Item = OperationsResponse["items"][number]
function OperationRecord({ item }: { item: Item }) {
  const { t, locale } = useOperationsText(),
    { t: stateText } = useEventText(),
    { t: adminText } = useAdministrationText(),
    { t: historyText } = useHistoryText()
  const date = (value: string) => dateText(value, "Asia/Almaty", locale)
  return (
    <article
      className="event-panel administration-record"
      data-operation-id={item.id}
    >
      <h3>{"action" in item ? item.action : item.id}</h3>
      {"action" in item ? <p>{item.id}</p> : null}
      <dl className="fact-grid">
        <div>
          <dt>{t("created")}</dt>
          <dd>
            <time dateTime={item.createdAt}>{date(item.createdAt)}</time>
          </dd>
        </div>
        {item.eventId ? (
          <div>
            <dt>{t("eventId")}</dt>
            <dd>{item.eventId}</dd>
          </div>
        ) : null}
        <div>
          <dt>{"accountId" in item ? t("accountId") : t("actor")}</dt>
          <dd>
            {("accountId" in item ? item.accountId : item.actorId) ?? t("none")}
          </dd>
        </div>
        {"state" in item ? (
          <div>
            <dt>{adminText("status")}</dt>
            <dd>{stateText(item.state)}</dd>
          </div>
        ) : null}
        {"totalMinor" in item ? (
          <>
            <div>
              <dt>{t("total")}</dt>
              <dd>{money(item.totalMinor, locale)}</dd>
            </div>
            <div>
              <dt>{t("discount")}</dt>
              <dd>{money(item.discountMinor, locale)}</dd>
            </div>
            <div>
              <dt>{t("fee")}</dt>
              <dd>{money(item.processingFeeMinor, locale)}</dd>
            </div>
          </>
        ) : null}
        {"purpose" in item ? (
          <>
            <div>
              <dt>{t("purpose")}</dt>
              <dd>{t(item.purpose)}</dd>
            </div>
            <div>
              <dt>{t("subject")}</dt>
              <dd>{item.subjectId}</dd>
            </div>
            <div>
              <dt>{t("amount")}</dt>
              <dd>{money(item.amountMinor, locale)}</dd>
            </div>
            <div>
              <dt>{t("dispatch")}</dt>
              <dd>{t(item.dispatchState)}</dd>
            </div>
            <div>
              <dt>{t("providerPayment")}</dt>
              <dd>{item.providerPaymentId ?? t("none")}</dd>
            </div>
            <div>
              <dt>{t("providerOrder")}</dt>
              <dd>{item.providerOrderId ?? t("none")}</dd>
            </div>
            {item.refundState ? (
              <>
                <div>
                  <dt>{t("refundStatus")}</dt>
                  <dd>{stateText(item.refundState)}</dd>
                </div>
                <div>
                  <dt>{t("refunded")}</dt>
                  <dd>{money(item.refundAmountMinor ?? 0, locale)}</dd>
                </div>
              </>
            ) : null}
          </>
        ) : null}
        {"action" in item ? (
          <>
            <div>
              <dt>{t("subject")}</dt>
              <dd>{item.entityId}</dd>
            </div>
            <div>
              <dt>{t("correlation")}</dt>
              <dd>{item.correlationId}</dd>
            </div>
          </>
        ) : null}
        <div>
          <dt>{historyText("expires")}</dt>
          <dd>
            <time dateTime={item.retention.expiresAt}>
              {date(item.retention.expiresAt)}
            </time>
          </dd>
        </div>
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
function CurrentOperations({ initial }: { initial: OperationsQuery }) {
  const { t } = useOperationsText(),
    { t: adminText } = useAdministrationText()
  const [kind, setKind] = useState<OperationsKind>(initial.kind),
    [q, setQ] = useState(initial.q),
    [eventId, setEventId] = useState(initial.eventId ?? ""),
    [accountId, setAccountId] = useState(initial.accountId ?? ""),
    [campaignId, setCampaignId] = useState(initial.campaignId ?? "")
  const [search, setSearch] = useState(initial),
    [denied, setDenied] = useState(false),
    [validation, setValidation] = useState<unknown>(null)
  const query = operationsSearch(search),
    resource = useResource(
      `/admin/operations?${query}`,
      operationsResponseSchema,
      15000
    )
  function submit(event: FormEvent) {
    event.preventDefault()
    const next = operationsSubmission({
      kind,
      q,
      eventId,
      accountId,
      campaignId,
    })
    if (!next) {
      setValidation(new EventApiError("INVALID_INPUT", 400))
      return
    }
    setValidation(null)
    setDenied(false)
    setSearch(next)
    resource.reload()
  }
  const navigate = (after?: string) => {
    setDenied(false)
    setSearch({ ...search, after })
  }
  return (
    <>
      <h2>{t("title")}</h2>
      <form className="administration-filters" onSubmit={submit}>
        <SelectField
          label={t("kind")}
          value={kind}
          onValueChange={(selected) => {
            const value = selected as OperationsKind
            setKind(value)
            if (value !== "orders") setCampaignId("")
          }}
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
        {kind === "orders" ? (
          <Field
            label={t("campaignId")}
            maxLength={128}
            value={campaignId}
            onChange={(event) => setCampaignId(event.target.value)}
          />
        ) : null}
        <button type="submit" className="primary-link">
          {adminText("search")}
        </button>
      </form>
      {validation ? <EventError error={validation} /> : null}
      {denied || resource.error ? (
        <EventError
          error={resource.error ?? new EventApiError("FORBIDDEN", 403)}
          retry={() => {
            setDenied(false)
            resource.reload()
          }}
        />
      ) : !resource.data ? (
        <SectionLoading />
      ) : (
        <>
          <p>{t("zone")}</p>
          <OperationsExport
            key={query}
            query={query}
            kind={search.kind}
            onDenied={() => setDenied(true)}
          />
          {search.after || resource.data.nextCursor ? (
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
          ) : null}
          {resource.data.items.length ? (
            resource.data.items.map((item) => (
              <OperationRecord key={item.id} item={item} />
            ))
          ) : (
            <EmptyState
              icon={ListMagnifyingGlassIcon}
              title={adminText("empty")}
            />
          )}
        </>
      )}
    </>
  )
}

export function OperationsRecords() {
  const { t } = useOperationsText()
  const [initial] = useState(() => operationsFilters(window.location.search))
  return initial ? (
    <CurrentOperations initial={initial} />
  ) : (
    <>
      <h2>{t("title")}</h2>
      <p role="alert">{t("invalidFilters")}</p>
      <a href="/admin/operations" className="text-action">
        {t("resetFilters")}
      </a>
    </>
  )
}
