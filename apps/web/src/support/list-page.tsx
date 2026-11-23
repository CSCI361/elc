import {
  supportCaseListSchema,
  supportStatusSchema,
  supportIssueCategorySchema,
  supportCaseListQuerySchema,
} from "@elc/shared"
import { ChatsCircleIcon, PlusIcon } from "@phosphor-icons/react"
import { useResource, segment } from "@/events/api"
import { useEventText } from "@/events/messages"
import { Bar, SkeletonRegion } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { EventError, SelectField } from "@/events/ui"
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
  const filtered = (["eventId", "status", "category"] as const).some(
    (key) => key in query && query[key]
  )
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
      <form action="/support" method="get" className="support-filters">
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
        <SkeletonRegion label={eventText("loading")} className="support-list">
          {[0, 1, 2].map((row) => (
            <div key={row} className="support-case-link">
              <Bar width="40%" height={16} style={{ margin: "3px 0" }} />
              <Bar width="24%" height={14} style={{ margin: "4px 0" }} />
              <Bar width="30%" height={12} style={{ margin: "4px 0" }} />
            </div>
          ))}
        </SkeletonRegion>
      ) : (
        <>
          <div className="support-list" hidden={!result.data.items.length}>
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
          {!result.data.items.length ? (
            <EmptyState
              icon={ChatsCircleIcon}
              title={t("empty")}
              titleAs="h2"
              hint={filtered ? undefined : t("emptyHint")}
              action={
                filtered ? (
                  <a
                    className="btn btn-secondary"
                    href={`/support?view=${query.view}`}
                  >
                    {t("resetFilters")}
                  </a>
                ) : undefined
              }
            />
          ) : null}
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
