import { lazy, Suspense } from "react"
import { useAccount } from "@/auth/context"
import { EventApiError } from "@/events/api"
import { EventError, Loading, Protected } from "@/events/ui"
import "./support.css"
const SupportListPage = lazy(() =>
  import("./list-page").then((module) => ({ default: module.SupportListPage }))
)
const NewSupportPage = lazy(() =>
  import("./new-page").then((module) => ({ default: module.NewSupportPage }))
)
const SupportCasePage = lazy(() =>
  import("./case-page").then((module) => ({ default: module.SupportCasePage }))
)
const RefundPage = lazy(() =>
  import("./refund-panel").then((module) => ({ default: module.RefundPage }))
)
function MatchedSupportRoute({ path }: { path: string }) {
  if (path === "/support") return <SupportListPage />
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
