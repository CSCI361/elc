import { OfflineOperationsLink } from "@/offline-operations/navigation"
import { useRef, useState, type FormEvent } from "react"
import {
  accountAdministrationListSchema,
  eventAdministrationListSchema,
  platformAccessResponseSchema,
  type AccountAdministration,
  type EventAdministration,
} from "@elc/shared"
import { useAccount } from "../auth/context"
import { useResource } from "../events/api"
import {
  EventError,
  Field,
  Loading,
  Protected,
  SelectField,
} from "../events/ui"
import { useAdministrationText } from "./messages"
import {
  ActivationFeeSettings,
  PaidSalesModeration,
  SuspensionForm,
} from "./forms"
import "../analytics/analytics.css"
import "./administration.css"
import { OperationsRecords } from "./operations"

function Records({
  kind,
  accountId,
}: {
  kind: "accounts" | "events"
  accountId: string
}) {
  const { t } = useAdministrationText(),
    [q, setQ] = useState(""),
    [suspended, setSuspended] = useState("all"),
    [search, setSearch] = useState({ q: "", suspended: "all", after: "" }),
    [selected, setSelected] = useState<
      AccountAdministration | EventAdministration | null
    >(null),
    [saved, setSaved] = useState(false)
  const reviewButton = useRef<HTMLButtonElement | null>(null)
  const records = useRef<HTMLDivElement>(null)
  const parameters = new URLSearchParams({
    q: search.q,
    suspended: search.suspended,
    limit: "20",
  })
  if (search.after) parameters.set("after", search.after)
  const schema =
    kind === "accounts"
      ? accountAdministrationListSchema
      : eventAdministrationListSchema
  const resource = useResource<{
    items: (AccountAdministration | EventAdministration)[]
    nextCursor: string | null
  }>(`/admin/${kind}?${parameters}`, schema, 15000)
  const navigate = (after = "") => {
    setSelected(null)
    setSaved(false)
    setSearch({ ...search, after })
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    setSelected(null)
    setSaved(false)
    setSearch({ q, suspended, after: "" })
    resource.reload()
  }
  const denied = !!resource.error
  return (
    <>
      <form onSubmit={submit} className="event-panel">
        <Field
          label={t(kind === "accounts" ? "query" : "eventQuery")}
          maxLength={200}
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <SelectField
          label={t("filter")}
          value={suspended}
          onChange={(event) => setSuspended(event.target.value)}
        >
          <option value="all">{t("all")}</option>
          <option value="yes">{t("suspended")}</option>
          <option value="no">{t("active")}</option>
        </SelectField>
        <button className="primary-link" type="submit">
          {t("search")}
        </button>
      </form>
      {saved ? <p role="status">{t("saved")}</p> : null}
      {resource.error ? (
        <EventError
          error={resource.error}
          retry={() => {
            setSelected(null)
            resource.reload()
          }}
        />
      ) : !resource.data ? (
        <Loading />
      ) : (
        <>
          <div
            ref={records}
            className="analytics-table-region administration-table"
            tabIndex={0}
            role="region"
            aria-label={t(kind)}
          >
            <table>
              <caption>{t(kind)}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("name")}</th>
                  {kind === "accounts" ? (
                    <th scope="col">{t("email")}</th>
                  ) : null}
                  <th scope="col">{t("status")}</th>
                  <th scope="col">{t("action")}</th>
                </tr>
              </thead>
              <tbody>
                {resource.data.items.map((item) => (
                  <tr key={item.id}>
                    <th scope="row">
                      {"name" in item ? item.name : item.title}
                    </th>
                    {"email" in item ? <td>{item.email}</td> : null}
                    <td>{t(item.suspendedAt ? "suspended" : "active")}</td>
                    <td>
                      {kind === "events" ? (
                        <OfflineOperationsLink eventId={item.id} />
                      ) : null}
                      <button
                        type="button"
                        className="text-action"
                        disabled={kind === "accounts" && item.id === accountId}
                        title={
                          kind === "accounts" && item.id === accountId
                            ? t("self")
                            : undefined
                        }
                        onClick={(event) => {
                          reviewButton.current = event.currentTarget
                          setSelected(item)
                          setSaved(false)
                        }}
                      >
                        {t("review")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!resource.data.items.length ? <p>{t("empty")}</p> : null}
          <div className="analytics-actions">
            <button
              type="button"
              className="text-action"
              disabled={!search.after}
              onClick={() => navigate()}
            >
              {t("first")}
            </button>
            <button
              type="button"
              className="text-action"
              disabled={!resource.data.nextCursor}
              onClick={() => navigate(resource.data!.nextCursor!)}
            >
              {t("next")}
            </button>
          </div>
        </>
      )}
      {!denied && resource.data && selected ? (
        <>
          <SuspensionForm
            key={`${selected.id}:${selected.revision}`}
            kind={kind === "accounts" ? "account" : "event"}
            item={selected}
            onClose={() => {
              setSelected(null)
              reviewButton.current?.focus()
            }}
            onDone={() => {
              setSaved(true)
              setSelected(null)
              resource.reload()
              records.current?.focus()
            }}
          />
          {kind === "events" ? (
            <PaidSalesModeration key={selected.id} eventId={selected.id} />
          ) : null}
        </>
      ) : null}
    </>
  )
}
function Workspace({
  accountId,
  section,
}: {
  accountId: string
  section: "accounts" | "events" | "settings" | "operations"
}) {
  const { t } = useAdministrationText(),
    access = useResource("/admin/access", platformAccessResponseSchema, 15000)
  if (access.error)
    return <EventError error={access.error} retry={access.reload} />
  if (!access.data) return <Loading />
  const canModerate = access.data.permissions.includes("platform:moderate"),
    canConfigure = access.data.permissions.includes("platform:configure")
  return (
    <div className="events-page administration-page">
      <h1>{t("title")}</h1>
      <nav className="analytics-actions" aria-label={t("title")}>
        {canModerate ? (
          <>
            <a
              href="/admin/accounts"
              aria-current={section === "accounts" ? "page" : undefined}
            >
              {t("accounts")}
            </a>
            <a
              href="/admin/events"
              aria-current={section === "events" ? "page" : undefined}
            >
              {t("events")}
            </a>
            <a
              href="/admin/operations"
              aria-current={section === "operations" ? "page" : undefined}
            >
              {t("operations")}
            </a>
          </>
        ) : null}
        {canConfigure ? (
          <a
            href="/admin/settings"
            aria-current={section === "settings" ? "page" : undefined}
          >
            {t("settings")}
          </a>
        ) : null}
      </nav>
      {(section === "settings" ? canConfigure : canModerate) ? (
        section === "settings" ? (
          <ActivationFeeSettings />
        ) : section === "operations" ? (
          <OperationsRecords />
        ) : (
          <Records key={section} kind={section} accountId={accountId} />
        )
      ) : (
        <p role="alert">{t("denied")}</p>
      )}
    </div>
  )
}
export function AdministrationPage({
  section,
}: {
  section: "accounts" | "events" | "settings" | "operations"
}) {
  const { account } = useAccount()
  return (
    <Protected>
      {account ? (
        <Workspace
          key={account.user.id}
          accountId={account.user.id}
          section={section}
        />
      ) : null}
    </Protected>
  )
}
