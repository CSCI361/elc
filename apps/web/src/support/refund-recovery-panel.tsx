import {
  refundRecoveryResponseSchema,
  refundRecoveryViewSchema,
} from "@elc/shared"
import { useState, type FormEvent } from "react"
import { AuthNotice } from "@/auth/notice"
import { Button } from "@/components/ui/button"
import { EventApiError, segment, useCommand, useResource } from "@/events/api"
import { useEventText } from "@/events/messages"
import { EventError, Loading, TextArea } from "@/events/ui"
import { useSupportText } from "./messages"
import {
  refundRecoveryActions,
  refundRecoveryInput,
} from "./refund-recovery-policies"

export function RefundRecoveryPanel({
  refundId,
  onQueued,
}: {
  refundId: string
  onQueued: () => void
}) {
  const { locale, t } = useSupportText(),
    { t: eventText } = useEventText()
  const resource = useResource(
    `/refunds/${segment(refundId)}/recovery`,
    refundRecoveryViewSchema,
    10000
  )
  const command = useCommand()
  const [reason, setReason] = useState("")
  const [requiresRefresh, setRequiresRefresh] = useState(false)
  const refresh = () => {
    command.setError(null)
    setRequiresRefresh(false)
    resource.reload()
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!resource.data || resource.error || requiresRefresh) return
    const submitter =
      event.nativeEvent instanceof SubmitEvent
        ? event.nativeEvent.submitter
        : null
    const input = refundRecoveryInput(
      resource.data,
      submitter instanceof HTMLButtonElement ? submitter.value : "reconcile",
      reason
    )
    if (!input) {
      command.setError(new EventApiError("INVALID_INPUT", 400))
      return
    }
    const result = await command.send(
      `/refunds/${segment(refundId)}/recovery`,
      refundRecoveryResponseSchema,
      input
    )
    if (result) {
      setReason("")
      resource.reload()
      onQueued()
    } else setRequiresRefresh(true)
  }
  if (resource.error)
    return (
      <section className="refund-recovery">
        <h3>{t("recoveryTitle")}</h3>
        {resource.error instanceof EventApiError &&
        [401, 403, 404].includes(resource.error.status) ? (
          <AuthNotice>
            {t("recoveryDenied")}{" "}
            <button type="button" className="text-action" onClick={refresh}>
              {eventText("reload")}
            </button>
          </AuthNotice>
        ) : (
          <EventError error={resource.error} retry={refresh} />
        )}
      </section>
    )
  if (!resource.data) return <Loading />
  const view = resource.data,
    actions = requiresRefresh ? [] : refundRecoveryActions(view)
  return (
    <section className="refund-recovery">
      <div className="support-timeline-heading">
        <h3>{t("recoveryTitle")}</h3>
        <button
          type="button"
          className="text-action"
          onClick={refresh}
          disabled={command.pending}
        >
          {eventText("reload")}
        </button>
      </div>
      <p>{t("recoveryAuthority")}</p>
      <p role="status">
        {view.recoveryPending
          ? t("recoveryPending")
          : t(`refund_${view.state}`)}
      </p>
      <p className="support-meta">
        {t("recoveryUpdatedAt")}:{" "}
        <time dateTime={view.updatedAt}>
          {new Intl.DateTimeFormat(locale, {
            dateStyle: "medium",
            timeStyle: "long",
          }).format(new Date(view.updatedAt))}
        </time>
      </p>
      <p>{t("recoveryBlocks")}</p>
      {command.error ? (
        command.error instanceof EventApiError &&
        command.error.status === 409 ? (
          <AuthNotice>
            {t("recoveryConflict")}{" "}
            <button type="button" className="text-action" onClick={refresh}>
              {eventText("reload")}
            </button>
          </AuthNotice>
        ) : requiresRefresh ? (
          <AuthNotice>
            {t("recoveryRequestUnconfirmed")}{" "}
            <button type="button" className="text-action" onClick={refresh}>
              {eventText("reload")}
            </button>
          </AuthNotice>
        ) : (
          <EventError error={command.error} retry={refresh} />
        )
      ) : null}
      {actions.length ? (
        <form className="support-form" onSubmit={submit}>
          <fieldset disabled={command.pending}>
            <TextArea
              label={t("reason")}
              name="reason"
              required
              minLength={3}
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
            />
            {actions.map((action) => (
              <div className="refund-recovery-action" key={action}>
                <p id={`recovery-${refundId}-${action}`}>
                  {t(
                    action === "reconcile"
                      ? "recoveryReconcileHint"
                      : "recoveryRetryHint"
                  )}
                </p>
                <Button
                  type="submit"
                  name="action"
                  value={action}
                  aria-describedby={`recovery-${refundId}-${action}`}
                >
                  {command.pending
                    ? eventText("loading")
                    : t(
                        action === "reconcile"
                          ? "recoveryReconcile"
                          : "recoveryRetry"
                      )}
                </Button>
              </div>
            ))}
            {!view.canRetryRejected ? (
              <p className="field-hint">{t("recoveryUncertain")}</p>
            ) : null}
          </fieldset>
        </form>
      ) : null}
    </section>
  )
}
