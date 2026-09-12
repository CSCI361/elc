import { acceptedEventInvitationSchema } from "@elc/shared"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { authClient } from "@/auth/client"
import { useAccount } from "@/auth/context"
import { authErrorMessage, type AuthErrorKey } from "@/auth/errors"
import { AuthField, PasswordField } from "@/auth/field"
import { AuthNotice } from "@/auth/notice"
import { Button } from "@/components/ui/button"
import { api, EventApiError, segment } from "@/events/api"
import { useEventText } from "@/events/messages"
import { EventError, Loading } from "@/events/ui"
import {
  readInvitationToken,
  withoutInvitationSecrets,
  type InvitationMemory,
} from "./invitation-memory"
import { useAccessText } from "./messages"
import "./access.css"

function InvitationSignIn() {
  const { messages, locale, capabilities, capabilitiesFailed, refresh } =
    useAccount()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AuthErrorKey | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !capabilities?.emailAndPassword) return
    const form = event.currentTarget
    const data = new FormData(form)
    const email = data.get("email")
    const password = data.get("password")
    if (typeof email !== "string" || typeof password !== "string") return
    setPending(true)
    setError(null)
    try {
      const result = await authClient.signIn.email({
        email,
        password,
        fetchOptions: { headers: { "Accept-Language": locale } },
      })
      if (result.error) setError(authErrorMessage(result.error))
      else {
        form.reset()
        refresh()
      }
    } catch {
      setError("errorNetwork")
    } finally {
      setPending(false)
    }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      {error ? <AuthNotice>{messages[error]}</AuthNotice> : null}
      {capabilitiesFailed ? (
        <AuthNotice>{messages.errorNetwork}</AuthNotice>
      ) : null}
      <fieldset disabled={pending || !capabilities?.emailAndPassword}>
        <AuthField
          id="invitation-email"
          name="email"
          label={messages.email}
          type="email"
          autoComplete="email"
          required
          maxLength={254}
        />
        <PasswordField
          id="invitation-password"
          name="password"
          label={messages.password}
          autoComplete="current-password"
          required
        />
        <Button type="submit">
          {pending ? messages.pending : messages.signIn}
        </Button>
      </fieldset>
    </form>
  )
}

function AcceptAction({
  memory,
  onAccepted,
  onRejected,
}: {
  memory: InvitationMemory
  onAccepted: (eventId: string) => void
  onRejected: () => void
}) {
  const { t } = useAccessText()
  const { t: eventText } = useEventText()
  const { refresh } = useAccount()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const requestId = useRef(crypto.randomUUID())
  const request = useRef<AbortController | null>(null)
  const acceptButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    acceptButton.current?.focus()
  }, [])
  useEffect(
    () => () => {
      request.current?.abort()
    },
    []
  )
  async function accept() {
    const token = memory.read()
    if (!token || request.current) return
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    setError(null)
    try {
      const result = await api(
        "/invitations/accept",
        acceptedEventInvitationSchema,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: requestId.current, token }),
          signal: controller.signal,
        }
      )
      if (!controller.signal.aborted) {
        memory.clear()
        onAccepted(result.eventId)
      }
    } catch (failure) {
      if (controller.signal.aborted) return
      if (failure instanceof EventApiError && failure.code === "NOT_FOUND") {
        memory.clear()
        onRejected()
      } else {
        setError(failure)
        if (
          failure instanceof EventApiError &&
          [401, 403].includes(failure.status)
        )
          refresh()
      }
    } finally {
      if (!controller.signal.aborted) {
        request.current = null
        setPending(false)
      }
    }
  }
  return (
    <>
      {error ? <EventError error={error} /> : null}
      <Button
        ref={acceptButton}
        type="button"
        disabled={pending}
        onClick={() => void accept()}
      >
        {pending ? eventText("loading") : t("accept")}
      </Button>
    </>
  )
}

