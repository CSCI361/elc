import { Suspense } from "react"
import { preloadedPage } from "@/lib/preloaded-page"
import { EventListPage } from "./list-page"
import { EventDetailPage } from "./detail-page"
import { Protected, EventError, Loading } from "./ui"
import { EventApiError } from "./api"
import { OrganizerEventLayout } from "./organizer-workspace"
import "./events.css"

const EventEditorPage = preloadedPage(() =>
  import("./editor").then((module) => module.EventEditorPage)
)
const CheckoutPage = preloadedPage(() =>
  import("./checkout-page").then((module) => module.CheckoutPage)
)
const TicketPage = preloadedPage(() =>
  import("./ticket-page").then((module) => module.TicketPage)
)
const PaymentPage = preloadedPage(() =>
  import("./payment-page").then((module) => module.PaymentPage)
)
const OrdersPage = preloadedPage(() =>
  import("./orders-page").then((module) => module.OrdersPage)
)
const EventAccessPage = preloadedPage(() =>
  import("@/access/owner-page").then((module) => module.EventAccessPage)
)
const CampaignPage = preloadedPage(() =>
  import("@/campaigns/page").then((module) => module.CampaignPage)
)
const OrganizerRecordsPage = preloadedPage(() =>
  import("@/organizer-records/page").then(
    (module) => module.OrganizerRecordsPage
  )
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
        <OrganizerEventLayout eventId={id}>
          <EventAccessPage eventId={id} />
        </OrganizerEventLayout>
      </Protected>
    )
  if (campaignPath)
    return (
      <Protected>
        <OrganizerEventLayout eventId={id}>
          <CampaignPage eventId={id} />
        </OrganizerEventLayout>
      </Protected>
    )
  if (recordsPath)
    return (
      <Protected>
        <OrganizerEventLayout eventId={id}>
          <OrganizerRecordsPage eventId={id} />
        </OrganizerEventLayout>
      </Protected>
    )
  if (parts.length === 2 && parts[0] === "events")
    return <EventDetailPage eventId={id} />
  if (parts.length === 3 && parts[0] === "organizer" && parts[1] === "events")
    return (
      <Protected>
        <OrganizerEventLayout eventId={id}>
          <EventEditorPage eventId={id} />
        </OrganizerEventLayout>
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
