import { lazy, Suspense } from "react"
import { useAccount } from "@/auth/context"
import { EventApiError } from "@/events/api"
import { EventError, Loading, Protected } from "@/events/ui"
import { historyRoute } from "./policies"
import "./history.css"
const HistoryListPage = lazy(() =>
  import("./list-page").then((module) => ({ default: module.HistoryListPage }))
)
const HistoryTimelinePage = lazy(() =>
  import("./timeline-page").then((module) => ({
    default: module.HistoryTimelinePage,
  }))
)
const HistoryDuplicatePage = lazy(() =>
  import("./duplicate-page").then((module) => ({
    default: module.HistoryDuplicatePage,
  }))
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
          <HistoryTimelinePage eventId={route.eventId} />
        ) : (
          <HistoryDuplicatePage eventId={route.eventId} />
        )}
      </Suspense>
    </Protected>
  )
}
