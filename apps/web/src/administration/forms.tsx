import { useEffect, useRef, useState, type FormEvent } from "react"
import {
  activationResponseSchema,
  activationSettingsSchema,
  updateActivationSettingsSchema,
  suspensionRequestSchema,
  suspensionResponseSchema,
  type AccountAdministration,
  type EventAdministration,
} from "@elc/shared"
import { EventApiError, useCommand, useResource } from "../events/api"
import { EventError, Field, Loading } from "../events/ui"
import { useAdministrationText } from "./messages"
import { ActivationRecord } from "./activation-record"

export function SuspensionForm({
  kind,
  item,
  onDone,
  onClose,
}: {
  kind: "account" | "event"
  item: AccountAdministration | EventAdministration
  onDone: () => void
  onClose: () => void
}) {
  const { t } = useAdministrationText(),
    command = useCommand(),
    [reason, setReason] = useState("")
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])
  async function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = suspensionRequestSchema.safeParse({
      requestId: "validation",
      expectedRevision: item.revision,
      suspended: item.suspendedAt === null,
      reason,
    })
    if (!parsed.success) {
      command.setError(new EventApiError("INVALID_INPUT", 400))
      return
    }
    const result = await command.send(
      `/admin/${kind === "account" ? "accounts" : "events"}/${encodeURIComponent(item.id)}/suspension`,
      suspensionResponseSchema,
      {
        expectedRevision: item.revision,
        suspended: parsed.data.suspended,
        reason: parsed.data.reason,
      }
    )
    if (result) {
      if (result.id !== item.id || result.kind !== kind) {
        command.setError(new EventApiError("INVALID_RESPONSE", 502))
        return
      }
      onDone()
    }
  }
  return (
    <section className="event-panel" aria-label={t("review")}>
      <h2 ref={heading} tabIndex={-1}>
        {"name" in item ? item.name : item.title}
      </h2>
      <p className="field-hint">{item.id}</p>
      <p>{t("consequence")}</p>
      <form onSubmit={submit}>
        <Field
          label={t("reason")}
          required
          minLength={3}
          maxLength={500}
          value={reason}
          disabled={command.pending}
          onChange={(event) => setReason(event.target.value)}
        />
        <p className="field-hint">{t("audit")}</p>
        {command.error ? <EventError error={command.error} /> : null}
        <div className="analytics-actions">
          <button
            type="submit"
            className="primary-link"
            disabled={command.pending}
          >
            {t(item.suspendedAt ? "resume" : "suspend")}
          </button>
          <button
            type="button"
            className="text-action"
            disabled={command.pending}
            onClick={onClose}
          >
            {t("close")}
          </button>
        </div>
      </form>
    </section>
  )
}
function SettingsForm({
  initial,
  onDone,
}: {
  initial: ReturnType<typeof activationSettingsSchema.parse>
  onDone: () => void
}) {
  const { t } = useAdministrationText(),
    [amount, setAmount] = useState(String(initial.feeMinor / 100)),
    command = useCommand()
  async function submit(event: FormEvent) {
    event.preventDefault()
    const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(amount.trim())
    const feeMinor = match
      ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"))
      : NaN
    const parsed = updateActivationSettingsSchema.safeParse({
      requestId: "validation",
      expectedRevision: initial.revision,
      feeMinor,
    })
    if (!parsed.success) {
      command.setError(new EventApiError("INVALID_INPUT", 400))
      return
    }
    if (
      await command.send(
        "/platform/activation-settings",
        activationSettingsSchema,
        { expectedRevision: initial.revision, feeMinor },
        "PATCH"
      )
    )
      onDone()
  }
  return (
    <form onSubmit={submit}>
      <Field
        label={t("fee")}
        value={amount}
        inputMode="decimal"
        disabled={command.pending}
        onChange={(event) => setAmount(event.target.value)}
      />
      <p>{t("feeHint")}</p>
      {command.error ? <EventError error={command.error} /> : null}
      <button type="submit" className="primary-link" disabled={command.pending}>
        {t("saveFee")}
      </button>
    </form>
  )
}
export function ActivationFeeSettings() {
  const { t } = useAdministrationText(),
    resource = useResource(
      "/platform/activation-settings",
      activationSettingsSchema,
      15000
    ),
    [saved, setSaved] = useState(false)
  if (resource.error)
    return <EventError error={resource.error} retry={resource.reload} />
  if (!resource.data) return <Loading />
  return (
    <section className="event-panel">
      <h2>{t("settings")}</h2>
      {saved ? <p role="status">{t("saved")}</p> : null}
      <SettingsForm
        key={resource.data.revision}
        initial={resource.data}
        onDone={() => {
          setSaved(true)
          resource.reload()
        }}
      />
    </section>
  )
}
function PaidSalesForm({
  data,
  onDone,
}: {
  data: ReturnType<typeof activationResponseSchema.parse>
  onDone: () => void
}) {
  const { t } = useAdministrationText(),
    [reason, setReason] = useState(""),
    command = useCommand(),
    activation = data.activation
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (reason.trim().length < 3) {
      command.setError(new EventApiError("INVALID_INPUT", 400))
      return
    }
    if (
      await command.send(
        `/platform/events/${encodeURIComponent(activation.eventId)}/activation`,
        activationResponseSchema,
        {
          expectedRevision: activation.revision,
          suspended: activation.suspendedAt === null,
          reason: reason.trim(),
        },
        "PATCH"
      )
    )
      onDone()
  }
  return (
    <form onSubmit={submit}>
      <p>{t("paidHint")}</p>
      <p>
        {t("status")}: {t(activation.suspendedAt ? "suspended" : "active")}
      </p>
      <Field
        label={t("reason")}
        value={reason}
        required
        minLength={3}
        maxLength={500}
        disabled={command.pending}
        onChange={(event) => setReason(event.target.value)}
      />
      {command.error ? <EventError error={command.error} /> : null}
      <button type="submit" className="primary-link" disabled={command.pending}>
        {t(activation.suspendedAt ? "paidResume" : "paidSuspend")}
      </button>
    </form>
  )
}
export function PaidSalesModeration({ eventId }: { eventId: string }) {
  const { t } = useAdministrationText(),
    resource = useResource(
      `/platform/events/${encodeURIComponent(eventId)}/activation`,
      activationResponseSchema,
      15000
    )
  return (
    <section className="event-panel">
      <h2>{t("paid")}</h2>
      {!resource.error && resource.data ? (
        <ActivationRecord activation={resource.data.activation} />
      ) : null}
      {resource.error ? (
        <EventError error={resource.error} retry={resource.reload} />
      ) : resource.data &&
        resource.data.activation.profileUpdatedAt === null ? (
        <p>{t("paidUnavailable")}</p>
      ) : resource.data ? (
        <PaidSalesForm
          key={resource.data.activation.revision}
          data={resource.data}
          onDone={resource.reload}
        />
      ) : (
        <Loading />
      )}
    </section>
  )
}
