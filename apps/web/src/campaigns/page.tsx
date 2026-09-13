import {
  campaignListResponseSchema,
  campaignResponseSchema,
  eventDetailResponseSchema,
} from "@elc/shared"
import { useState, type FormEvent } from "react"
import { useAccount } from "@/auth/context"
import { Button } from "@/components/ui/button"
import {
  api,
  EventApiError,
  segment,
  useResource,
  useServerNow,
} from "../events/api"
import { dateInput, dateText, money } from "../events/policies"
import {
  EventError,
  Field,
  Loading,
  Protected,
  SelectField,
} from "../events/ui"
import { useCampaignText } from "./messages"
import { parseCampaignDraft, type CampaignDraft } from "./policies"
import { useCampaignCommand } from "./command"
import { CampaignQrCard } from "./qr-card"
import "./campaigns.css"

type Detail = ReturnType<typeof eventDetailResponseSchema.parse>
type Campaign = ReturnType<typeof campaignResponseSchema.parse>
const denied = (error: unknown) =>
  error instanceof EventApiError && [401, 403, 404].includes(error.status)

function CreateCampaign({
  detail,
  unavailable,
  onChanged,
  onDenied,
  onRefresh,
}: {
  detail: Detail
  unavailable: boolean
  onChanged: () => void
  onDenied: (error: unknown) => void
  onRefresh: () => Promise<Detail | null>
}) {
  const { t } = useCampaignText()
  const { event, ticketTypes } = detail
  const command = useCampaignCommand(onDenied)
  const [baseline, setBaseline] = useState({
    revision: event.revision,
    startsAt: event.registrationOpensAt,
    endsAt: event.registrationClosesAt,
  })
  const revision = baseline.revision
  const [draft, setDraft] = useState<CampaignDraft>(() => ({
    name: "",
    kind: "percentage",
    amount: "10",
    maxRedemptions: "100",
    starts: dateInput(event.registrationOpensAt, event.timeZone),
    ends: dateInput(event.registrationClosesAt, event.timeZone),
    ticketTypeIds: ticketTypes.map((type) => type.id),
  }))
  const [invalid, setInvalid] = useState(false)
  const stale = revision !== event.revision
  const field = (
    key: keyof Omit<CampaignDraft, "ticketTypeIds">,
    value: string
  ) => {
    setDraft((previous) => ({ ...previous, [key]: value }))
    setInvalid(false)
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    const body = parseCampaignDraft(draft, event.id, event.timeZone, baseline)
    if (!body) {
      setInvalid(true)
      return
    }
    const result = await command.send(
      `/events/${segment(event.id)}/campaigns`,
      { ...body, expectedRevision: revision }
    )
    if (result) onChanged()
  }
  return (
    <section className="event-panel">
      <h2>{t("create")}</h2>
      <p>{t("intro")}</p>
      {!ticketTypes.length ? (
        <p>{t("noTypes")}</p>
      ) : (
        <form onSubmit={(e) => void submit(e)}>
          <fieldset
            disabled={command.pending || unavailable}
            className="campaign-fields"
          >
            <div className="event-form-grid">
              <Field
                label={t("name")}
                value={draft.name}
                maxLength={100}
                required
                onChange={(e) => field("name", e.currentTarget.value)}
              />
              <SelectField
                label={t("kind")}
                value={draft.kind}
                onChange={(e) => field("kind", e.currentTarget.value)}
              >
                <option value="percentage">{t("percentage")}</option>
                <option value="fixed">{t("fixed")}</option>
              </SelectField>
              <Field
                label={`${t("amount")} (${draft.kind === "percentage" ? "%" : "KZT"})`}
                hint={t(
                  draft.kind === "percentage" ? "percentHint" : "fixedHint"
                )}
                value={draft.amount}
                inputMode="decimal"
                maxLength={20}
                required
                onChange={(e) => field("amount", e.currentTarget.value)}
              />
              <Field
                label={t("limit")}
                hint={t("limitHint")}
                value={draft.maxRedemptions}
                inputMode="numeric"
                maxLength={16}
                required
                onChange={(e) => field("maxRedemptions", e.currentTarget.value)}
              />
              <Field
                label={t("starts")}
                hint={event.timeZone}
                type="datetime-local"
                value={draft.starts}
                required
                onChange={(e) => field("starts", e.currentTarget.value)}
              />
              <Field
                label={t("ends")}
                hint={event.timeZone}
                type="datetime-local"
                value={draft.ends}
                required
                onChange={(e) => field("ends", e.currentTarget.value)}
              />
            </div>
            <fieldset className="campaign-types">
              <legend>{t("types")}</legend>
              {ticketTypes.map((type) => (
                <label key={type.id}>
                  <input
                    type="checkbox"
                    checked={draft.ticketTypeIds.includes(type.id)}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked
                      setDraft((previous) => ({
                        ...previous,
                        ticketTypeIds: checked
                          ? [...previous.ticketTypeIds, type.id]
                          : previous.ticketTypeIds.filter(
                              (id) => id !== type.id
                            ),
                      }))
                    }}
                  />
                  {type.name}
                </label>
              ))}
            </fieldset>
            {invalid ? <p role="alert">{t("invalid")}</p> : null}
            {command.error ? <EventError error={command.error} /> : null}
            {stale ||
            (command.error instanceof EventApiError &&
              command.error.status === 409) ? (
              <p role="status">{t("changed")}</p>
            ) : null}
            <div className="event-actions">
              <Button type="submit">
                {t(command.pending ? "busy" : "create")}
              </Button>
              {stale ||
              (command.error instanceof EventApiError &&
                command.error.status === 409) ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void onRefresh().then((fresh) => {
                      if (fresh) {
                        setBaseline((previous) => ({
                          ...previous,
                          revision: fresh.event.revision,
                        }))
                        command.setError(null)
                      }
                    })
                  }
                >
                  {t("refresh")}
                </Button>
              ) : null}
            </div>
          </fieldset>
        </form>
      )}
    </section>
  )
}

