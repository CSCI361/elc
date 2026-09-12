import {
  checkoutResponseSchema,
  eventDetailResponseSchema,
  inventoryResponseSchema,
  startCheckoutSchema,
  type EventApi,
} from "@elc/shared"
import {
  ArrowLeftIcon,
  CalendarBlankIcon,
  MapPinIcon,
  MinusIcon,
} from "@phosphor-icons/react"
import { useState, type FormEvent } from "react"
import { useAccount } from "@/auth/context"
import { authHref } from "@/auth/navigation"
import { Button } from "@/components/ui/button"
import {
  EventApiError,
  segment,
  useCommand,
  useResource,
  useServerNow,
} from "./api"
import { useEventText } from "./messages"
import {
  dateText,
  money,
  purchasableSeats,
  selectedBasket,
  ticketSalesOpen,
  type Inventory,
  type Seat,
} from "./policies"
import { SeatMap } from "./seat-map"
import { EventError, Field, Loading } from "./ui"
import { CalendarActions } from "./exports"

function ReservationForm({
  event,
  inventory,
  refresh,
}: {
  event: EventApi
  inventory: Inventory
  refresh: () => void
}) {
  const { status, messages } = useAccount()
  const { locale, t } = useEventText()
  const [selected, setSelected] = useState<string[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [names, setNames] = useState<Record<string, string>>({})
  const [campaign, setCampaign] = useState(
    new URLSearchParams(window.location.search).get("campaign") ?? ""
  )
  const command = useCommand()
  const date = useServerNow()
  const seats = purchasableSeats(
    inventory,
    event.paidSalesState === "active",
    date
  )
  const assigned = event.seatingMode === "assigned"
  const count = assigned
    ? selected.length
    : Object.values(quantities).reduce((sum, value) => sum + value, 0)
  const selectedSeats = inventory.seats.filter((seat) =>
    selected.includes(seat.id)
  )
  const estimated = assigned
    ? selectedSeats.reduce((sum, seat) => sum + (seat.priceMinor ?? 0), 0)
    : inventory.ticketTypes.reduce(
        (sum, type) => sum + type.priceMinor * (quantities[type.id] ?? 0),
        0
      )
  function select(seat: Seat) {
    if (selected.includes(seat.id))
      setSelected((value) => value.filter((id) => id !== seat.id))
    else if (count < event.maxTicketsPerOrder)
      setSelected((value) => [...value, seat.id])
    else command.setError(new EventApiError("ORDER_LIMIT", 400))
  }
  async function submit(submission: FormEvent<HTMLFormElement>) {
    submission.preventDefault()
    try {
      const items = assigned
        ? selectedBasket(seats, selected, names)
        : inventory.ticketTypes
            .filter((type) => (quantities[type.id] ?? 0) > 0)
            .map((type) => ({
              ticketTypeId: type.id,
              quantity: quantities[type.id]!,
              attendeeNames: Array.from(
                { length: quantities[type.id]! },
                (_, index) => names[`${type.id}:${index}`] ?? ""
              ),
            }))
      if (count > event.maxTicketsPerOrder) throw new Error("INVALID_INPUT")
      const parsed = startCheckoutSchema.safeParse({
        requestId: "validate",
        eventId: event.id,
        items,
        ...(campaign.trim() ? { promoCode: campaign.trim() } : {}),
      })
      if (!parsed.success) throw new Error("INVALID_INPUT")
      const result = await command.send("/checkouts", checkoutResponseSchema, {
        eventId: event.id,
        items: parsed.data.items,
        ...(parsed.data.promoCode ? { promoCode: parsed.data.promoCode } : {}),
      })
      if (result) window.location.assign(`/orders/${segment(result.order.id)}`)
    } catch (error) {
      command.setError(
        new EventApiError(
          error instanceof Error && error.message === "INVENTORY_UNAVAILABLE"
            ? "INVENTORY_UNAVAILABLE"
            : "INVALID_INPUT",
          400
        )
      )
    }
  }
  const salesOpen =
    event.publicationState === "published" &&
    !event.cancelledAt &&
    !event.suspendedAt &&
    Date.parse(event.registrationOpensAt) <= date &&
    Date.parse(event.registrationClosesAt) > date &&
    Date.parse(event.startsAt) > date
  if (!salesOpen)
    return (
      <section className="event-panel">
        <h2>{t("selectTickets")}</h2>
        <p>{t("salesClosed")}</p>
      </section>
    )
  return (
    <section className="event-panel booking-panel">
      <h2>{t("selectTickets")}</h2>
      <p>{t("basketHint")}</p>
      <p className="field-hint">
        {t("orderLimit")}: {event.maxTicketsPerOrder}
      </p>
      {command.error ? (
        <EventError error={command.error} retry={refresh} />
      ) : null}
      <form onSubmit={submit}>
        <fieldset disabled={command.pending}>
          {assigned ? (
            <>
              {inventory.ticketTypes.some((type) => type.kind === "paid") &&
              event.paidSalesState !== "active" ? (
                <p className="field-hint">{t("paymentInactive")}</p>
              ) : null}
              <SeatMap
                seats={seats}
                selected={selected}
                onSelect={select}
                disabled={command.pending}
              />
            </>
          ) : (
            <div className="ticket-type-options">
              {inventory.ticketTypes.map((type) => (
                <div className="ticket-type-option" key={type.id}>
                  <div>
                    <h3>{type.name}</h3>
                    <p>{type.description}</p>
                    <strong>{money(type.priceMinor, locale)}</strong>
                    <small>
                      {t("available")}: {type.available}
                    </small>
                    {type.kind === "paid" &&
                    event.paidSalesState !== "active" ? (
                      <small>{t("paymentInactive")}</small>
                    ) : null}
                  </div>
                  <Field
                    label={`${t("quantity")} · ${type.name}`}
                    name={`quantity-${type.id}`}
                    type="number"
                    min={0}
                    max={Math.min(type.available, event.maxTicketsPerOrder)}
                    value={quantities[type.id] ?? 0}
                    disabled={
                      type.available === 0 ||
                      !ticketSalesOpen(
                        type,
                        event.paidSalesState === "active",
                        date
                      )
                    }
                    onChange={(change) => {
                      const next = Number(change.target.value)
                      if (
                        Number.isInteger(next) &&
                        next >= 0 &&
                        next <=
                          Math.min(type.available, event.maxTicketsPerOrder)
                      )
                        setQuantities((previous) => ({
                          ...previous,
                          [type.id]: next,
                        }))
                    }}
                  />
                </div>
              ))}
            </div>
          )}
          {assigned
            ? selectedSeats.map((seat) => (
                <div className="attendee-row" key={seat.id}>
                  <Field
                    label={`${t("attendee")} · ${seat.section} ${seat.row}${seat.number}`}
                    required
                    maxLength={200}
                    value={names[seat.id] ?? ""}
                    onChange={(change) =>
                      setNames((previous) => ({
                        ...previous,
                        [seat.id]: change.target.value,
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="seat-remove"
                    aria-label={`${t("removeSeat")} ${seat.section} ${seat.row}${seat.number}`}
                    onClick={() =>
                      setSelected((value) =>
                        value.filter((id) => id !== seat.id)
                      )
                    }
                  >
                    <MinusIcon size={20} aria-hidden />
                  </button>
                </div>
              ))
            : inventory.ticketTypes.flatMap((type) =>
                Array.from({ length: quantities[type.id] ?? 0 }, (_, index) => (
                  <Field
                    key={`${type.id}:${index}`}
                    label={`${t("attendee")} · ${type.name} ${index + 1}`}
                    required
                    maxLength={200}
                    value={names[`${type.id}:${index}`] ?? ""}
                    onChange={(change) =>
                      setNames((previous) => ({
                        ...previous,
                        [`${type.id}:${index}`]: change.target.value,
                      }))
                    }
                  />
                ))
              )}
          <Field
            label={t("campaign")}
            hint={t("campaignHint")}
            maxLength={128}
            autoComplete="off"
            value={campaign}
            onChange={(change) => setCampaign(change.target.value)}
          />
          <div className="basket-total">
            <span>{t("estimate")}</span>
            <strong>{money(estimated, locale)}</strong>
          </div>
          {status === "active" ? (
            <Button
              className="auth-button"
              type="submit"
              disabled={
                command.pending ||
                count === 0 ||
                count > event.maxTicketsPerOrder
              }
            >
              {command.pending ? t("loading") : t("reserve")}
            </Button>
          ) : (
            <a
              className="primary-link"
              href={authHref(
                "sign-in",
                `${window.location.pathname}${window.location.search}`
              )}
            >
              {messages.signIn}
            </a>
          )}
          {count === 0 ? <p className="field-hint">{t("selectHint")}</p> : null}
          {count > event.maxTicketsPerOrder ? (
            <p role="alert">{t("limit")}</p>
          ) : null}
        </fieldset>
      </form>
    </section>
  )
}

export function EventDetailPage({ eventId }: { eventId: string }) {
  const { locale, t } = useEventText()
  const detail = useResource(
    `/events/${segment(eventId)}`,
    eventDetailResponseSchema
  )
  const inventory = useResource(
    `/events/${segment(eventId)}/inventory`,
    inventoryResponseSchema,
    10000
  )
  if (!detail.data)
    return detail.error ? (
      <EventError error={detail.error} retry={detail.reload} />
    ) : (
      <Loading />
    )
  const { event } = detail.data
  return (
    <div className="events-page">
      <a className="back-link" href="/events">
        <ArrowLeftIcon size={18} aria-hidden />
        {t("discover")}
      </a>
      <div className="event-detail-heading">
        <div className="event-badges">
          <span>{event.category}</span>
          <span>{t(event.phase)}</span>
        </div>
        <h1>{event.title}</h1>
        <div className="event-meta">
          <span>
            <CalendarBlankIcon size={22} aria-hidden />
            {dateText(event.startsAt, event.timeZone, locale)}
          </span>
          <span>
            <MapPinIcon size={22} aria-hidden />
            {event.venueName}
          </span>
        </div>
      </div>
      <div className="event-detail-grid">
        <div>
          <section className="event-panel event-description">
            <h2>{t("details")}</h2>
            <p className="preserve-lines">{event.description}</p>
            <dl className="account-data">
              <div>
                <dt>{t("address")}</dt>
                <dd>{event.venueAddress}</dd>
              </div>
              <div>
                <dt>{t("ends")}</dt>
                <dd>{dateText(event.endsAt, event.timeZone, locale)}</dd>
              </div>
              <div>
                <dt>{t("timeZone")}</dt>
                <dd>{event.timeZone}</dd>
              </div>
            </dl>
          </section>
          <section className="event-panel">
            <h2>{t("refundPolicy")}</h2>
            <p>{t("refundHint")}</p>
            <p className="preserve-lines">{event.refundInstructions}</p>
          </section>
          <CalendarActions eventId={event.id} />
        </div>
        <div>
          {inventory.error ? (
            <EventError error={inventory.error} retry={inventory.reload} />
          ) : null}
          {inventory.data ? (
            <ReservationForm
              event={event}
              inventory={inventory.data}
              refresh={inventory.reload}
            />
          ) : inventory.loading ? (
            <Loading />
          ) : null}
        </div>
      </div>
    </div>
  )
}
