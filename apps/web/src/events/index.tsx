import { lazy, Suspense } from "react"
import { EventListPage } from "./list-page"
import { EventDetailPage } from "./detail-page"
import { Protected, EventError, Loading } from "./ui"
import { EventApiError } from "./api"
import "./events.css"

const EventEditorPage = lazy(() =>
  import("./editor").then((module) => ({ default: module.EventEditorPage }))
)
const CheckoutPage = lazy(() =>
  import("./checkout-page").then((module) => ({ default: module.CheckoutPage }))
)
const TicketPage = lazy(() =>
  import("./ticket-page").then((module) => ({ default: module.TicketPage }))
)
const PaymentPage = lazy(() =>
  import("./payment-page").then((module) => ({ default: module.PaymentPage }))
)
const OrdersPage = lazy(() =>
  import("./orders-page").then((module) => ({ default: module.OrdersPage }))
)
const EventAccessPage = lazy(() =>
  import("@/access/owner-page").then((module) => ({
    default: module.EventAccessPage,
  }))
)
const CampaignPage = lazy(() =>
  import("@/campaigns/page").then((module) => ({
    default: module.CampaignPage,
  }))
)
const OrganizerRecordsPage = lazy(() =>
  import("@/organizer-records/page").then((module) => ({
    default: module.OrganizerRecordsPage,
  }))
)

export function EventsRoute({ path }: { path: string }) {
  return (
    <Suspense fallback={<Loading />}>
      <MatchedEventRoute path={path} />
    </Suspense>
  )
}

function MatchedEventRoute({ path }: { path: string }) {
  if (path === "/" || path === "/events") return <EventListPage />
  if (path === "/organizer/events")
    return (
      <Protected>
        <EventListPage organizer />
      </Protected>
    )
  if (path === "/organizer/events/new")
    return (
      <Protected>
        <EventEditorPage />
      </Protected>
    )
  if (path === "/orders")
    return (
      <Protected>
        <OrdersPage />
      </Protected>
    )
  if (path === "/payments/return") {
    const attempt = new URLSearchParams(window.location.search).get("attempt")
    return attempt ? (
      <Protected>
        <PaymentPage attemptId={attempt} />
      </Protected>
    ) : (
      <EventError error={new EventApiError("NOT_FOUND", 404)} />
    )
  }
  const parts = path.split("/").filter(Boolean)
  const accessPath =
    parts.length === 4 &&
    parts[0] === "organizer" &&
    parts[1] === "events" &&
    parts[3] === "access"
  const campaignPath =
    parts.length === 4 &&
    parts[0] === "organizer" &&
    parts[1] === "events" &&
    parts[3] === "campaigns"
  const recordsPath =
    parts.length === 4 &&
    parts[0] === "organizer" &&
    parts[1] === "events" &&
    parts[3] === "registrations"
  let id: string
  try {
    id = decodeURIComponent(
      (accessPath || campaignPath || recordsPath ? parts[2] : parts.at(-1)) ??
        ""
    )
  } catch {
    return <EventError error={new EventApiError("NOT_FOUND", 404)} />
  }
  if (accessPath)
    return (
      <Protected>
        <EventAccessPage eventId={id} />
      </Protected>
    )
  if (campaignPath)
    return (
      <Protected>
        <CampaignPage eventId={id} />
      </Protected>
    )
  if (recordsPath)
    return (
      <Protected>
        <OrganizerRecordsPage eventId={id} />
      </Protected>
    )
  if (parts.length === 2 && parts[0] === "events")
    return <EventDetailPage eventId={id} />
  if (parts.length === 3 && parts[0] === "organizer" && parts[1] === "events")
    return (
      <Protected>
        <EventEditorPage eventId={id} />
      </Protected>
    )
  if (parts.length === 2 && parts[0] === "orders")
    return (
      <Protected>
        <CheckoutPage orderId={id} />
      </Protected>
    )
  if (parts.length === 2 && parts[0] === "tickets")
    return (
      <Protected>
        <TicketPage ticketId={id} />
      </Protected>
    )
  if (parts.length === 2 && parts[0] === "payments")
    return (
      <Protected>
        <PaymentPage attemptId={id} />
      </Protected>
    )
  return null
}
