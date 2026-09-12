import { paymentResponseSchema } from "@elc/shared"
import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { segment, useCommand, useResource } from "./api"
import { useEventText } from "./messages"
import { money, safePaymentUrl } from "./policies"
import { EventError, Loading } from "./ui"

export function PaymentPage({ attemptId }: { attemptId: string }) {
  const { locale, t } = useEventText()
  const resource = useResource(
    `/payments/${segment(attemptId)}`,
    paymentResponseSchema,
    5000
  )
  const command = useCommand()
  const paymentState = resource.data?.payment.state
  const send = command.send
  const update = resource.update
  useEffect(() => {
    if (paymentState !== "pending") return
    const reconcile = () => {
      if (document.visibilityState !== "visible") return
      void send(
        `/payments/${segment(attemptId)}/reconcile`,
        paymentResponseSchema,
        {}
      ).then((result) => {
        if (result) update(result)
      })
    }
    const first = window.setTimeout(reconcile, 0)
    const timer = window.setInterval(reconcile, 10000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [attemptId, paymentState, send, update])
  if (!resource.data)
    return resource.error ? (
      <EventError error={resource.error} retry={resource.reload} />
    ) : (
      <Loading />
    )
  const { payment } = resource.data
  const url = safePaymentUrl(payment.checkoutUrl, window.location.origin)
  const subject =
    payment.purpose === "ticket_order"
      ? `/orders/${segment(payment.subjectId)}`
      : `/organizer/events/${segment(payment.subjectId)}`
  return (
    <div className="events-page payment-page">
      <section className="event-panel">
        <span className="eyebrow">elc / {t("paymentTitle")}</span>
        <h1>{t(payment.state)}</h1>
        <strong className="payment-amount">
          {money(payment.amountMinor, locale)}
        </strong>
        <p>{t("paymentNote")}</p>
        {resource.error ? (
          <EventError error={resource.error} retry={resource.reload} />
        ) : null}
        {command.error ? (
          <EventError error={command.error} retry={resource.reload} />
        ) : null}
        {payment.state === "pending" && url ? (
          <a className="primary-link" href={url} rel="noreferrer">
            {t("pay")}
          </a>
        ) : payment.state === "pending" ? (
          <p role="status">{t("paymentPending")}</p>
        ) : null}
        <Button
          variant="outline"
          className="auth-button"
          disabled={command.pending}
          onClick={() => {
            void command
              .send(
                `/payments/${segment(attemptId)}/reconcile`,
                paymentResponseSchema,
                {}
              )
              .then((result) => {
                if (result) resource.reload()
              })
          }}
        >
          {t("reload")}
        </Button>
        <a className="secondary-link" href={subject}>
          {t(payment.purpose === "ticket_order" ? "order" : "editEvent")}
        </a>
      </section>
    </div>
  )
}
