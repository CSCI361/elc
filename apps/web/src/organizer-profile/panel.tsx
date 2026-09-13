import {
  organizerProfileResponseSchema,
  organizerProfileMutationResponseSchema,
  type OrganizerProfileResponse,
} from "@elc/shared"
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { api, EventApiError } from "@/events/api"
import { EventError, Field } from "@/events/ui"
import {
  emptyOrganizerProfile,
  observedProfile,
  profileAttempt,
  type OrganizerProfile,
  type ProfileAttempt,
} from "./policies"
import { useOrganizerProfileText } from "./messages"
import "./profile.css"

const path = "/me/organizer-profile"
const denied = (error: unknown) =>
  error instanceof EventApiError && [401, 403, 404].includes(error.status)
type View = {
  baseline: OrganizerProfileResponse | null
  draft: OrganizerProfile
  observedRevision: number
  loading: boolean
  readError: unknown
  commandError: unknown
  conflict: boolean
  uncertain: boolean
  saved: boolean
}
const initial = (): View => ({
  baseline: null,
  draft: { ...emptyOrganizerProfile },
  observedRevision: 0,
  loading: true,
  readError: null,
  commandError: null,
  conflict: false,
  uncertain: false,
  saved: false,
})

export function OrganizerProfilePanel() {
  const { t, locale } = useOrganizerProfileText()
  const [view, setView] = useState<View>(initial)
  const [saving, setSaving] = useState(false)
  const reader = useRef<AbortController | null>(null)
  const writer = useRef<AbortController | null>(null)
  const attempt = useRef<ProfileAttempt | null>(null)
  const acknowledged = useRef<number | null>(null)

  const read = useCallback(async (replace = false) => {
    if (!replace && writer.current && !writer.current.signal.aborted) return
    if (!replace && reader.current && !reader.current.signal.aborted) return
    reader.current?.abort()
    const request = new AbortController()
    reader.current = request
    try {
      const data = await api(path, organizerProfileResponseSchema, {
        signal: request.signal,
      })
      if (request.signal.aborted) return
      if (
        acknowledged.current !== null &&
        data.revision < acknowledged.current
      ) {
        throw new EventApiError("CONFLICT", 409)
      }
      const adopt = replace || acknowledged.current !== null
      if (adopt) {
        attempt.current = null
        acknowledged.current = null
      }
      setView((previous) => ({
        ...previous,
        ...observedProfile(previous, data, adopt),
        observedRevision: data.revision,
        loading: false,
        readError: null,
        ...(adopt
          ? { commandError: null, conflict: false, uncertain: false }
          : {}),
      }))
    } catch (error) {
      if (!request.signal.aborted) {
        if (denied(error)) {
          attempt.current = null
          acknowledged.current = null
        }
        setView((previous) =>
          denied(error)
            ? { ...initial(), loading: false, readError: error }
            : { ...previous, loading: false, readError: error }
        )
      }
    } finally {
      request.abort()
    }
  }, [])
  useEffect(() => {
    void read()
    const focus = () => void read()
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void read()
    }, 15000)
    window.addEventListener("focus", focus)
    return () => {
      reader.current?.abort()
      writer.current?.abort()
      window.clearInterval(timer)
      window.removeEventListener("focus", focus)
    }
  }, [read])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (
      !view.baseline ||
      view.readError ||
      view.conflict ||
      (writer.current && !writer.current.signal.aborted)
    )
      return
    const next = profileAttempt(
      attempt.current,
      view.draft,
      view.baseline.revision,
      () => crypto.randomUUID()
    )
    if (!next) {
      setView((previous) => ({
        ...previous,
        commandError: new EventApiError("INVALID_INPUT", 400),
      }))
      return
    }
    attempt.current = next
    reader.current?.abort()
    const request = new AbortController()
    writer.current = request
    setSaving(true)
    setView((previous) => ({ ...previous, commandError: null, saved: false }))
    try {
      const ack = await api(path, organizerProfileMutationResponseSchema, {
        method: "PATCH",
        signal: request.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next.input),
      })
      if (request.signal.aborted) return
      acknowledged.current = ack.revision
      setView((previous) => ({
        ...previous,
        saved: true,
        uncertain: false,
        loading: true,
      }))
      await read(true)
    } catch (error) {
      if (!request.signal.aborted) {
        if (denied(error)) {
          attempt.current = null
          acknowledged.current = null
        }
        setView((previous) =>
          denied(error)
            ? { ...initial(), loading: false, readError: error }
            : {
                ...previous,
                commandError: error,
                conflict:
                  error instanceof EventApiError && error.status === 409,
                uncertain:
                  !(error instanceof EventApiError) || error.status >= 500,
              }
        )
      }
    } finally {
      if (!request.signal.aborted) setSaving(false)
      request.abort()
    }
  }
  function reload(replace: boolean) {
    setView((previous) => ({ ...previous, loading: true }))
    void read(replace)
  }
  const stale =
    view.conflict ||
    (view.baseline !== null && view.observedRevision !== view.baseline.revision)
  const hidden = view.loading || !!view.readError
  return (
    <section className="organizer-profile-panel" aria-label={t("title")}>
      <h2>{t("title")}</h2>
      <p>{t("hint")}</p>
      <p className="organizer-profile-demo">{t("demo")}</p>
      {view.saved ? <p role="status">{t("saved")}</p> : null}
      {view.loading ? <p role="status">{t("loading")}</p> : null}
      {view.readError ? (
        <>
          {denied(view.readError) ? (
            <p role="alert">{t("denied")}</p>
          ) : (
            <EventError error={view.readError} />
          )}
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => reload(false)}
          >
            {t("retry")}
          </Button>
        </>
      ) : null}
      {!hidden && view.baseline ? (
        <>
          {!view.baseline.profile ? (
            <p>{t("missing")}</p>
          ) : (
            <p>
              {t("updated")}:{" "}
              <time dateTime={view.baseline.updatedAt!}>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "medium",
                }).format(new Date(view.baseline.updatedAt!))}
              </time>
            </p>
          )}
          <p className="field-hint">
            {t("revision")}: {view.baseline.revision}
          </p>
          {stale ? <p role="status">{t("stale")}</p> : null}
          {view.uncertain ? <p role="status">{t("uncertain")}</p> : null}
          {view.commandError ? (
            view.commandError instanceof EventApiError &&
            view.commandError.code === "INVALID_INPUT" ? (
              <p role="alert">{t("invalid")}</p>
            ) : (
              <EventError error={view.commandError} />
            )
          ) : null}
          <form onSubmit={(event) => void save(event)}>
            <fieldset
              className="organizer-profile-fields"
              disabled={saving || stale}
            >
              {(
                [
                  "displayName",
                  "legalName",
                  "contact",
                  "dummyPayoutReference",
                ] as const
              ).map((key) => (
                <Field
                  key={key}
                  label={t(key)}
                  name={key}
                  value={view.draft[key]}
                  required
                  maxLength={
                    key === "displayName"
                      ? 120
                      : key === "dummyPayoutReference"
                        ? 65
                        : 200
                  }
                  minLength={key === "contact" ? 3 : undefined}
                  pattern={
                    key === "dummyPayoutReference"
                      ? "DEMO-[A-Za-z0-9_-]{3,60}"
                      : undefined
                  }
                  hint={
                    key === "dummyPayoutReference" ? t("payoutHint") : undefined
                  }
                  autoComplete="off"
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    setView((previous) => ({
                      ...previous,
                      draft: { ...previous.draft, [key]: value },
                      saved: false,
                      uncertain: false,
                      commandError: null,
                    }))
                  }}
                />
              ))}
            </fieldset>
            <div className="organizer-profile-actions">
              <Button
                type="submit"
                disabled={saving || view.conflict || (stale && !view.uncertain)}
              >
                {t(saving ? "saving" : view.uncertain ? "retrySave" : "save")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => reload(true)}
              >
                {t("reload")}
              </Button>
            </div>
          </form>
        </>
      ) : null}
    </section>
  )
}
