import { navigate } from "@/lib/navigation"
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
import { PlusIcon } from "@phosphor-icons/react"
import { useState, type FormEvent } from "react"
import { useAccount } from "@/auth/context"
import { CancellationPanel } from "@/support/cancellation-panel"
import { CalendarActions } from "./exports"
import { EventImagePanel, ImageDraftHint } from "./image-panel"
import { Button } from "@/components/ui/button"
import { EventApiError, segment, useCommand, useResource } from "./api"
import { useEventText } from "./messages"
import {
  dateFromInput,
  dateInput,
  parsePrice,
  type Inventory,
} from "./policies"
import { SeatMap } from "./seat-map"
import { ActivationPanel } from "./activation-panel"
import { categoryLabel, EVENT_CATEGORIES, priceText } from "./date-parts"
import { EventError, Field, SectionLoading, SelectField, TextArea } from "./ui"
import { OrganizerBackLink } from "./organizer-workspace"
import { trackStickyHeight } from "@/lib/sticky-height"
import { useWorkspace } from "./workspace-context"

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

function categoryOptions(current: string): readonly string[] {
  return current && !(EVENT_CATEGORIES as readonly string[]).includes(current)
    ? [current, ...EVENT_CATEGORIES]
    : EVENT_CATEGORIES
}

function EventForm({
  detail,
  onSaved,
}: {
  detail?: EventDetail
  onSaved?: () => void
}) {
  const { t, locale } = useEventText()
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
      else navigate(`/organizer/events/${segment(result.eventId)}`)
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
          <h3 className="form-section-title">{t("formBasics")}</h3>
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
            <SelectField
              label={t("category")}
              name="category"
              required
              placeholder={t("category")}
              defaultValue={initial.category}
            >
              {categoryOptions(initial.category).map((category) => (
                <option key={category} value={category}>
                  {categoryLabel(category, locale)}
                </option>
              ))}
            </SelectField>
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
          <h3 className="form-section-title">{t("formWhen")}</h3>
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
          <h3 className="form-section-title">{t("formSeats")}</h3>
          <div className="event-form-grid">
            <SelectField
              label={t("seating")}
              value={seating}
              disabled={Boolean(detail?.ticketTypes.length)}
              onValueChange={(value) =>
                setSeating(
                  value === "assigned" ? "assigned" : "general_admission"
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
          <h3 className="form-section-title">{t("formRefunds")}</h3>
          <TextArea
            label={t("refundInstructions")}
            name="refundInstructions"
            rows={3}
            maxLength={4000}
            defaultValue={detail?.event.refundInstructions ?? ""}
          />
          <div className="form-save-bar">
            <Button type="submit" className="auth-button">
              {command.pending ? t("loading") : t(detail ? "save" : "newEvent")}
            </Button>
          </div>
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
            onValueChange={(value) =>
              setKind(value === "paid" ? "paid" : "free")
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
        <OrganizerBackLink />
        <h1>{t("newEvent")}</h1>
        <ImageDraftHint />
        <EventForm />
      </div>
    )
  return <ExistingEventEditor eventId={eventId} />
}

function ExistingEventEditor({ eventId }: { eventId: string }) {
  const { account } = useAccount()
  const { locale, t } = useEventText()
  const workspace = useWorkspace()
  const inventory = useResource(
    `/events/${segment(eventId)}/inventory?preview=true`,
    inventoryResponseSchema
  )
  const reload = () => {
    workspace.reload()
    inventory.reload()
  }
  if (!workspace.detail)
    return workspace.error ? (
      <EventError error={workspace.error} retry={reload} />
    ) : (
      <SectionLoading />
    )
  const detail = workspace.detail
  const { event, ticketTypes } = detail
  if (event.cancelledAt)
    return (
      <>
        <h1 className="sr-only">{t("editEvent")}</h1>
        <CancellationPanel event={event} onChanged={reload} />
        <CalendarActions eventId={event.id} />
      </>
    )
  return (
    <>
      <h1 className="sr-only">{t("editEvent")}</h1>
      <div className="editor-grid">
        <EventForm
          key={`event:${event.revision}`}
          detail={detail}
          onSaved={reload}
        />
        <section
          ref={trackStickyHeight}
          className="event-panel editor-aside sticky-fit"
        >
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
                    {priceText(type.priceMinor, locale)} · {t("available")}:{" "}
                    {type.available} · {t("sold")}: {type.sold}
                  </small>
                </span>
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
                <span className="ticket-type-add">
                  <PlusIcon size={16} weight="bold" aria-hidden />
                  {t("addType")}
                </span>
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
      <EventImagePanel
        key={`${account?.user.id}:${event.id}`}
        event={event}
        onChanged={(fresh) => {
          workspace.update(fresh)
          inventory.reload()
        }}
        onDenied={reload}
      />
      <ActivationPanel
        eventId={event.id}
        hasPaidTickets={ticketTypes.some((type) => type.kind === "paid")}
        onChanged={reload}
      />
      <CancellationPanel event={event} onChanged={reload} />
    </>
  )
}
