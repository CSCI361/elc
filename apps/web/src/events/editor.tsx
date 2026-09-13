import {
  createEventRequestSchema,
  createTicketTypeRequestSchema,
  demoVenue,
  eventDetailResponseSchema,
  eventMutationResponseSchema,
  inventoryResponseSchema,
  policy,
  type EventApi,
  type CreateEvent,
} from "@elc/shared"
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  PlusIcon,
} from "@phosphor-icons/react"
import { useState, type FormEvent } from "react"
import { useAccount } from "@/auth/context"
import { useAccessText } from "@/access/messages"
import { useSupportText } from "@/support/messages"
import { usePayoutText } from "@/payouts/messages"
import { useHistoryText } from "@/history/messages"
import { useAnalyticsText } from "@/analytics/messages"
import { duplicateHref, eventHistoryHref } from "@/history/policies"
import { supportHref } from "@/support/policies"
import { CancellationPanel } from "@/support/cancellation-panel"
import { CalendarActions } from "./exports"
import { EventImagePanel, ImageDraftHint } from "./image-panel"
import { useImageText } from "./image-messages"
import { Button } from "@/components/ui/button"
import { EventApiError, segment, useCommand, useResource } from "./api"
import { useEventText } from "./messages"
import {
  dateFromInput,
  dateInput,
  money,
  parsePrice,
  type Inventory,
} from "./policies"
import { SeatMap } from "./seat-map"
import { ActivationPanel } from "./activation-panel"
import { EventError, Field, Loading, SelectField, TextArea } from "./ui"

type EventDetail = ReturnType<typeof eventDetailResponseSchema.parse>
type TicketType = EventDetail["ticketTypes"][number]
function initialEvent(): CreateEvent {
  const now = Date.now()
  const start = now + 7 * 86400000
  return {
    title: "",
    description: "",
    category: "",
    venueName: "",
    venueAddress: "",
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 7200000).toISOString(),
    timeZone: policy.defaultTimeZone,
    visibility: "public",
    seatingMode: "general_admission",
    capacity: 100,
    registrationOpensAt: new Date(now - 60000).toISOString(),
    registrationClosesAt: new Date(start - 3600000).toISOString(),
    maxTicketsPerOrder: 6,
  }
}

