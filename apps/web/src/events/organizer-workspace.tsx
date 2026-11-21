import {
  eventDetailResponseSchema,
  eventMutationResponseSchema,
  type EventApi,
} from "@elc/shared"
import { ArrowLeftIcon, ArrowUpRightIcon } from "@phosphor-icons/react"
import { Suspense, type ReactNode } from "react"
import { useAccessText } from "@/access/messages"
import { useAnalyticsText } from "@/analytics/messages"
import { useAccount } from "@/auth/context"
import { Button } from "@/components/ui/button"
import { ChipRow } from "@/components/ui/chip-row"
import { Bar, SkeletonRegion } from "@/components/ui/skeleton"
import { useHistoryText } from "@/history/messages"
import { duplicateHref, eventHistoryHref } from "@/history/policies"
import { useLocation } from "@/lib/navigation"
import { useOfflineText } from "@/offline-operations/messages"
import { offlineHref } from "@/offline-operations/policies"
import { usePayoutText } from "@/payouts/messages"
import { useSupportText } from "@/support/messages"
import { supportHref } from "@/support/policies"
import { segment, useCommand, useResource } from "./api"
import { useImageText } from "./image-messages"
import { useEventText } from "./messages"
import { WorkspaceContext, type EventDetail } from "./workspace-context"
import { EventError, Loading } from "./ui"
import "./organizer.css"

function useEventTabs(event: EventApi) {
  const { account } = useAccount()
  const { t } = useEventText()
  const { t: analyticsText } = useAnalyticsText()
  const { t: historyText } = useHistoryText()
  const { t: offlineText } = useOfflineText()
  const { t: payoutText } = usePayoutText()
  const { t: accessText } = useAccessText()
  const { t: supportText } = useSupportText()
  const id = segment(event.id)
  const owner = account?.user.id === event.organizerId
  return [
    { href: `/organizer/events/${id}`, label: t("editEvent") },
    {
      href: `/organizer/events/${id}/registrations`,
      label: t("registrations"),
    },
    { href: `/organizer/events/${id}/campaigns`, label: t("campaigns") },
    ...(owner
      ? [
          { href: `/events/${id}/analytics`, label: analyticsText("title") },
          { href: eventHistoryHref(event.id), label: historyText("timeline") },
          { href: offlineHref(event.id), label: offlineText("title") },
        ]
      : []),
    { href: `/organizer/events/${id}/payouts`, label: payoutText("title") },
    ...(owner
      ? [{ href: `/organizer/events/${id}/access`, label: accessText("title") }]
      : []),
    { href: `/support?view=staff&eventId=${id}`, label: supportText("title") },
  ]
}

function OrganizerEventTabs({ event }: { event: EventApi }) {
  const { t } = useEventText()
  const { pathname } = useLocation()
  return (
    <ChipRow label={t("eventSections")} className="tabs-row">
      {useEventTabs(event).map((tab) => (
        <a
          key={tab.href}
          href={tab.href}
          aria-current={
            tab.href.split("?")[0] === pathname ? "page" : undefined
          }
        >
          {tab.label}
        </a>
      ))}
    </ChipRow>
  )
}

export function OrganizerBackLink() {
  const { t } = useEventText()
  return (
    <a className="back-link" href="/organizer/events">
      <ArrowLeftIcon size={18} aria-hidden />
      {t("organize")}
    </a>
  )
}

function HeaderActions({
  detail,
  stale,
  reload,
}: {
  detail: EventDetail
  stale: boolean
  reload: () => void
}) {
  const { event, ticketTypes } = detail
  const { account } = useAccount()
  const { t } = useEventText()
  const { t: imageText } = useImageText()
  const { t: supportText } = useSupportText()
  const { t: historyText } = useHistoryText()
  const command = useCommand()
  const published = event.publicationState === "published"
  const id = segment(event.id)
  return (
    <div className="organizer-heading-actions">
      {event.suspendedAt === null &&
      (event.cancelledAt !== null || event.phase === "completed") ? (
        <a className="btn btn-secondary" href={duplicateHref(event.id)}>
          {historyText("duplicate")}
        </a>
      ) : null}
      {account?.user.id === event.organizerId && !event.cancelledAt ? (
        <a
          className="btn btn-ghost"
          href={supportHref({
            eventId: event.id,
            audience: "organizer_platform",
            category: "activation",
          })}
        >
          {supportText("organizer_platform")}
        </a>
      ) : null}
      {event.cancelledAt ? null : (
        <a className="btn btn-secondary" href={`/events/${id}?preview=true`}>
          {imageText("previewEvent")}
          <ArrowUpRightIcon size={16} aria-hidden />
        </a>
      )}
      {published ? (
        <a className="btn btn-secondary" href={`/events/${id}`}>
          {t("details")}
          <ArrowUpRightIcon size={16} aria-hidden />
        </a>
      ) : null}
      {event.cancelledAt ? null : (
        <Button
          variant={published ? "outline" : "default"}
          disabled={
            command.pending || stale || (!published && ticketTypes.length === 0)
          }
          onClick={() => {
            void command
              .send(
                `/events/${id}/${published ? "unpublish" : "publish"}`,
                eventMutationResponseSchema,
                { expectedRevision: event.revision }
              )
              .then((result) => {
                if (result) reload()
              })
          }}
        >
          {t(published ? "unpublish" : "publish")}
        </Button>
      )}
      {command.error ? (
        <EventError error={command.error} retry={reload} />
      ) : null}
    </div>
  )
}

function HeaderSkeleton() {
  const { t } = useEventText()
  return (
    <SkeletonRegion label={t("loading")} className="organizer-header-skeleton">
      <Bar width="36%" height={34} />
      <Bar width={160} height={22} radius={6} style={{ marginTop: 10 }} />
      <Bar width="100%" height={41} radius={0} style={{ marginTop: 12 }} />
    </SkeletonRegion>
  )
}

export function OrganizerEventLayout({
  eventId,
  children,
}: {
  eventId: string
  children: ReactNode
}) {
  const { t } = useEventText()
  const resource = useResource(
    `/events/${segment(eventId)}/preview`,
    eventDetailResponseSchema,
    15000
  )
  const detail = resource.data
  const event = detail?.event
  const published = event?.publicationState === "published"
  return (
    <WorkspaceContext
      value={{
        detail,
        error: resource.error,
        reload: resource.reload,
        update: resource.update,
      }}
    >
      <div className="events-page organizer-workspace">
        <header className="organizer-workspace-header">
          <OrganizerBackLink />
          {detail && event ? (
            <>
              <div className="organizer-heading">
                <div>
                  <p className="organizer-workspace-title">{event.title}</p>
                  <div className="event-badges">
                    <span
                      className={`badge ${published ? "badge-success" : "badge-warning"}`}
                    >
                      {t(event.publicationState)}
                    </span>
                    {event.cancelledAt ? (
                      <span className="badge badge-danger">
                        {t("cancelled")}
                      </span>
                    ) : (
                      <span className="badge">{t(event.phase)}</span>
                    )}
                  </div>
                </div>
                <HeaderActions
                  detail={detail}
                  stale={!resource.data || resource.refreshing}
                  reload={resource.reload}
                />
              </div>
              <OrganizerEventTabs event={event} />
            </>
          ) : resource.loading ? (
            <HeaderSkeleton />
          ) : null}
        </header>
        <Suspense fallback={<Loading />}>{children}</Suspense>
      </div>
    </WorkspaceContext>
  )
}
