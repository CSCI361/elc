import {
  duplicatePastEventResponseSchema,
  eventDetailResponseSchema,
  type EventApi,
} from "@elc/shared"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { useAccount } from "@/auth/context"
import { AuthNotice } from "@/auth/notice"
import { Button } from "@/components/ui/button"
import {
  EventApiError,
  mutation,
  segment,
  serverNow,
  useResource,
} from "@/events/api"
import { useEventText } from "@/events/messages"
import { Field, Loading } from "@/events/ui"
import {
  canResetRejectedRequest,
  duplicateEligible,
  duplicationInput,
  localDateTime,
  newPending,
  parsePending,
  pendingKey,
  type PendingDuplication,
} from "./policies"
import { useHistoryText } from "./messages"
import { HistoryFailure, HistoryHeading } from "./ui"
const fields = [
  "startsAt",
  "endsAt",
  "registrationOpensAt",
  "registrationClosesAt",
] as const
function DuplicateForm({
  event,
  reload,
  accountId,
  deny,
}: {
  event: EventApi
  reload: () => void
  accountId: string
  deny: (error: unknown) => void
}) {
  const { t, locale } = useHistoryText()
  const [saved, setSaved] = useState<PendingDuplication | null>(() => {
    try {
      return parsePending(
        sessionStorage.getItem(pendingKey(accountId, event.id)),
        accountId,
        event.id
      )
    } catch {
      return null
    }
  })
  const [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<
    "invalidTimes" | "storageUnavailable" | "stale" | null
  >(null)
  const busy = useRef(false),
    mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const start = serverNow() + 7 * 86400000
  const [values, setValues] = useState(() => ({
    startsAt: localDateTime(start, event.timeZone),
    endsAt: localDateTime(
      start + Date.parse(event.endsAt) - Date.parse(event.startsAt),
      event.timeZone
    ),
    registrationOpensAt: localDateTime(serverNow() + 3600000, event.timeZone),
    registrationClosesAt: localDateTime(start, event.timeZone),
  }))
  const key = pendingKey(accountId, event.id)
  async function submit(formEvent?: FormEvent) {
    formEvent?.preventDefault()
    if (busy.current) return
    let operation = saved
    const wasUncertain = Boolean(saved)
    if (!operation) {
      const input = duplicationInput(event, values, serverNow())
      if (!input) {
        setNotice("invalidTimes")
        return
      }
      operation = newPending(accountId, event.id, input)
    }
    try {
      sessionStorage.setItem(key, JSON.stringify(operation))
    } catch {
      setNotice("storageUnavailable")
      return
    }
    busy.current = true
    setPending(true)
    setSaved(operation)
    setError(null)
    setNotice(null)
    try {
      const response = await mutation(
        `/events/${segment(event.id)}/duplicate`,
        duplicatePastEventResponseSchema,
        operation.input
      )
      if (mounted.current) {
        try {
          sessionStorage.removeItem(key)
        } catch {
          /* A retained receipt only replays the same confirmed draft. */
        }
        window.location.assign(`/organizer/events/${segment(response.eventId)}`)
      }
    } catch (failure) {
      if (!mounted.current) return
      const status =
        failure instanceof EventApiError ? failure.status : undefined
      if (canResetRejectedRequest(wasUncertain, status)) {
        try {
          sessionStorage.removeItem(key)
        } catch {
          /* Leaving this rejected operation is safe to retry. */
        }
        setSaved(null)
        setNotice(status === 409 ? "stale" : "invalidTimes")
        if (status === 409) reload()
      } else {
        setError(failure)
        if (
          failure instanceof EventApiError &&
          [401, 403, 404].includes(failure.status)
        )
          deny(failure)
      }
    } finally {
      busy.current = false
      if (mounted.current) setPending(false)
    }
  }
  if (error instanceof EventApiError && [401, 403, 404].includes(error.status))
    return <HistoryFailure error={error} retry={reload} duplicate />
  if (!saved && !duplicateEligible(event, serverNow()))
    return <AuthNotice>{t("ineligible")}</AuthNotice>
  const date = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    dateStyle: "long",
    timeStyle: "short",
  })
  return (
    <section className="event-panel history-duplicate-form">
      <p>{t("salesWindow")}</p>
      {saved ? (
        <>
          <>
            {pending ? (
              <p role="status">{t("creating")}</p>
            ) : (
              <AuthNotice>{t("uncertain")}</AuthNotice>
            )}
          </>
          <h2>{t("snapshot")} · UTC</h2>
          <dl className="history-submitted">
            {fields.map((field) => (
              <div key={field}>
                <dt>{t(field)}</dt>
                <dd>
                  <time dateTime={saved.input[field]}>
                    {date.format(new Date(saved.input[field]))}
                  </time>
                </dd>
              </div>
            ))}
          </dl>
          <Button
            type="button"
            disabled={pending}
            onClick={() => void submit()}
          >
            {pending ? t("creating") : t("retrySame")}
          </Button>
        </>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <p>
            {t("timeZone")}: <strong>{event.timeZone}</strong>
          </p>
          <p className="field-hint">{t("dateHint")}</p>
          <div className="history-dates">
            {fields.map((field) => (
              <Field
                key={field}
                name={field}
                type="datetime-local"
                label={t(field)}
                value={values[field]}
                onChange={(change) =>
                  setValues((current) => ({
                    ...current,
                    [field]: change.target.value,
                  }))
                }
                required
              />
            ))}
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? t("creating") : t("duplicate")}
          </Button>
        </form>
      )}
      {notice ? <AuthNotice>{t(notice)}</AuthNotice> : null}
    </section>
  )
}
function CurrentDuplicate({
  eventId,
  accountId,
}: {
  eventId: string
  accountId: string
}) {
  const { t } = useHistoryText()
  const [denied, setDenied] = useState<unknown>(null)
  const resource = useResource(
    `/events/${segment(eventId)}/preview`,
    eventDetailResponseSchema,
    15000
  )
  const reload = () => {
    setDenied(null)
    resource.reload()
  }
  if (resource.error || denied)
    return (
      <>
        <HistoryHeading>{t("duplicate")}</HistoryHeading>
        <HistoryFailure
          error={resource.error ?? denied}
          retry={reload}
          duplicate
        />
      </>
    )
  if (!resource.data) return <Loading />
  const { event, ticketTypes } = resource.data
  return (
    <>
      <HistoryHeading>{t("duplicate")}</HistoryHeading>
      <section className="event-panel">
        <p>{t("source")}</p>
        <h2>{event.title}</h2>
        <p>{event.venueName}</p>
        <p>
          {t("capacity")}: {event.capacity} · {t("ticketTypes")}:{" "}
          {ticketTypes.length}
        </p>
        <p>{t("duplicateHint")}</p>
        <p>{t("activation")}</p>
      </section>
      <DuplicateForm
        key={`${eventId}:${accountId}:${event.timeZone}`}
        event={event}
        accountId={accountId}
        reload={reload}
        deny={setDenied}
      />
    </>
  )
}
export function HistoryDuplicatePage({ eventId }: { eventId: string }) {
  const { account } = useAccount(),
    { t: et } = useEventText()
  return (
    <div className="events-page history-page">
      <a className="back-link" href="/organizer/events">
        {et("organize")}
      </a>
      {account ? (
        <CurrentDuplicate
          key={`${account.user.id}:${eventId}`}
          eventId={eventId}
          accountId={account.user.id}
        />
      ) : null}
    </div>
  )
}
