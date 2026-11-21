import { useRef, useState } from "react"
import {
  DeviceMobileIcon,
  QrCodeIcon,
  WifiSlashIcon,
} from "@phosphor-icons/react"
import { EmptyState } from "@/components/ui/empty-state"
import {
  offlineAccessSchema,
  offlineDevicesSchema,
  offlineEventsSchema,
  reportedOfflineAdmissionsSchema,
} from "@elc/shared"
import { useAccount } from "@/auth/context"
import { useResource } from "@/events/api"
import { EventError, SectionLoading, Protected } from "@/events/ui"
import { supportHref } from "@/support/policies"
import { createOfflineCommands, type OfflineCommands } from "./commands"
import { DeviceCard, AdmissionCard } from "./cards"
import { useOfflineText } from "./messages"
import { offlineHref, offlineListPath } from "./policies"
import "./offline.css"

function Pagination({
  cursor,
  next,
  change,
}: {
  cursor: string
  next: string | null
  change: (cursor: string) => void
}) {
  const { t } = useOfflineText()
  if (!cursor && !next) return null
  return (
    <nav className="offline-actions" aria-label={t("pagination")}>
      <button
        className="text-action"
        type="button"
        disabled={!cursor}
        onClick={() => change("")}
      >
        {t("first")}
      </button>
      <button
        className="text-action"
        type="button"
        disabled={!next}
        onClick={() => change(next!)}
      >
        {t("next")}
      </button>
    </nav>
  )
}
function AvailableEvents() {
  const { t } = useOfflineText()
  const [cursor, setCursor] = useState("")
  const heading = useRef<HTMLHeadingElement>(null)
  const params = new URLSearchParams({ limit: "20" })
  if (cursor) params.set("cursor", cursor)
  const resource = useResource(
    `/offline/events?${params}`,
    offlineEventsSchema,
    15000
  )
  return (
    <div className="events-page offline-page">
      <div className="event-page-heading">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {t("title")}
          </h1>
          <p>{t("intro")}</p>
        </div>
        <button type="button" className="text-action" onClick={resource.reload}>
          {t("reload")}
        </button>
      </div>
      {resource.error ? (
        <EventError error={resource.error} retry={resource.reload} />
      ) : !resource.data ? (
        <SectionLoading />
      ) : (
        <>
          {resource.data.items.some(
            (item) => !item.capabilities.manageDevices
          ) ? (
            <p className="field-hint">{t("ownDevices")}</p>
          ) : null}
          {!resource.data.items.length ? (
            <EmptyState
              icon={WifiSlashIcon}
              title={t("emptyEvents")}
              hint={t("emptyEventsHint")}
              action={
                <a className="btn btn-primary" href="/organizer/events/new">
                  {t("createEvent")}
                </a>
              }
            />
          ) : (
            <ul className="offline-event-list" aria-label={t("events")}>
              {resource.data.items.map((item) => (
                <li className="event-panel" key={item.event.id}>
                  <h2>
                    <a href={offlineHref(item.event.id)}>{item.event.title}</a>
                  </h2>
                  <p>
                    {item.capabilities.manageDevices
                      ? t("devices")
                      : t("yourDevices")}
                    {item.capabilities.reviewAdmissions
                      ? ` · ${t("admissions")}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Pagination
            cursor={cursor}
            next={resource.data.nextCursor}
            change={(value) => {
              setCursor(value)
              heading.current?.focus()
            }}
          />
        </>
      )}
    </div>
  )
}
function Devices({
  eventId,
  manage,
  commands,
  refreshAccess,
}: {
  eventId: string
  manage: boolean
  commands: OfflineCommands
  refreshAccess: () => void
}) {
  const { t } = useOfflineText()
  const [cursor, setCursor] = useState("")
  const heading = useRef<HTMLHeadingElement>(null)
  const resource = useResource(
    offlineListPath(eventId, "devices", cursor),
    offlineDevicesSchema,
    15000
  )
  const reload = () => {
    resource.reload()
    refreshAccess()
    heading.current?.focus()
  }
  return (
    <section className="offline-section" aria-label={t("devices")}>
      <header className="offline-section-heading">
        <h2 tabIndex={-1} ref={heading}>
          {t("devices")}
        </h2>
        <button type="button" className="text-action" onClick={reload}>
          {t("reload")}
        </button>
      </header>
      {!manage ? <p>{t("ownDevices")}</p> : null}
      {resource.error ? (
        <>
          <p>{t("unavailable")}</p>
          <EventError error={resource.error} retry={reload} />
        </>
      ) : !resource.data ? (
        <SectionLoading />
      ) : (
        <>
          {!resource.data.items.length ? (
            <EmptyState
              icon={DeviceMobileIcon}
              title={t("emptyDevices")}
              hint={t("emptyDevicesHint")}
            />
          ) : (
            resource.data.items.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                manage={manage}
                commands={commands}
                reload={reload}
              />
            ))
          )}
          <Pagination
            cursor={cursor}
            next={resource.data.nextCursor}
            change={(value) => {
              setCursor(value)
              heading.current?.focus()
            }}
          />
        </>
      )}
    </section>
  )
}
function Admissions({
  eventId,
  commands,
  refreshAccess,
}: {
  eventId: string
  commands: OfflineCommands
  refreshAccess: () => void
}) {
  const { t } = useOfflineText()
  const [cursor, setCursor] = useState("")
  const heading = useRef<HTMLHeadingElement>(null)
  const resource = useResource(
    offlineListPath(eventId, "admissions", cursor),
    reportedOfflineAdmissionsSchema,
    15000
  )
  const reload = () => {
    resource.reload()
    refreshAccess()
    heading.current?.focus()
  }
  return (
    <section className="offline-section" aria-label={t("admissions")}>
      <header className="offline-section-heading">
        <h2 tabIndex={-1} ref={heading}>
          {t("admissions")}
        </h2>
        <button type="button" className="text-action" onClick={reload}>
          {t("reload")}
        </button>
      </header>
      <p>{t("reviewHint")}</p>
      {resource.error ? (
        <>
          <p>{t("unavailable")}</p>
          <EventError error={resource.error} retry={reload} />
        </>
      ) : !resource.data ? (
        <SectionLoading />
      ) : (
        <>
          {!resource.data.items.length ? (
            <EmptyState
              icon={QrCodeIcon}
              title={t("emptyReports")}
              hint={t("emptyReportsHint")}
            />
          ) : (
            resource.data.items.map((report) => (
              <AdmissionCard
                key={report.operationId}
                report={report}
                commands={commands}
                reload={reload}
              />
            ))
          )}
          <Pagination
            cursor={cursor}
            next={resource.data.nextCursor}
            change={(value) => {
              setCursor(value)
              heading.current?.focus()
            }}
          />
        </>
      )}
    </section>
  )
}
function Workspace({ eventId }: { eventId: string }) {
  const { t } = useOfflineText()
  const [commands] = useState(createOfflineCommands)
  const access = useResource(
    `/events/${encodeURIComponent(eventId)}/offline/access`,
    offlineAccessSchema,
    15000
  )
  return (
    <div className="events-page offline-page">
      {access.error ? (
        <>
          <h1>{t("title")}</h1>
          <p>{t("unavailable")}</p>
          <EventError error={access.error} retry={access.reload} />
        </>
      ) : !access.data ? (
        <SectionLoading />
      ) : (
        <>
          <header className="event-page-heading">
            <div>
              <h1>{t("title")}</h1>
            </div>
            <button
              type="button"
              className="text-action"
              onClick={access.reload}
            >
              {t("reload")}
            </button>
          </header>
          <p className="offline-notice">{t("provisional")}</p>
          <p>{t("lossHint")}</p>
          <nav className="offline-actions" aria-label={t("support")}>
            {access.data.capabilities.openIncident ? (
              <a
                className="secondary-link"
                href={supportHref({
                  eventId,
                  audience: "organizer_platform",
                  category: "technical",
                })}
              >
                {t("incident")}
              </a>
            ) : null}
            <a href="/support" className="text-action">
              {t("support")}
            </a>
          </nav>
          <div className="offline-grid">
            <Devices
              key={`devices:${access.data.capabilities.manageDevices}`}
              eventId={eventId}
              manage={access.data.capabilities.manageDevices}
              commands={commands}
              refreshAccess={access.reload}
            />
            {access.data.capabilities.reviewAdmissions ? (
              <Admissions
                eventId={eventId}
                commands={commands}
                refreshAccess={access.reload}
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
export function OfflineOperationsPage({ eventId }: { eventId?: string }) {
  const { account } = useAccount()
  return (
    <Protected>
      {account ? (
        eventId ? (
          <Workspace key={`${account.user.id}:${eventId}`} eventId={eventId} />
        ) : (
          <AvailableEvents key={account.user.id} />
        )
      ) : null}
    </Protected>
  )
}