function EventForm({
  detail,
  onSaved,
}: {
  detail?: EventDetail
  onSaved?: () => void
}) {
  const { t } = useEventText()
  const [initial] = useState(() => detail?.event ?? initialEvent())
  const [seating, setSeating] = useState(initial.seatingMode)
  const command = useCommand()
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const value = (key: string) => {
      const input = form.get(key)
      return typeof input === "string" ? input : ""
    }
    const fields = {
      title: value("title"),
      description: value("description"),
      category: value("category"),
      venueName: value("venueName"),
      venueAddress: value("venueAddress"),
      startsAt: dateFromInput(value("startsAt"), initial.timeZone),
      endsAt: dateFromInput(value("endsAt"), initial.timeZone),
      registrationOpensAt: dateFromInput(
        value("registrationOpensAt"),
        initial.timeZone
      ),
      registrationClosesAt: dateFromInput(
        value("registrationClosesAt"),
        initial.timeZone
      ),
      timeZone: initial.timeZone,
      visibility: value("visibility"),
      seatingMode: seating,
      capacity:
        seating === "assigned" ? demoVenue.capacity : Number(value("capacity")),
      maxTicketsPerOrder: Number(value("maxTicketsPerOrder")),
      refundInstructions: value("refundInstructions"),
      ...(seating === "assigned" ? { venueLayoutId: demoVenue.id } : {}),
    }
    const parsed = createEventRequestSchema.safeParse({
      ...fields,
      requestId: "validate",
    })
    if (!parsed.success) {
      command.setError(new EventApiError("INVALID_INPUT", 400))
      return
    }
    const body = {
      ...fields,
      ...(detail ? { expectedRevision: detail.event.revision } : {}),
    }
    const result = await command.send(
      detail ? `/events/${segment(detail.event.id)}` : "/events",
      eventMutationResponseSchema,
      body,
      detail ? "PATCH" : "POST"
    )
    if (result) {
      if (onSaved) onSaved()
      else
        window.location.assign(`/organizer/events/${segment(result.eventId)}`)
    }
  }
  return (
    <section className="event-panel">
      <h2>{t(detail ? "editEvent" : "newEvent")}</h2>
      {command.error ? (
        <EventError error={command.error} retry={onSaved} />
      ) : null}
      <form onSubmit={submit}>
        <fieldset disabled={command.pending}>
          <Field
            label={t("title")}
            name="title"
            required
            maxLength={200}
            defaultValue={initial.title}
          />
          <TextArea
            label={t("description")}
            name="description"
            rows={5}
            required
            maxLength={20000}
            defaultValue={initial.description}
          />
          <div className="event-form-grid">
            <Field
              label={t("category")}
              name="category"
              required
              maxLength={80}
              defaultValue={initial.category}
            />
            <Field
              label={t("venue")}
              name="venueName"
              required
              maxLength={200}
              defaultValue={initial.venueName}
            />
          </div>
          <Field
            label={t("address")}
            name="venueAddress"
            required
            maxLength={500}
            defaultValue={initial.venueAddress}
          />
          <p className="event-zone">
            {t("timeZone")}: <strong>{initial.timeZone}</strong>
          </p>
          <div className="event-form-grid">
            {(
              [
                "startsAt",
                "endsAt",
                "registrationOpensAt",
                "registrationClosesAt",
              ] as const
            ).map((key, index) => (
              <Field
                key={key}
                label={t(
                  (
                    [
                      "starts",
                      "ends",
                      "registrationOpens",
                      "registrationCloses",
                    ] as const
                  )[index]!
                )}
                name={key}
                type="datetime-local"
                required
                defaultValue={dateInput(initial[key], initial.timeZone)}
              />
            ))}
          </div>
          <div className="event-form-grid">
            <SelectField
              label={t("seating")}
              value={seating}
              disabled={Boolean(detail?.ticketTypes.length)}
              onChange={(event) =>
                setSeating(
                  event.target.value === "assigned"
                    ? "assigned"
                    : "general_admission"
                )
              }
            >
              <option value="general_admission">
                {t("general_admission")}
              </option>
              <option value="assigned">{t("assigned")}</option>
            </SelectField>
            <Field
              label={t("capacity")}
              name="capacity"
              type="number"
              min={1}
              max={100000}
              required
              disabled={seating === "assigned"}
              key={seating}
              defaultValue={
                seating === "assigned" ? demoVenue.capacity : initial.capacity
              }
            />
            <Field
              label={t("orderLimit")}
              name="maxTicketsPerOrder"
              type="number"
              min={1}
              max={100}
              required
              defaultValue={initial.maxTicketsPerOrder}
            />
            <SelectField
              label={t("visibility")}
              name="visibility"
              defaultValue={initial.visibility}
            >
              <option value="public">{t("public")}</option>
              <option value="unlisted">{t("unlisted")}</option>
              <option value="private">{t("private")}</option>
            </SelectField>
          </div>
          <p className="field-hint">{t("privateHint")}</p>
          <TextArea
            label={t("refundInstructions")}
            name="refundInstructions"
            rows={3}
            maxLength={4000}
            defaultValue={detail?.event.refundInstructions ?? ""}
          />
          <Button type="submit" className="auth-button">
            {command.pending ? t("loading") : t(detail ? "save" : "newEvent")}
          </Button>
        </fieldset>
      </form>
    </section>
  )
}

