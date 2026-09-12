import { Input } from "@base-ui/react/input"
import { useId, type ComponentProps, type ReactNode } from "react"
import { AuthNotice } from "@/auth/notice"
import { AccountPage } from "@/auth/account-page"
import { useAccount } from "@/auth/context"
import { authHref } from "@/auth/navigation"
import { EventApiError, errorKey } from "./api"
import { useEventText } from "./messages"

export function EventError({
  error,
  retry,
}: {
  error: unknown
  retry?: () => void
}) {
  const { t } = useEventText()
  return (
    <AuthNotice>
      <span>{t(errorKey(error))}</span>
      {error instanceof EventApiError && error.reference ? (
        <small>
          {t("reference")}: {error.reference}
        </small>
      ) : null}
      {retry ? (
        <button type="button" className="text-action" onClick={retry}>
          {t("reload")}
        </button>
      ) : null}
    </AuthNotice>
  )
}
export function Loading() {
  const { t } = useEventText()
  return (
    <p className="event-loading" role="status">
      {t("loading")}
    </p>
  )
}
export function Protected({ children }: { children: ReactNode }) {
  const { status, messages } = useAccount()
  if (status === "signed-out")
    return (
      <section className="auth-card account-state-card">
        <h1>{messages.signInTitle}</h1>
        <p>{messages.signInDescription}</p>
        <a
          className="primary-link"
          href={authHref(
            "sign-in",
            `${window.location.pathname}${window.location.search}`
          )}
        >
          {messages.signIn}
        </a>
      </section>
    )
  return status === "active" ? (
    children
  ) : status === "loading" ? (
    <Loading />
  ) : (
    <AccountPage />
  )
}
export function Field({
  label,
  hint,
  ...props
}: ComponentProps<typeof Input> & { label: string; hint?: string }) {
  const generatedId = useId()
  const id = props.id ?? generatedId
  const hintId = `${id}-hint`
  return (
    <div className="event-field">
      <label htmlFor={id}>{label}</label>
      <Input
        {...props}
        id={id}
        aria-describedby={
          [props["aria-describedby"], hint ? hintId : null]
            .filter(Boolean)
            .join(" ") || undefined
        }
        className="auth-input"
      />
      {hint ? <small id={hintId}>{hint}</small> : null}
    </div>
  )
}
export function SelectField({
  label,
  children,
  ...props
}: ComponentProps<"select"> & { label: string }) {
  return (
    <label className="event-field">
      <span>{label}</span>
      <select {...props} className="auth-input">
        {children}
      </select>
    </label>
  )
}
export function TextArea({
  label,
  ...props
}: ComponentProps<"textarea"> & { label: string }) {
  return (
    <label className="event-field">
      <span>{label}</span>
      <textarea {...props} className="auth-input" />
    </label>
  )
}
