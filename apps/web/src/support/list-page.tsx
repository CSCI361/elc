import {
  supportCaseListSchema,
  supportStatusSchema,
  supportIssueCategorySchema,
  supportCaseListQuerySchema,
} from "@elc/shared"
import { PlusIcon } from "@phosphor-icons/react"
import { useResource, segment } from "@/events/api"
import { useEventText } from "@/events/messages"
import { EventError, Loading, SelectField } from "@/events/ui"
import { Button } from "@/components/ui/button"
import { useSupportText } from "./messages"

export function SupportListPage() {
  const { locale, t } = useSupportText(),
    { t: eventText } = useEventText()
  const parameters = new URLSearchParams(window.location.search)
  const parsed = supportCaseListQuerySchema.safeParse(
    Object.fromEntries([...parameters].filter(([, value]) => value !== ""))
  )
  const query = parsed.success
    ? parsed.data
    : { view: "mine" as const, limit: 20 }
  const apiQuery = new URLSearchParams({ view: query.view, limit: "20" })
  for (const key of ["eventId", "status", "category", "cursor"] as const)
    if (key in query && query[key]) apiQuery.set(key, query[key]!)
  const result = useResource(
    `/support/cases?${apiQuery}`,
    supportCaseListSchema,
    10000
  )
  const page = (cursor?: string) => {
    const url = new URLSearchParams(parameters)
    url.delete("cursor")
    if (cursor) url.set("cursor", cursor)
    return `/support?${url}`
  }
  return (
    <div className="events-page support-page">
      <div className="event-page-heading">
        <h1>{t("title")}</h1>
        <a className="primary-link" href="/support/new">
          <PlusIcon aria-hidden />
          {t("newCase")}
        </a>
      </div>
      <form
        action="/support"
        method="get"
        className="support-filters event-panel"
      >
        {query.eventId ? (
          <input type="hidden" name="eventId" value={query.eventId} />
        ) : null}
        <SelectField name="view" label={t("view")} defaultValue={query.view}>
          {(["mine", "staff", "assigned"] as const).map((value) => (
            <option key={value} value={value}>
              {t(value)}
            </option>
          ))}
        </SelectField>
        <SelectField
          name="status"
          label={t("status")}
          defaultValue={query.status ?? ""}
        >
          <option value="">{t("all")}</option>
          {supportStatusSchema.options.map((value) => (
            <option key={value} value={value}>
              {t(value)}
            </option>
          ))}
        </SelectField>
        <SelectField
          name="category"
          label={t("category")}
          defaultValue={query.category ?? ""}
        >
          <option value="">{t("all")}</option>
          {supportIssueCategorySchema.options.map((value) => (
            <option key={value} value={value}>
              {t(value)}
            </option>
          ))}
        </SelectField>
        <Button type="submit">{t("filters")}</Button>
      </form>
      {result.error ? (
        <EventError error={result.error} retry={result.reload} />
      ) : !result.data ? (
        <Loading />
      ) : (
        <>
          <div className="support-list">
            {result.data.items.map((item) => (
              <a
                className="support-case-link"
                key={item.id}
                href={`/support/cases/${segment(item.id)}`}
              >
                <strong>{item.subject}</strong>
                <span>
                  {t(item.status)} · {t(item.category)}
                </span>
                <small>
                  {t(item.audience)} ·{" "}
                  <time dateTime={item.updatedAt}>
                    {new Intl.DateTimeFormat(locale, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(item.updatedAt))}
                  </time>
                </small>
              </a>
            ))}
          </div>
          {!result.data.items.length ? <p>{t("empty")}</p> : null}
          <div className="event-pagination">
            {query.cursor ? (
              <a className="text-action" href={page()}>
                {eventText("firstPage")}
              </a>
            ) : null}
            {result.data.nextCursor ? (
              <a className="text-action" href={page(result.data.nextCursor)}>
                {eventText("more")}
              </a>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