function TicketTypeForm({
  event,
  type,
  onSaved,
}: {
  event: EventApi
  type?: TicketType
  onSaved: () => void
}) {
  const { t } = useEventText()
  const command = useCommand()
  const [kind, setKind] = useState(type?.kind ?? "free")
  async function submit(submission: FormEvent<HTMLFormElement>) {
    submission.preventDefault()
    const form = new FormData(submission.currentTarget)
    const value = (key: string) => {
      const input = form.get(key)
      return typeof input === "string" ? input : ""
    }
    const body = {
      eventId: event.id,
      name: value("name"),
      description: value("description"),
      kind,
      priceMinor: kind === "free" ? 0 : parsePrice(value("price")),
      currency: "KZT",
      quantity:
        event.seatingMode === "assigned" && type
          ? type.quantity
          : Number(value("quantity")),
      salesStartAt: dateFromInput(value("salesStartAt"), event.timeZone),
      salesEndAt: dateFromInput(value("salesEndAt"), event.timeZone),
      hidden: form.get("hidden") === "on",
      expectedRevision: event.revision,
    }
    if (
      !createTicketTypeRequestSchema.safeParse({
        ...body,
        requestId: "validate",
      }).success
    ) {
      command.setError(new EventApiError("INVALID_INPUT", 400))
      return
    }
    const result = await command.send(
      `/events/${segment(event.id)}/ticket-types${type ? `/${segment(type.id)}` : ""}`,
      eventMutationResponseSchema,
      body,
      type ? "PATCH" : "POST"
    )
    if (result) onSaved()
  }
  return (
    <form className="ticket-type-form" onSubmit={submit}>
      {command.error ? (
        <EventError error={command.error} retry={onSaved} />
      ) : null}
      <fieldset disabled={command.pending}>
        <Field
          label={t("ticketName")}
          name="name"
          required
          maxLength={100}
          defaultValue={type?.name ?? ""}
        />
        <TextArea
          label={t("description")}
          name="description"
          maxLength={2000}
          rows={2}
          defaultValue={type?.description ?? ""}
        />
        <div className="event-form-grid">
          <SelectField
            label={t("kind")}
            value={kind}
            onChange={(event) =>
              setKind(event.target.value === "paid" ? "paid" : "free")
            }
          >
            <option value="free">{t("free")}</option>
            <option value="paid">{t("paid")}</option>
          </SelectField>
          <Field
            label={t("price")}
            name="price"
            inputMode="decimal"
            required={kind === "paid"}
            disabled={kind === "free"}
            defaultValue={((type?.priceMinor ?? 0) / 100).toFixed(2)}
          />
          <Field
            label={t("quantity")}
            name="quantity"
            type="number"
            min={1}
            max={event.capacity}
            disabled={event.seatingMode === "assigned"}
            required
            defaultValue={type?.quantity ?? event.capacity}
          />
        </div>
        <p className="field-hint">
          {t("timeZone")}: {event.timeZone}
        </p>
        <div className="event-form-grid">
          <Field
            label={t("salesStart")}
            name="salesStartAt"
            type="datetime-local"
            required
            defaultValue={dateInput(
              type?.salesStartAt ?? event.registrationOpensAt,
              event.timeZone
            )}
          />
          <Field
            label={t("salesEnd")}
            name="salesEndAt"
            type="datetime-local"
            required
            defaultValue={dateInput(
              type?.salesEndAt ?? event.registrationClosesAt,
              event.timeZone
            )}
          />
        </div>
        <label className="event-checkbox">
          <input type="checkbox" name="hidden" defaultChecked={type?.hidden} />
          {t("hidden")}
        </label>
        <Button type="submit">
          {command.pending ? t("loading") : t(type ? "save" : "addType")}
        </Button>
      </fieldset>
    </form>
  )
}

