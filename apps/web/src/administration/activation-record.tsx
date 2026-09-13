import type { ActivationResponse } from "@elc/shared"
import { useEventText } from "../events/messages"
import { money } from "../events/policies"
import { useAdministrationText } from "./messages"

export function ActivationRecord({
  activation,
}: {
  activation: ActivationResponse["activation"]
}) {
  const { t, locale } = useEventText()
  const { t: adminText } = useAdministrationText()
  const check = (state: "pending" | "passed" | "failed") =>
    adminText(
      state === "passed"
        ? "checkPassed"
        : state === "failed"
          ? "checkFailed"
          : "checkPending"
    )
  return (
    <div className="administration-record">
      <p>{t("activationDemo")}</p>
      <p>
        <strong>
          {t(
            activation.eligibility === "active"
              ? "paidEnabled"
              : activation.eligibility === "suspended"
                ? "activationSuspended"
                : "activationPending"
          )}
        </strong>
      </p>
      {activation.blockers.length ? (
        <ul>
          {activation.blockers.map((blocker) => (
            <li key={blocker}>{t(blocker)}</li>
          ))}
        </ul>
      ) : null}
      <dl>
        {activation.profile ? (
          <>
            <dt>{t("organizerName")}</dt>
            <dd>{activation.profile.displayName}</dd>
            <dt>{t("demoLegalName")}</dt>
            <dd>{activation.profile.legalName}</dd>
            <dt>{t("organizerContact")}</dt>
            <dd>{activation.profile.contact}</dd>
            <dt>{t("dummyPayout")}</dt>
            <dd>{activation.profile.dummyPayoutReference}</dd>
          </>
        ) : null}
        <dt>{t("simulatedIdentity")}</dt>
        <dd>{check(activation.identityCheck.state)}</dd>
        <dt>{t("simulatedPayout")}</dt>
        <dd>{check(activation.payoutCheck.state)}</dd>
        <dt>{adminText("acceptedTerms")}</dt>
        <dd>{activation.terms.acceptedVersion ?? adminText("notRecorded")}</dd>
        <dt>
          {t(
            activation.fee.paidMinor === null ? "activationFee" : "feeRetained"
          )}
        </dt>
        <dd>
          {money(
            activation.fee.paidMinor ?? activation.fee.configuredMinor,
            locale
          )}
        </dd>
        {activation.latestPayment ? (
          <>
            <dt>{t("paymentTitle")}</dt>
            <dd>
              {t(activation.latestPayment.state)}
              <br />
              {activation.latestPayment.id}
            </dd>
            {activation.latestPayment.refundState ? (
              <>
                <dt>{t("refundStatus")}</dt>
                <dd>{t(activation.latestPayment.refundState)}</dd>
              </>
            ) : null}
          </>
        ) : null}
        {activation.suspensionReason ? (
          <>
            <dt>{adminText("reason")}</dt>
            <dd>{activation.suspensionReason}</dd>
          </>
        ) : null}
      </dl>
    </div>
  )
}
