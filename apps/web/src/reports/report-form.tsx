import { useState, type FormEvent } from "react"
import {
  eventReportCategorySchema,
  eventReportReceiptSchema,
} from "@elc/shared"
import { EventApiError, segment, useCommand } from "../events/api"
import { EventError, SelectField, TextArea } from "../events/ui"
import { useReportText } from "./messages"
import { reportDraft } from "./policies"

interface EventReportFormProps {
  eventId: string
}

export function EventReportForm({ eventId }: EventReportFormProps) {
  const { t } = useReportText()
  const command = useCommand()
  const [category, setCategory] = useState("misleading")
  const [details, setDetails] = useState("")
  const [sent, setSent] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSent(false)
    const draft = reportDraft(category, details)
    if (!draft.ok) {
      command.setError(new EventApiError("INVALID_INPUT", 400))
      return
    }
    const result = await command.send(
      `/events/${segment(eventId)}/reports`,
      eventReportReceiptSchema,
      draft.body
    )
    if (!result) return
    if (result.eventId !== eventId) {
      command.setError(new EventApiError("INVALID_RESPONSE", 502))
      return
    }
    setSent(true)
  }

  return (
    <details className="event-panel event-report">
      <summary>{t("reportTitle")}</summary>
      <p>{t("reportIntro")}</p>
      <form onSubmit={submit}>
        <SelectField
          label={t("category")}
          value={category}
          disabled={command.pending}
          onValueChange={(value) => setCategory(value)}
        >
          {eventReportCategorySchema.options.map((option) => (
            <option key={option} value={option}>
              {t(option)}
            </option>
          ))}
        </SelectField>
        <TextArea
          label={t("details")}
          required
          maxLength={1000}
          value={details}
          disabled={command.pending}
          onChange={(event) => setDetails(event.target.value)}
        />
        <p className="field-hint">{t("detailsHint")}</p>
        {command.error ? <EventError error={command.error} /> : null}
        {sent ? <p role="status">{t("submitted")}</p> : null}
        <button
          type="submit"
          className="secondary-link"
          disabled={command.pending}
        >
          {t("submit")}
        </button>
      </form>
    </details>
  )
}
