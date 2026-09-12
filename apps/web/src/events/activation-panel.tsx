import {
  activationResponseSchema,
  paymentResponseSchema,
  updateActivationSchema,
  type ActivationResponse,
} from "@elc/shared"
import { CheckCircleIcon, CreditCardIcon } from "@phosphor-icons/react"
import { useState, type FormEvent } from "react"
import { useAccount } from "@/auth/context"
import { Button } from "@/components/ui/button"
import { EventApiError, segment, useCommand, useResource } from "./api"
import { useEventText } from "./messages"
import { money } from "./policies"
import { EventError, Field, Loading, SelectField } from "./ui"

type Activation = ActivationResponse["activation"]

function ActivationForm({
  activation,
  onSaved,
}: {
  activation: Activation
  onSaved: () => void
}) {
  const { t, locale } = useEventText()
  const { account } = useAccount()
  const command = useCommand()
  const [identity, setIdentity] = useState(activation.identityCheck.state)
  const [payout, setPayout] = useState(activation.payoutCheck.state)
  const [accepted, setAccepted] = useState(
    activation.terms.acceptedVersion === activation.terms.version
  )
  const latest = activation.latestPayment
  const feePaid = activation.fee.successfulPaymentAttemptId !== null
  const paymentUnresolved =
    latest &&
    (latest.state === "pending" ||
      latest.refundState === "pending" ||
      latest.refundState === "failed" ||
      (latest.state === "succeeded" &&
        !feePaid &&
        latest.refundState !== "succeeded"))
  const canPay =
    !feePaid &&
    !paymentUnresolved &&
    activation.blockers.every((blocker) => blocker === "fee_required")

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const value = (key: string) => {
      const entry = form.get(key)
      return typeof entry === "string" ? entry : ""
    }
    const body = {
      expectedRevision: activation.revision,
      profile: {
        displayName: value("displayName"),
        legalName: value("legalName"),
        contact: value("contact"),
        dummyPayoutReference: value("dummyPayoutReference"),
      },
      identityCheck: identity,
      payoutCheck: payout,
      acceptedTermsVersion: accepted ? activation.terms.version : null,
    }
    if (
      !updateActivationSchema.safeParse({ ...body, requestId: "validate" })
        .success
    ) {
      command.setError(new EventApiError("INVALID_INPUT", 400))
      return
    }
    const result = await command.send(
      `/events/${segment(activation.eventId)}/activation`,
      activationResponseSchema,
      body,
      "PATCH"
    )
    if (result) onSaved()
  }

  return (
    <div className="activation-content">
      <p className="event-inline-note">{t("activationDemo")}</p>
      <div className="activation-status">
        <CheckCircleIcon size={22} aria-hidden />
        <strong>
          {t(
            activation.eligibility === "active"
              ? "paidEnabled"
              : activation.eligibility === "suspended"
                ? "activationSuspended"
                : "activationPending"
          )}
        </strong>
      </div>
      {activation.blockers.length ? (
        <ul className="activation-blockers">
          {activation.blockers.map((blocker) => (
            <li key={blocker}>{t(blocker)}</li>
          ))}
        </ul>
      ) : null}
      {activation.suspensionReason ? (
        <p className="preserve-lines">{activation.suspensionReason}</p>
      ) : null}
      {command.error ? (
        <EventError error={command.error} retry={onSaved} />
      ) : null}
      <form onSubmit={save}>
        <fieldset disabled={command.pending}>
          <div className="event-form-grid">
            <Field
              label={t("organizerName")}
              name="displayName"
              required
              maxLength={120}
              defaultValue={
                activation.profile?.displayName ?? account?.user.name ?? ""
              }
            />
            <Field
              label={t("demoLegalName")}
              name="legalName"
              required
              maxLength={200}
              defaultValue={activation.profile?.legalName ?? ""}
            />
            <Field
              label={t("organizerContact")}
              name="contact"
              required
              minLength={3}
              maxLength={200}
              defaultValue={
                activation.profile?.contact ?? account?.user.email ?? ""
              }
            />
            <Field
              label={t("dummyPayout")}
              name="dummyPayoutReference"
              hint={t("dummyPayoutHint")}
              required
              pattern="DEMO-[A-Za-z0-9_-]{3,60}"
              maxLength={65}
              defaultValue={activation.profile?.dummyPayoutReference ?? ""}
            />
          </div>
          <div className="event-form-grid">
            <SelectField
              label={t("simulatedIdentity")}
              value={identity}
              onChange={(event) =>
                setIdentity(
                  event.target.value === "passed" ? "passed" : "failed"
                )
              }
            >
              <option value="pending" disabled>
                {t("checkPending")}
              </option>
              <option value="passed">{t("checkPassed")}</option>
              <option value="failed">{t("checkFailed")}</option>
            </SelectField>
            <SelectField
              label={t("simulatedPayout")}
              value={payout}
              onChange={(event) =>
                setPayout(event.target.value === "passed" ? "passed" : "failed")
              }
            >
              <option value="pending" disabled>
                {t("checkPending")}
              </option>
              <option value="passed">{t("checkPassed")}</option>
              <option value="failed">{t("checkFailed")}</option>
            </SelectField>
          </div>
          <div className="activation-terms">
            <p>{t("activationTerms")}</p>
            <details>
              <summary>{t("termsOriginal")}</summary>
              <p lang="en">{activation.terms.text}</p>
              <small>{activation.terms.version}</small>
            </details>
            <label className="event-checkbox">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
              />
              {t("acceptTerms")}
            </label>
          </div>
          {paymentUnresolved ? (
            <p className="field-hint">{t("checklistDuringPayment")}</p>
          ) : null}
          <Button type="submit" disabled={command.pending}>
            {command.pending ? t("loading") : t("saveChecklist")}
          </Button>
        </fieldset>
      </form>
      <div className="activation-fee">
        <CreditCardIcon size={24} aria-hidden />
        <div>
          <span>{t(feePaid ? "feeRetained" : "activationFee")}</span>
          <strong>
            {money(
              activation.fee.paidMinor ?? activation.fee.configuredMinor,
              locale
            )}
          </strong>
          <p>{t("activationFeeHint")}</p>
        </div>
      </div>
      {latest ? (
        <div className="activation-payment">
          <p>
            {t("paymentTitle")}: {t(latest.state)}
          </p>
          {latest.refundState ? (
            <p>
              {t("refundStatus")}: {t(latest.refundState)}
            </p>
          ) : null}
          <a
            className="secondary-link"
            href={`/payments/${segment(latest.id)}`}
          >
            {t("paymentTitle")}
          </a>
        </div>
      ) : null}
      {!feePaid ? (
        <Button
          className="auth-button"
          disabled={command.pending || !canPay}
          onClick={() => {
            void command
              .send(
                `/events/${segment(activation.eventId)}/activation/payment`,
                paymentResponseSchema,
                { expectedRevision: activation.revision }
              )
              .then((result) => {
                if (result)
                  window.location.assign(
                    `/payments/${segment(result.payment.id)}`
                  )
              })
          }}
        >
          {command.pending ? t("paymentPending") : t("payActivation")}
        </Button>
      ) : null}
    </div>
  )
}

export function ActivationPanel({
  eventId,
  hasPaidTickets,
  onChanged,
}: {
  eventId: string
  hasPaidTickets: boolean
  onChanged: () => void
}) {
  const { t } = useEventText()
  const result = useResource(
    `/events/${segment(eventId)}/activation`,
    activationResponseSchema
  )
  const reload = () => {
    result.reload()
    onChanged()
  }
  return (
    <details className="event-panel activation-panel" open={hasPaidTickets}>
      <summary>
        <h2>{t("enablePaidSales")}</h2>
      </summary>
      {result.loading ? <Loading /> : null}
      {result.error ? <EventError error={result.error} retry={reload} /> : null}
      {result.data ? (
        <ActivationForm
          key={result.data.activation.revision}
          activation={result.data.activation}
          onSaved={reload}
        />
      ) : null}
    </details>
  )
}
