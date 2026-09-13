import {
  approveOrderRefundSchema,
  cancelRegistrationSchema,
  orderCancellationResponseSchema,
  orderRefundResponseSchema,
  refundApprovalResponseSchema,
  type SupportCase,
} from "@elc/shared"
import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { useAccount } from "@/auth/context"
import { RefundRecoveryPanel } from "./refund-recovery-panel"
import { AuthNotice } from "@/auth/notice"
import { EventApiError, segment, useCommand, useResource } from "@/events/api"
import { useEventText } from "@/events/messages"
import { money } from "@/events/policies"
import { EventError, Field, Loading, TextArea } from "@/events/ui"
import {
  financialActionAvailable,
  matchingRefundCase,
  supportHref,
} from "./policies"
import { useSupportText, type SupportMessageKey } from "./messages"

export function RefundPanel({
  orderId,
  supportCase,
  onChanged,
}: {
  orderId: string
  supportCase?: SupportCase
  onChanged?: () => void
}) {
  const { account } = useAccount()
  const { locale, t } = useSupportText(),
    { t: eventText } = useEventText()
  const resource = useResource(
      `/orders/${segment(orderId)}/refund`,
      orderRefundResponseSchema,
      10000
    ),
    command = useCommand()
  const [notice, setNotice] = useState<SupportMessageKey | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!resource.data) return
    const values = new FormData(event.currentTarget),
      paid = resource.data.totalMinor > 0
    const input = {
      requestId: "validate",
      expectedRevision: resource.data.revision,
      reason: values.get("reason"),
      ...(paid ? { caseId: supportCase?.id ?? values.get("caseId") } : {}),
    }
    const parsed = paid
      ? approveOrderRefundSchema.safeParse(input)
      : cancelRegistrationSchema.safeParse(input)
    if (!parsed.success) {
      command.setError(new EventApiError("INVALID_INPUT", 400))
      return
    }
    const result = paid
      ? await command.send(
          `/orders/${segment(orderId)}/refund`,
          refundApprovalResponseSchema,
          parsed.data
        )
      : await command.send(
          `/orders/${segment(orderId)}/cancel-registration`,
          orderCancellationResponseSchema,
          parsed.data
        )
    if (result) {
      setNotice(paid ? "refundQueued" : "registrationCancelled")
      resource.reload()
      onChanged?.()
    }
  }
  if (resource.error)
    return (
      <section className="event-panel">
        <h2>{t("refundTitle")}</h2>
        {resource.error instanceof EventApiError &&
        [403, 404].includes(resource.error.status) ? (
          <p>{t("refundDenied")}</p>
        ) : (
          <EventError error={resource.error} retry={resource.reload} />
        )}
      </section>
    )
  if (!resource.data) return <Loading />
  const view = resource.data,
    paid = view.totalMinor > 0,
    available = financialActionAvailable(view),
    validCase = !supportCase || matchingRefundCase(supportCase, orderId)
  return (
    <section className="event-panel refund-panel">
      <h2>{t("refundTitle")}</h2>
      {notice ? <AuthNotice tone="success">{t(notice)}</AuthNotice> : null}
      <dl className="order-totals">
        <div>
          <dt>{t("total")}</dt>
          <dd>{money(view.totalMinor, locale)}</dd>
        </div>
        {view.refund ? (
          <div>
            <dt>{t("refundAmount")}</dt>
            <dd>{money(view.refund.amountMinor, locale)}</dd>
          </div>
        ) : null}
        {view.canApprove ? (
          <>
            <div>
              <dt>{t("originalFee")}</dt>
              <dd>{money(view.originalProcessingFeeMinor, locale)}</dd>
            </div>
            <div>
              <dt>{t("remainingFee")}</dt>
              <dd>{money(view.remainingProcessingFeeMinor, locale)}</dd>
            </div>
            <div>
              <dt>{t("payoutContribution")}</dt>
              <dd>{money(view.estimatedPayoutContributionMinor, locale)}</dd>
            </div>
          </>
        ) : null}
      </dl>
      {view.refund ? (
        <>
          <p role="status">{t(`refund_${view.refund.state}`)}</p>
          {view.refund.reconciliationRequired ? (
            <p>{t("reconciliation")}</p>
          ) : null}
        </>
      ) : null}
      {view.canApprove && view.refund ? (
        <RefundRecoveryPanel
          key={`${view.refund.id}:${account?.user.id}`}
          refundId={view.refund.id}
          onQueued={() => {
            setNotice("recoveryQueued")
            resource.reload()
            onChanged?.()
          }}
        />
      ) : null}
      {view.payoutHeld ? (
        <p className="support-notice">{t("payoutHeld")}</p>
      ) : null}
      <p>{t("refundHint")}</p>
      <p className="preserve-lines">{view.refundPolicy.instructions}</p>
      {command.error ? (
        command.error instanceof EventApiError &&
        command.error.code === "REFUND_INELIGIBLE" ? (
          <AuthNotice>
            {t("refundUnavailable")}{" "}
            <button
              type="button"
              className="text-action"
              onClick={resource.reload}
            >
              {eventText("reload")}
            </button>
          </AuthNotice>
        ) : (
          <EventError error={command.error} retry={resource.reload} />
        )
      ) : null}
      {available && validCase ? (
        <form onSubmit={submit} className="support-form">
          <fieldset disabled={command.pending}>
            {paid && !supportCase ? (
              <>
                <Field
                  label={t("reference")}
                  name="caseId"
                  required
                  maxLength={128}
                />
                <p className="field-hint">{t("refundCaseHint")}</p>
              </>
            ) : null}
            <TextArea
              label={t("reason")}
              name="reason"
              required
              minLength={3}
              maxLength={500}
              rows={3}
            />
            <Button type="submit">
              {command.pending
                ? eventText("loading")
                : t(paid ? "approveRefund" : "cancelRegistration")}
            </Button>
          </fieldset>
        </form>
      ) : !paid && view.orderState === "cancelled" ? (
        <p>{t("registrationCancelled")}</p>
      ) : !view.refund &&
        (!view.voluntaryEligible || (view.canApprove && !validCase)) ? (
        <p>{t("refundUnavailable")}</p>
      ) : null}
      {!view.canApprove &&
      !supportCase &&
      !view.refund &&
      view.orderState === "completed" ? (
        <a
          className="secondary-link"
          href={supportHref({
            orderId,
            eventId: view.eventId,
            audience: "attendee",
            category: "refund",
          })}
        >
          {t(paid ? "requestRefund" : "requestCancellation")}
        </a>
      ) : null}
    </section>
  )
}
export function RefundPage({ orderId }: { orderId: string }) {
  const { t } = useSupportText()
  return (
    <div className="events-page support-page">
      <a className="back-link" href="/support">
        {t("support")}
      </a>
      <RefundPanel orderId={orderId} />
    </div>
  )
}