function InventoryEditor({
  event,
  inventory,
  onSaved,
}: {
  event: EventApi
  inventory: Inventory
  onSaved: () => void
}) {
  const command = useCommand()
  return (
    <section className="event-panel">
      {command.error ? (
        <EventError error={command.error} retry={onSaved} />
      ) : null}
      <SeatMap
        seats={inventory.seats}
        selected={[]}
        admin
        disabled={command.pending}
        onSelect={(seat) => {
          void command
            .send(
              `/events/${segment(event.id)}/inventory/${segment(seat.id)}`,
              eventMutationResponseSchema,
              { expectedRevision: event.revision, enabled: !seat.enabled },
              "PATCH"
            )
            .then((result) => {
              if (result) onSaved()
            })
        }}
      />
    </section>
  )
}

export function EventEditorPage({ eventId }: { eventId?: string }) {
  const { t } = useEventText()
  if (!eventId)
    return (
      <div className="events-page editor-page">
        <a className="back-link" href="/organizer/events">
          <ArrowLeftIcon size={18} aria-hidden />
          {t("organize")}
        </a>
        <h1>{t("newEvent")}</h1>
        <ImageDraftHint />
        <EventForm />
      </div>
    )
  return <ExistingEventEditor eventId={eventId} />
}

function RetainedEventActions({ event }: { event: EventApi }) {
  const { t } = useEventText()
  const { account } = useAccount()
  const { t: historyText } = useHistoryText()
  const { t: analyticsText } = useAnalyticsText()
  return (
    <>
      <a
        className="secondary-link"
        href={`/organizer/events/${segment(event.id)}/registrations`}
      >
        {t("registrations")}
      </a>
      <a
        className="secondary-link"
        href={`/organizer/events/${segment(event.id)}/campaigns`}
      >
        {t("campaigns")}
      </a>
      {account?.user.id === event.organizerId ? (
        <>
          <a
            className="secondary-link"
            href={`/events/${segment(event.id)}/analytics`}
          >
            {analyticsText("title")}
          </a>
          <a className="secondary-link" href={eventHistoryHref(event.id)}>
            {historyText("timeline")}
          </a>
        </>
      ) : null}
      {event.suspendedAt === null &&
      (event.cancelledAt !== null || event.phase === "completed") ? (
        <a className="secondary-link" href={duplicateHref(event.id)}>
          {historyText("duplicate")}
        </a>
      ) : null}
    </>
  )
}

