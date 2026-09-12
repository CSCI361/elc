import { EventListPage } from "./list-page"
import { EventDetailPage } from "./detail-page"
import { EventEditorPage } from "./editor"
import { CheckoutPage } from "./checkout-page"
import { TicketPage } from "./ticket-page"
import { PaymentPage } from "./payment-page"
import { OrdersPage } from "./orders-page"
import { Protected } from "./ui"
import { EventError } from "./ui"
import { EventApiError } from "./api"
import "./events.css"

export function EventsRoute({ path }: { path: string }) {
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
  let id: string
  try {
    id = decodeURIComponent(parts.at(-1) ?? "")
  } catch {
    return <EventError error={new EventApiError("NOT_FOUND", 404)} />
  }
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