export function InvitationPage({ memory }: { memory: InvitationMemory }) {
  const { t } = useAccessText()
  const { t: eventText } = useEventText()
  const { account, status, refresh, messages } = useAccount()
  const [version, setVersion] = useState(0)
  const [acceptedEvent, setAcceptedEvent] = useState<string | null>(null)
  const [rejected, setRejected] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState(false)
  const success = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (acceptedEvent) success.current?.focus()
  }, [acceptedEvent])
  useEffect(() => {
    const receive = () => {
      const url = new URL(window.location.href)
      if (!new URLSearchParams(url.hash.slice(1)).has("token")) return
      memory.replace(readInvitationToken(url))
      window.history.replaceState(null, "", withoutInvitationSecrets(url))
      setAcceptedEvent(null)
      setRejected(false)
      setVersion((value) => value + 1)
    }
    const clear = () => memory.clear()
    window.addEventListener("hashchange", receive)
    window.addEventListener("pagehide", clear)
    return () => {
      window.removeEventListener("hashchange", receive)
      window.removeEventListener("pagehide", clear)
    }
  }, [memory])
  async function switchAccount() {
    if (switching) return
    setSwitching(true)
    setSwitchError(false)
    try {
      const result = await authClient.signOut()
      if (result.error) setSwitchError(true)
      else refresh()
    } catch {
      setSwitchError(true)
    } finally {
      setSwitching(false)
    }
  }
  const externalAuthLink = (path: string, label: string) => (
    <a href={path} target="_blank" rel="noopener noreferrer">
      {label} <span className="field-hint">{eventText("newTab")}</span>
    </a>
  )
  return (
    <section className="auth-card invitation-page">
      <span className="eyebrow">ELC</span>
      <h1>{t("invitationTitle")}</h1>
      <p>{t("invitationIntro")}</p>
      {acceptedEvent ? (
        <div ref={success} tabIndex={-1}>
          <AuthNotice tone="success">{t("acceptedNotice")}</AuthNotice>
          <a
            className="primary-link"
            href={`/events/${segment(acceptedEvent)}`}
          >
            {eventText("details")}
          </a>
        </div>
      ) : rejected ? (
        <AuthNotice>{t("unavailable")}</AuthNotice>
      ) : !memory.read() ? (
        <AuthNotice>{t("missing")}</AuthNotice>
      ) : (
        <>
          {status === "loading" ? (
            <Loading />
          ) : status === "active" && account ? (
            <div
              className="access-accept"
              key={`${version}:${account.user.id}`}
            >
              <p className="invitation-account">{account.user.email}</p>
              <AcceptAction
                memory={memory}
                onAccepted={setAcceptedEvent}
                onRejected={() => setRejected(true)}
              />
            </div>
          ) : status === "signed-out" ? (
            <InvitationSignIn />
          ) : (
            <AuthNotice>
              {t(
                status === "verification-required"
                  ? "verifyRequired"
                  : "accountUnavailable"
              )}
            </AuthNotice>
          )}
          <p className="field-hint">{t("keepTab")}</p>
          <div className="invitation-auth-links">
            {status === "signed-out" ? (
              <>
                {externalAuthLink("/auth/sign-in", t("otherSignIn"))}
                {externalAuthLink("/auth/sign-up", messages.signUp)}
                {externalAuthLink(
                  "/auth/forgot-password",
                  messages.forgotPassword
                )}
              </>
            ) : null}
            {status === "verification-required"
              ? externalAuthLink(
                  "/auth/verify-email",
                  messages.resendVerification
                )
              : null}
            <button
              className="text-action"
              type="button"
              disabled={status === "loading" || switching}
              onClick={refresh}
            >
              {t("checkAccount")}
            </button>
            {status !== "signed-out" && status !== "loading" ? (
              <button
                className="text-action"
                type="button"
                disabled={switching}
                onClick={() => void switchAccount()}
              >
                {t("switchAccount")}
              </button>
            ) : null}
          </div>
          {switchError ? (
            <AuthNotice>{messages.errorNetwork}</AuthNotice>
          ) : null}
        </>
      )}
    </section>
  )
}