function ExistingEventEditor({ eventId }: { eventId: string }) {
  const { t: imageText } = useImageText()
  const { t: payoutText } = usePayoutText()
  const { t: supportText } = useSupportText()
  const { account } = useAccount()
  const { t: accessText } = useAccessText()
  const { locale, t } = useEventText()
  const detail = useResource(
    `/events/${segment(eventId)}/preview`,
    eventDetailResponseSchema,
    15000
  )
  const inventory = useResource(
    `/events/${segment(eventId)}/inventory?preview=true`,
    inventoryResponseSchema
  )
  const command = useCommand()
  const reload = () => {
    detail.reload()
    inventory.reload()
  }
  if (detail.error || !detail.data)
    return detail.error ? (
      <EventError error={detail.error} retry={reload} />
    ) : (
      <Loading />
    )
  const { event, ticketTypes } = detail.data
  const published = event.publicationState === "published"
  if (event.cancelledAt)
    return (
      <div className="events-page">
        <a className="back-link" href="/organizer/events">
          {t("organize")}
        </a>
        <h1>{event.title}</h1>
        <RetainedEventActions event={event} />
        <CancellationPanel event={event} onChanged={reload} />
        <a
          className="secondary-link"
          href={`/support?view=staff&eventId=${segment(event.id)}`}
        >
          {supportText("title")}
        </a>
        <CalendarActions eventId={event.id} />
        <a
          className="secondary-link"
          href={`/organizer/events/${segment(event.id)}/payouts`}
        >
          {payoutText("title")}
        </a>
      </div>
    )
  return (
    <div className="events-page editor-page">
      <a className="back-link" href="/organizer/events">
        <ArrowLeftIcon size={18} aria-hidden />
        {t("organize")}
      </a>
      <div className="event-page-heading">
        <div>
          <span className="eyebrow">
            {t(event.publicationState)} · {t(event.phase)}
          </span>
          <h1>{event.title}</h1>
        </div>
        <div className="event-actions">
          <RetainedEventActions event={event} />
          <a
            className="secondary-link"
            href={`/organizer/events/${segment(event.id)}/payouts`}
          >
            {payoutText("title")}
          </a>
          <a
            className="secondary-link"
            href={`/support?view=staff&eventId=${segment(event.id)}`}
          >
            {supportText("title")}
          </a>
          {account?.user.id === event.organizerId ? (
            <a
              className="secondary-link"
              href={supportHref({
                eventId: event.id,
                audience: "organizer_platform",
                category: "activation",
              })}
            >
              {supportText("organizer_platform")}
            </a>
          ) : null}
          {account?.user.id === event.organizerId ? (
            <a
              className="secondary-link"
              href={`/organizer/events/${segment(event.id)}/access`}
            >
              {accessText("title")}
            </a>
          ) : null}
          <a
            className="secondary-link"
            href={`/events/${segment(event.id)}?preview=true`}
          >
            {imageText("previewEvent")}
            <ArrowUpRightIcon size={18} aria-hidden />
          </a>
          {published ? (
            <a className="secondary-link" href={`/events/${segment(event.id)}`}>
              {t("details")}
              <ArrowUpRightIcon size={18} aria-hidden />
            </a>
          ) : null}
          <Button
            disabled={
              command.pending || (!published && ticketTypes.length === 0)
            }
            onClick={() => {
              void command
                .send(
                  `/events/${segment(event.id)}/${published ? "unpublish" : "publish"}`,
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
        </div>
      </div>
      {command.error ? (
        <EventError error={command.error} retry={reload} />
      ) : null}
      <CancellationPanel event={event} onChanged={reload} />
      <EventImagePanel
        key={`${account?.user.id}:${event.id}`}
        event={event}
        onChanged={(fresh) => {
          detail.update(fresh)
          inventory.reload()
        }}
        onDenied={reload}
      />
      <div className="editor-grid">
        <EventForm
          key={`event:${event.revision}`}
          detail={detail.data}
          onSaved={reload}
        />
        <section className="event-panel">
          <h2>{t("ticketTypes")}</h2>
          {ticketTypes.some((type) => type.kind === "paid") &&
          event.paidSalesState !== "active" ? (
            <p className="event-inline-note">{t("paymentInactive")}</p>
          ) : null}
          {ticketTypes.map((type) => (
            <details
              className="ticket-type-editor"
              key={`${type.id}:${event.revision}`}
            >
              <summary>
                <span>
                  <strong>{type.name}</strong>
                  <small>
                    {money(type.priceMinor, locale)} · {t("available")}:{" "}
                    {type.available} · {t("sold")}: {type.sold}
                  </small>
                </span>
                <span>{t("save")}</span>
              </summary>
              <TicketTypeForm event={event} type={type} onSaved={reload} />
            </details>
          ))}
          {event.seatingMode === "general_admission" ? (
            <details
              className="ticket-type-editor"
              key={`new:${event.revision}`}
              open={ticketTypes.length === 0}
            >
              <summary>
                <PlusIcon size={20} aria-hidden />
                {t("addType")}
              </summary>
              <TicketTypeForm event={event} onSaved={reload} />
            </details>
          ) : null}
        </section>
      </div>
      {inventory.error ? (
        <EventError error={inventory.error} retry={reload} />
      ) : null}
      {event.seatingMode === "assigned" && inventory.data ? (
        <InventoryEditor
          event={event}
          inventory={inventory.data}
          onSaved={reload}
        />
      ) : null}
      <ActivationPanel
        eventId={event.id}
        hasPaidTickets={ticketTypes.some((type) => type.kind === "paid")}
        onChanged={reload}
      />
    </div>
  )
}
