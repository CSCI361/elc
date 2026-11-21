import { Suspense } from "react"
import { preloadedPage } from "@/lib/preloaded-page"
import { useAccount } from "@/auth/context"
import { EventApiError } from "@/events/api"
import { OrganizerEventLayout } from "@/events/organizer-workspace"
import { EventError, Loading, Protected } from "@/events/ui"
import "./support.css"
const SupportListPage = preloadedPage(() =>
  import("./list-page").then((module) => module.SupportListPage)
)
const NewSupportPage = preloadedPage(() =>
  import("./new-page").then((module) => module.NewSupportPage)
)
const SupportCasePage = preloadedPage(() =>
  import("./case-page").then((module) => module.SupportCasePage)
)
const RefundPage = preloadedPage(() =>
  import("./refund-panel").then((module) => module.RefundPage)
)
function MatchedSupportRoute({ path }: { path: string }) {
  if (path === "/support") {
    const eventId = new URLSearchParams(window.location.search).get("eventId")
    return eventId ? (
      <OrganizerEventLayout eventId={eventId}>
        <SupportListPage />
      </OrganizerEventLayout>
    ) : (
      <SupportListPage />
    )
  }
  if (path === "/support/new") return <NewSupportPage />
  let id: string
  try {
    id = decodeURIComponent(
      path.split("/")[path.startsWith("/orders/") ? 2 : 3] ?? ""
    )
  } catch {
    return <EventError error={new EventApiError("NOT_FOUND", 404)} />
  }
  return path.startsWith("/orders/") ? (
    <RefundPage orderId={id} />
  ) : (
    <SupportCasePage caseId={id} />
  )
}
export function SupportRoute({ path }: { path: string }) {
  const { account } = useAccount()
  return (
    <Protected>
      <Suspense fallback={<Loading />}>
        <MatchedSupportRoute key={`${path}:${account?.user.id}`} path={path} />
      </Suspense>
    </Protected>
  )
}
