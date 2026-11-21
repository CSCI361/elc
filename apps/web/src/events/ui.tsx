import { Input } from "@base-ui/react/input"
import {
  Children,
  isValidElement,
  useId,
  type ComponentProps,
  type ReactNode,
} from "react"
import { Select } from "@/components/ui/select"
import { Bar, SkeletonRegion } from "@/components/ui/skeleton"
import { AuthNotice } from "@/auth/notice"
import { AccountPage } from "@/auth/account-page"
import { useAccount } from "@/auth/context"
import { authHref } from "@/auth/navigation"
import { canRetry, EventApiError, errorKey } from "./api"
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
      {retry && canRetry(error) ? (
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
    <SkeletonRegion label={t("loading")} className="page-skeleton">
      <Bar width="40%" height={32} />
      <Bar width="60%" height={16} style={{ marginTop: 12 }} />
      <div className="page-skeleton-rows">
        {[0, 1, 2, 3].map((row) => (
          <Bar key={row} height={56} radius={10} />
        ))}
      </div>
    </SkeletonRegion>
  )
}
export function SectionLoading({ rows = 4 }: { rows?: number }) {
  const { t } = useEventText()
  return (
    <SkeletonRegion label={t("loading")} className="section-skeleton">
      {Array.from({ length: rows }, (_, row) => (
        <Bar key={row} height={56} radius={10} />
      ))}
    </SkeletonRegion>
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
}: {
  label: string
  children: ReactNode
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  name?: string
  id?: string
  disabled?: boolean
  required?: boolean
  placeholder?: string
}) {
  const labelId = useId()
  const options = Children.toArray(children).flatMap((child) =>
    isValidElement<ComponentProps<"option">>(child) && child.type === "option"
      ? [
          {
            value: String(child.props.value ?? ""),
            label: child.props.children,
            disabled: child.props.disabled,
          },
        ]
      : []
  )
  return (
    <div className="event-field">
      <span id={labelId} className="field-label">
        {label}
      </span>
      <Select {...props} options={options} labelledBy={labelId} />
    </div>
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
