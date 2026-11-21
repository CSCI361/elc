import {
  deliveryDetailResponseSchema,
  deliveryEmailStateSchema,
  deliveryListResponseSchema,
  deliveryPdfStateSchema,
  type DeliveryListQuery,
} from "@elc/shared"
import { useState, type FormEvent } from "react"
import { useAccount } from "@/auth/context"
import { navigate } from "@/lib/navigation"
import { AuthNotice } from "@/auth/notice"
import { Button } from "@/components/ui/button"
import { segment, useResource } from "@/events/api"
import {
  Field,
  Loading,
  Protected,
  SectionLoading,
  SelectField,
} from "@/events/ui"
import { useDeliveryText } from "./messages"
import { deliveryQuery, deliverySearch } from "./policies"
import { RecoveryForm } from "./recovery-form"
import { DeliveryFailure } from "./ui"
import "./delivery.css"

function DeliveryDetail({ id, accountId }: { id: string; accountId: string }) {
  const { t, locale } = useDeliveryText(),
    [denied, setDenied] = useState<unknown>(null)
  const [notice, setNotice] = useState<
    "queued" | "stale" | "invalidReason" | null
  >(null)
  const resource = useResource(
    `/admin/deliveries/${segment(id)}`,
    deliveryDetailResponseSchema,
    15000
  )
  const reload = () => {
    setDenied(null)
    resource.reload()
  }
  if (resource.error || denied)
    return <DeliveryFailure error={resource.error ?? denied} retry={reload} />
  if (!resource.data) return <Loading />
  const delivery = resource.data.delivery
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "long",
    timeZone: "Asia/Almaty",
  })
  return (
    <>
      {notice ? (
        <AuthNotice tone={notice === "queued" ? "success" : "error"}>
          {t(notice)}
        </AuthNotice>
      ) : null}
      <div className="event-page-heading">
        <h2>{t("detail")}</h2>
        <button type="button" className="text-action" onClick={reload}>
          {t("reload")}
        </button>
      </div>
      <p>{t("timeZone")}</p>
      <section className="event-panel">
        <dl className="delivery-data">
          <div>
            <dt>{t("emailState")}</dt>
            <dd>{t(delivery.emailState)}</dd>
          </div>
          <div>
            <dt>{t("pdfState")}</dt>
            <dd>{t(delivery.pdfState)}</dd>
          </div>
          {(
            [
              "id",
              "kind",
              "sourceId",
              "entityId",
              "eventId",
              "recipientId",
              "providerId",
              "providerStatus",
              "attempts",
              "failures",
              "lastError",
            ] as const
          ).map((key) => (
            <div key={key}>
              <dt>{t(key)}</dt>
              <dd>{delivery[key] ?? t("none")}</dd>
            </div>
          ))}
          {(
            [
              "createdAt",
              "updatedAt",
              "firstAttemptAt",
              "lastAttemptAt",
              "completedAt",
              "nextAttemptAt",
              "busyUntil",
            ] as const
          ).map((key) => {
            const value = delivery[key]
            return (
              <div key={key}>
                <dt>{t(key)}</dt>
                <dd>
                  {value ? (
                    <time dateTime={value}>{date.format(new Date(value))}</time>
                  ) : (
                    t("none")
                  )}
                </dd>
              </div>
            )
          })}
        </dl>
      </section>
      <RecoveryForm
        delivery={delivery}
        accountId={accountId}
        reload={reload}
        deny={setDenied}
        settled={setNotice}
      />
    </>
  )
}

