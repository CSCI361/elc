import { useState, type FormEvent } from "react"
import {
  offlineDeviceSchema,
  reportedOfflineAdmissionSchema,
  revokeOfflineDeviceSchema,
  reviewOfflineAdmissionSchema,
  type OfflineDevice,
} from "@elc/shared"
import { Button } from "@/components/ui/button"
import { EventApiError, segment } from "@/events/api"
import { EventError, SelectField, TextArea } from "@/events/ui"
import type { OfflineCommands } from "./commands"
import { useOfflineText } from "./messages"
import { useOfflineCommand, commandText, authorityFailed } from "./use-command"

export type AdmissionReport = ReturnType<
  typeof reportedOfflineAdmissionSchema.parse
>
function CommandNotice({
  commands,
  id,
  reload,
}: {
  commands: OfflineCommands
  id: string
  reload: () => void
}) {
  const { t } = useOfflineText()
  const command = useOfflineCommand(commands, id)
  if (command?.phase === "succeeded") return <p role="status">{t("saved")}</p>
  if (command?.phase === "uncertain")
    return (
      <p className="offline-notice" role="alert">
        {t("uncertain")}
      </p>
    )
  if (command?.phase === "failed")
    return (
      <EventError
        error={command.error}
        retry={() => {
          commands.resetFailed(id)
          reload()
        }}
      />
    )
  return null
}
export function DeviceForm({
  device,
  commands,
  reload,
}: {
  device: OfflineDevice
  commands: OfflineCommands
  reload: () => void
}) {
  const { t } = useOfflineText()
  const id = `device:${device.id}`
  const command = useOfflineCommand(commands, id)
  const [reason, setReason] = useState(() => commandText(command, "reason"))
  const [lost, setLost] = useState(() => command?.request.body.lost === true)
  const [validation, setValidation] = useState<unknown>(null)
  const uncertain = command?.phase === "uncertain"
  const busy = command?.phase === "pending"
  const conflict =
    command?.phase === "failed" &&
    command.error instanceof EventApiError &&
    command.error.status === 409
  const locked = busy || uncertain || conflict || command?.phase === "succeeded"
  async function submit(event: FormEvent) {
    event.preventDefault()
    const body = { expectedRevision: device.revision, reason, lost }
    if (
      !uncertain &&
      !revokeOfflineDeviceSchema.safeParse({ ...body, requestId: "validate" })
        .success
    ) {
      setValidation(new EventApiError("INVALID_INPUT", 400))
      return
    }
    setValidation(null)
    if (
      await commands.submit(
        id,
        `/events/${segment(device.eventId)}/offline/devices/${segment(device.id)}/revoke`,
        offlineDeviceSchema,
        body
      )
    )
      reload()
    else if (authorityFailed(commands.get(id))) reload()
  }
  if (command?.phase === "succeeded")
    return <CommandNotice commands={commands} id={id} reload={reload} />
  return (
    <form
      onSubmit={submit}
      className="offline-form"
      aria-label={`${t("revoke")}: ${device.label}`}
    >
      <p className="field-hint">{t("revokeHint")}</p>
      <CommandNotice commands={commands} id={id} reload={reload} />
      {validation ? <EventError error={validation} /> : null}
      <p className="field-hint">{t("reasonHint")}</p>
      <fieldset disabled={locked}>
        <TextArea
          label={t("reason")}
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          maxLength={500}
          rows={3}
        />
        <label className="offline-check">
          <input
            type="checkbox"
            name="lost"
            checked={lost}
            onChange={(event) => setLost(event.target.checked)}
          />
          {t("lost")}
        </label>
      </fieldset>
      {lost ? <p>{t("lossHint")}</p> : null}
      <Button type="submit" disabled={busy || conflict}>
        {t(busy ? "pending" : uncertain ? "retry" : "revoke")}
      </Button>
    </form>
  )
}
export function AdmissionForm({
  report,
  commands,
  reload,
}: {
  report: AdmissionReport
  commands: OfflineCommands
  reload: () => void
}) {
  const { t } = useOfflineText()
  const id = `admission:${report.operationId}`
  const command = useOfflineCommand(commands, id)
  const [reason, setReason] = useState(() => commandText(command, "reason"))
  const [resolution, setResolution] = useState(() =>
    commandText(command, "resolution")
  )
  const [validation, setValidation] = useState<unknown>(null)
  const uncertain = command?.phase === "uncertain"
  const busy = command?.phase === "pending"
  const conflict =
    command?.phase === "failed" &&
    command.error instanceof EventApiError &&
    command.error.status === 409
  const locked = busy || uncertain || conflict || command?.phase === "succeeded"
  async function submit(event: FormEvent) {
    event.preventDefault()
    const body = { expectedRevision: report.revision, reason, resolution }
    if (
      !uncertain &&
      !reviewOfflineAdmissionSchema.safeParse({
        ...body,
        requestId: "validate",
      }).success
    ) {
      setValidation(new EventApiError("INVALID_INPUT", 400))
      return
    }
    setValidation(null)
    if (
      await commands.submit(
        id,
        `/events/${segment(report.eventId)}/offline/admissions/${segment(report.operationId)}/review`,
        reportedOfflineAdmissionSchema,
        body
      )
    )
      reload()
    else if (authorityFailed(commands.get(id))) reload()
  }
  if (command?.phase === "succeeded")
    return <CommandNotice commands={commands} id={id} reload={reload} />
  return (
    <form
      onSubmit={submit}
      className="offline-form"
      aria-label={`${t("review")}: ${report.operationId}`}
    >
      <p className="field-hint">{t("reviewHint")}</p>
      <CommandNotice commands={commands} id={id} reload={reload} />
      {validation ? <EventError error={validation} /> : null}
      <p className="field-hint">{t("reasonHint")}</p>
      <fieldset disabled={locked}>
        <SelectField
          label={t("resolution")}
          name="resolution"
          value={resolution}
          onChange={(event) => setResolution(event.target.value)}
          required
        >
          <option value="">{t("choose")}</option>
          <option value="no_admission">{t("no_admission")}</option>
          <option value="admission_confirmed">
            {t("admission_confirmed")}
          </option>
        </SelectField>
        <TextArea
          label={t("reason")}
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          maxLength={500}
          rows={3}
        />
      </fieldset>
      <Button type="submit" disabled={busy || conflict}>
        {t(busy ? "pending" : uncertain ? "retry" : "submitReview")}
      </Button>
    </form>
  )
}
