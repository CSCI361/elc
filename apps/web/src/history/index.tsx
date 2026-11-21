import { Suspense } from "react"
import { preloadedPage } from "@/lib/preloaded-page"
import { useAccount } from "@/auth/context"
import { EventApiError } from "@/events/api"
import { EventError, Loading, Protected } from "@/events/ui"
import { historyRoute } from "./policies"
import { OrganizerEventLayout } from "@/events/organizer-workspace"
import "./history.css"
const HistoryListPage = preloadedPage(() =>
  import("./list-page").then((module) => module.HistoryListPage)
)
const HistoryTimelinePage = preloadedPage(() =>
  import("./timeline-page").then((module) => module.HistoryTimelinePage)
)
const HistoryDuplicatePage = preloadedPage(() =>
  import("./duplicate-page").then((module) => module.HistoryDuplicatePage)
)
export function HistoryRoute({ path }: { path: string }) {
  const { account } = useAccount(),
    route = historyRoute(path)
  return (
    <Protected>
      <Suspense fallback={<Loading />} key={`${path}:${account?.user.id}`}>
        {!route ? (
          <EventError error={new EventApiError("NOT_FOUND", 404)} />
        ) : route.kind === "list" ? (
          <HistoryListPage />
        ) : route.kind === "timeline" ? (
          <OrganizerEventLayout eventId={route.eventId}>
            <HistoryTimelinePage eventId={route.eventId} />
          </OrganizerEventLayout>
        ) : (
          <HistoryDuplicatePage eventId={route.eventId} />
        )}
      </Suspense>
    </Protected>
  )
}