function DeliveryList() {
  const { t, locale } = useDeliveryText()
  const initial = deliveryQuery(window.location.search)
  const query: DeliveryListQuery = initial ?? { limit: 20 }
  const [invalid, setInvalid] = useState(!initial)
  const resource = useResource(
    `/admin/deliveries?${deliverySearch(query)}`,
    deliveryListResponseSchema,
    15000
  )
  const changeQuery = (input: DeliveryListQuery) => {
    setInvalid(false)
    navigate(`/admin/deliveries?${deliverySearch(input)}`, { replace: true })
  }
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget),
      params = new URLSearchParams()
    for (const key of ["emailState", "pdfState", "kind", "eventId"]) {
      const raw = data.get(key)
      const value = typeof raw === "string" ? raw.trim() : ""
      if (value) params.set(key, value)
    }
    const parsed = deliveryQuery(params.toString())
    if (!parsed) {
      setInvalid(true)
      return
    }
    changeQuery(parsed)
  }
  if (resource.error)
    return <DeliveryFailure error={resource.error} retry={resource.reload} />
  const data = resource.data
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Almaty",
  })
  return (
    <>
      <div className="event-page-heading">
        <h1>{t("title")}</h1>
        <button type="button" className="text-action" onClick={resource.reload}>
          {t("reload")}
        </button>
      </div>
      <form className="delivery-filters" onSubmit={filter}>
        <SelectField
          name="emailState"
          label={t("emailState")}
          defaultValue={query.emailState ?? ""}
        >
          <option value="">{t("all")}</option>
          {deliveryEmailStateSchema.options.map((value) => (
            <option key={value} value={value}>
              {t(value)}
            </option>
          ))}
        </SelectField>
        <SelectField
          name="pdfState"
          label={t("pdfState")}
          defaultValue={query.pdfState ?? ""}
        >
          <option value="">{t("all")}</option>
          {deliveryPdfStateSchema.options.map((value) => (
            <option key={value} value={value}>
              {t(value)}
            </option>
          ))}
        </SelectField>
        <Field
          name="kind"
          label={t("kind")}
          maxLength={80}
          defaultValue={query.kind ?? ""}
        />
        <Field
          name="eventId"
          label={t("eventId")}
          maxLength={128}
          defaultValue={query.eventId ?? ""}
        />
        <Button type="submit">{t("apply")}</Button>
      </form>
      {invalid ? <AuthNotice>{t("invalid")}</AuthNotice> : null}
      <p>{t("timeZone")}</p>
      {!data ? (
        <SectionLoading />
      ) : !data.items.length ? (
        <p>{t("empty")}</p>
      ) : (
        <>
          <p className="field-hint">{t("tableHint")}</p>
          <div
            className="delivery-table-scroll"
            role="region"
            aria-label={t("title")}
            tabIndex={0}
          >
            <table className="delivery-table">
              <caption className="sr-only">{t("title")}</caption>
              <thead>
                <tr>
                  {(
                    [
                      "id",
                      "kind",
                      "emailState",
                      "pdfState",
                      "attempts",
                      "updatedAt",
                    ] as const
                  ).map((key) => (
                    <th key={key} scope="col">
                      {t(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <th scope="row">
                      <a href={`/admin/deliveries/${segment(item.id)}`}>
                        {item.id}
                      </a>
                    </th>
                    <td>{item.kind}</td>
                    <td>{t(item.emailState)}</td>
                    <td>{t(item.pdfState)}</td>
                    <td>{item.attempts}</td>
                    <td>
                      <time dateTime={item.updatedAt}>
                        {date.format(new Date(item.updatedAt))}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="delivery-pagination">
        {query.after ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => changeQuery({ ...query, after: undefined })}
          >
            {t("reset")}
          </Button>
        ) : null}
        {data?.nextCursor ? (
          <Button
            type="button"
            onClick={() =>
              changeQuery({
                ...query,
                after: data.nextCursor ?? undefined,
              })
            }
          >
            {t("next")}
          </Button>
        ) : null}
      </div>
    </>
  )
}
export function DeliveryPage({ id }: { id: string | null }) {
  const { account } = useAccount(),
    { t } = useDeliveryText()
  return (
    <Protected>
      <div className="events-page delivery-page">
        {id ? (
          <a className="back-link" href="/admin/deliveries">
            {t("title")}
          </a>
        ) : null}
        <h1>{t("title")}</h1>
        <p>{t("hint")}</p>
        {account ? (
          id ? (
            <DeliveryDetail
              key={`${account.user.id}:${id}`}
              id={id}
              accountId={account.user.id}
            />
          ) : (
            <DeliveryList key={account.user.id} />
          )
        ) : null}
      </div>
    </Protected>
  )
}
