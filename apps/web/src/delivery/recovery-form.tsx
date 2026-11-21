import {
  deliveryRecoveryResponseSchema,
  requestDeliveryRecoverySchema,
  type DeliveryInspection,
} from "@elc/shared"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { AuthNotice } from "@/auth/notice"
import { Button } from "@/components/ui/button"
import { EventApiError, mutation, segment } from "@/events/api"
import { EventError, SelectField, TextArea } from "@/events/ui"
import { useDeliveryText } from "./messages"
import {
  canDiscardRejectedRecovery,
  readPending,
  recoveryKey,
  type PendingRecovery,
} from "./policies"

export function RecoveryForm({
  delivery,
  accountId,
  reload,
  deny,
  settled,
}: {
  delivery: DeliveryInspection
  accountId: string
  reload: () => void
  deny: (error: unknown) => void
  settled: (notice: "queued" | "stale" | "invalidReason") => void
}) {
  const { t } = useDeliveryText(),
    key = recoveryKey(accountId, delivery.id)
  const [saved, setSaved] = useState<PendingRecovery | null>(() => {
    try {
      return readPending(sessionStorage.getItem(key), accountId, delivery.id)
    } catch {
      return null
    }
  })
  const [busy, setBusy] = useState(false),
    guard = useRef(false),
    mounted = useRef(true)
  const [reason, setReason] = useState(""),
    [selected, setSelected] = useState("")
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<"invalidReason" | "storage" | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const mode = delivery.allowedRecoveryModes.includes(
    selected as (typeof delivery.allowedRecoveryModes)[number]
  )
    ? selected
    : (delivery.allowedRecoveryModes[0] ?? "")
  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (guard.current) return
    const wasUncertain = !!saved
    let operation = saved
    if (!operation) {
      const input = requestDeliveryRecoverySchema.safeParse({
        requestId: crypto.randomUUID(),
        reason,
        expectedUpdatedAt: delivery.updatedAt,
        mode,
      })
      if (!input.success) {
        setNotice("invalidReason")
        return
      }
      operation = {
        version: 1,
        accountId,
        deliveryId: delivery.id,
        input: input.data,
      }
    }
    try {
      sessionStorage.setItem(key, JSON.stringify(operation))
    } catch {
      setNotice("storage")
      return
    }
    guard.current = true
    setBusy(true)
    setSaved(operation)
    setError(null)
    setNotice(null)
    try {
      await mutation(
        `/admin/deliveries/${segment(delivery.id)}/recover`,
        deliveryRecoveryResponseSchema,
        operation.input
      )
      if (!mounted.current) return
      try {
        sessionStorage.removeItem(key)
      } catch {
        /* A retained operation can only replay the same receipt. */
      }
      setSaved(null)
      setReason("")
      settled("queued")
      reload()
    } catch (failure) {
      if (!mounted.current) return
      const status =
        failure instanceof EventApiError ? failure.status : undefined
      if (canDiscardRejectedRecovery(wasUncertain, status)) {
        try {
          sessionStorage.removeItem(key)
        } catch {
          /* The rejected operation remains safe to retry. */
        }
        setSaved(null)
        settled(status === 409 ? "stale" : "invalidReason")
        reload()
      } else {
        setError(failure)
        if ([401, 403, 404].includes(status ?? 0)) deny(failure)
      }
    } finally {
      guard.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const hint =
    mode === "retry_preparation"
      ? "preparationHint"
      : mode === "retry_same_request"
        ? "sameHint"
        : "reconcileHint"
  return (
    <section className="event-panel delivery-recovery">
      <h2>{t("recovery")}</h2>
      {notice ? <AuthNotice>{t(notice)}</AuthNotice> : null}
      {saved ? (
        <>
          <p role="status">{busy ? t("submitting") : t("uncertain")}</p>
          <dl className="delivery-data">
            <div>
              <dt>{t("mode")}</dt>
              <dd>{t(saved.input.mode)}</dd>
            </div>
            <div>
              <dt>{t("reason")}</dt>
              <dd>{saved.input.reason}</dd>
            </div>
          </dl>
          <Button type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? t("submitting") : t("retrySame")}
          </Button>
        </>
      ) : mode ? (
        <form onSubmit={(event) => void submit(event)}>
          <SelectField
            label={t("mode")}
            aria-label={t("mode")}
            value={mode}
            onValueChange={(value) => setSelected(value)}
          >
            {delivery.allowedRecoveryModes.map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </SelectField>
          <p className="field-hint">{t(hint)}</p>
          <TextArea
            label={t("reason")}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            minLength={3}
            maxLength={500}
            aria-describedby="recovery-reason-hint"
          />
          <p className="field-hint" id="recovery-reason-hint">
            {t("reasonHint")}
          </p>
          <Button type="submit" disabled={busy}>
            {t("submit")}
          </Button>
        </form>
      ) : (
        <p>{t("unavailable")}</p>
      )}
      {error ? <EventError error={error} /> : null}
    </section>
  )
}