function CampaignRow({
  campaign,
  detail,
  onChanged,
  onDenied,
  onRefresh,
  unavailable,
}: {
  unavailable: boolean
  campaign: Campaign
  detail: Detail
  onChanged: () => void
  onDenied: (error: unknown) => void
  onRefresh: () => Promise<Detail | null>
}) {
  const { t, locale } = useCampaignText()
  const now = useServerNow()
  const command = useCampaignCommand(onDenied)
  const [review, setReview] = useState<{
    revision: number
    campaign: Campaign
  } | null>(null)
  const windowState =
    Date.parse(campaign.endsAt) <= now
      ? "expired"
      : Date.parse(campaign.startsAt) > now
        ? "upcoming"
        : "open"
  const { event, ticketTypes } = detail
  const stale =
    review !== null &&
    (review.revision !== event.revision ||
      review.campaign.updatedAt !== campaign.updatedAt)
  const value = review?.campaign ?? campaign
  async function refreshReview() {
    try {
      const [fresh, current] = await Promise.all([
        onRefresh(),
        api(
          `/events/${segment(event.id)}/campaigns/${segment(campaign.id)}`,
          campaignResponseSchema
        ),
      ])
      if (fresh) {
        setReview({ revision: fresh.event.revision, campaign: current })
        command.setError(null)
      }
    } catch (failure) {
      command.setError(failure)
      if (denied(failure)) onDenied(failure)
    }
  }
  async function change() {
    if (!review) return
    const action = review.campaign.enabled ? "disable" : "enable"
    const result = await command.send(
      `/events/${segment(event.id)}/campaigns/${segment(campaign.id)}/${action}`,
      { expectedRevision: review.revision }
    )
    if (result) onChanged()
  }
  return (
    <article className="event-panel campaign-card">
      <div className="campaign-heading">
        <h2>{campaign.name}</h2>
        <span>
          {t(campaign.enabled ? "enabled" : "disabled")} · {t(windowState)}
        </span>
      </div>
      <p>
        {campaign.discount.kind === "percentage"
          ? `${new Intl.NumberFormat(locale).format(campaign.discount.basisPoints / 100)}%`
          : money(campaign.discount.amountMinor, locale)}{" "}
        · {t("limit")}: {campaign.maxRedemptions.toLocaleString(locale)}
      </p>
      <p>
        {dateText(campaign.startsAt, event.timeZone, locale)} →{" "}
        {dateText(campaign.endsAt, event.timeZone, locale)} ({event.timeZone})
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={command.pending || unavailable}
        onClick={() =>
          setReview(review ? null : { revision: event.revision, campaign })
        }
        aria-expanded={review !== null}
      >
        {t("review")}
      </Button>
      {review ? (
        <div className="campaign-review">
          <p>
            {t("types")}:{" "}
            {value.applicableTicketTypeIds
              .map(
                (id) => ticketTypes.find((type) => type.id === id)?.name ?? id
              )
              .join(", ")}
          </p>
          <p>{t("inactiveHint")}</p>
          {command.error ? <EventError error={command.error} /> : null}
          {stale ||
          (command.error instanceof EventApiError &&
            command.error.status === 409) ? (
            <p role="status">{t("changed")}</p>
          ) : null}
          {!event.cancelledAt ? (
            <div className="event-actions">
              <Button
                type="button"
                disabled={command.pending || unavailable}
                onClick={() => void change()}
              >
                {t(
                  command.pending
                    ? "busy"
                    : value.enabled
                      ? "disable"
                      : "enable"
                )}
              </Button>
              {stale ||
              (command.error instanceof EventApiError &&
                command.error.status === 409) ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={command.pending || unavailable}
                  onClick={() => void refreshReview()}
                >
                  {t("refresh")}
                </Button>
              ) : null}
            </div>
          ) : null}
          {denied(command.error) ? (
            <EventError
              error={command.error}
              retry={() => onDenied(command.error)}
            />
          ) : !unavailable ? (
            <CampaignQrCard
              key={`${campaign.id}:${campaign.updatedAt}:${locale}`}
              eventId={event.id}
              campaignId={campaign.id}
              onDenied={onDenied}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function CampaignWorkspace({ eventId }: { eventId: string }) {
  const { t } = useCampaignText()
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [saved, setSaved] = useState(false)
  const [accessError, setAccessError] = useState<unknown>(null)
  const detail = useResource(
    `/events/${segment(eventId)}/preview`,
    eventDetailResponseSchema,
    15000
  )
  const cursor = cursors.at(-1)
  const list = useResource(
    `/events/${segment(eventId)}/campaigns?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    campaignListResponseSchema,
    15000
  )
  const failure = accessError || detail.error || list.error
  function reload() {
    detail.reload()
    list.reload()
    setAccessError(null)
  }
  async function refresh(): Promise<Detail | null> {
    try {
      const [freshDetail, freshList] = await Promise.all([
        api(`/events/${segment(eventId)}/preview`, eventDetailResponseSchema),
        api(
          `/events/${segment(eventId)}/campaigns?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          campaignListResponseSchema
        ),
      ])
      detail.update(freshDetail)
      list.update(freshList)
      return freshDetail
    } catch (error) {
      setAccessError(error)
      return null
    }
  }
  function changed() {
    setSaved(true)
    setCursors([null])
    reload()
  }
  if (denied(failure)) return <EventError error={failure} retry={reload} />
  return (
    <div className="events-page campaigns-page">
      <a className="back-link" href={`/organizer/events/${segment(eventId)}`}>
        {t("back")}
      </a>
      <h1>
        {t("title")}
        {detail.data ? ` · ${detail.data.event.title}` : ""}
      </h1>
      {saved ? <p role="status">{t("saved")}</p> : null}
      {failure ? <EventError error={failure} retry={reload} /> : null}
      {detail.data ? (
        detail.data.event.cancelledAt ? (
          <p role="note">{t("readOnly")}</p>
        ) : (
          <CreateCampaign
            detail={detail.data}
            unavailable={!!failure}
            onChanged={changed}
            onDenied={setAccessError}
            onRefresh={refresh}
          />
        )
      ) : detail.loading ? (
        <Loading />
      ) : null}
      {detail.data && list.data ? (
        <>
          {list.data.items.length ? (
            list.data.items.map((campaign) => (
              <CampaignRow
                key={campaign.id}
                unavailable={!!failure}
                campaign={campaign}
                detail={detail.data!}
                onChanged={changed}
                onDenied={setAccessError}
                onRefresh={refresh}
              />
            ))
          ) : (
            <p>{t("empty")}</p>
          )}
          <nav className="event-actions" aria-label={t("page")}>
            <Button
              type="button"
              variant="outline"
              disabled={!!failure || cursors.length < 2}
              onClick={() => setCursors((previous) => previous.slice(0, -1))}
            >
              {t("previous")}
            </Button>
            <span>
              {t("page")} {cursors.length}
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={!!failure || !list.data.nextCursor}
              onClick={() => {
                const next = list.data?.nextCursor
                if (next) setCursors((previous) => [...previous, next])
              }}
            >
              {t("next")}
            </Button>
          </nav>
        </>
      ) : !failure && list.loading ? (
        <Loading />
      ) : null}
    </div>
  )
}

export function CampaignPage({ eventId }: { eventId: string }) {
  const { account } = useAccount()
  return (
    <Protected>
      <CampaignWorkspace
        key={`${account?.user.id}:${eventId}`}
        eventId={eventId}
      />
    </Protected>
  )
}
