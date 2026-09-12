import {
  cancelEventRequestSchema,
  eventMutationResponseSchema,
  type EventApi,
} from "@elc/shared"
import { type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { EventApiError, segment, useCommand } from "@/events/api"
import { useEventText } from "@/events/messages"
import { EventError, TextArea } from "@/events/ui"
import { useSupportText } from "./messages"
import "./support.css"
export function CancellationPanel({
  event,
  onChanged,
}: {
  event: EventApi
  onChanged: () => void
}) {
  const { t } = useSupportText(),
    { t: eventText } = useEventText(),
    command = useCommand()
  async function cancel(submission: FormEvent<HTMLFormElement>) {
    submission.preventDefault()
    const input = cancelEventRequestSchema.safeParse({
      requestId: "validate",
      expectedRevision: event.revision,
      reason: new FormData(submission.currentTarget).get("reason"),
    })
    if (!input.success) {
      command.setError(new EventApiError("INVALID_INPUT", 400))
      return
    }
    const result = await command.send(
      `/events/${segment(event.id)}/cancel`,
      eventMutationResponseSchema,
      input.data
    )
    if (result) onChanged()
  }
  if (event.cancelledAt)
    return (
      <section className="event-panel">
        <h2>{eventText("cancelled")}</h2>
        <p role="status">{t("eventCancelled")}</p>
      </section>
    )
  return (
    <details className="event-panel cancel-event">
      <summary>{t("cancelEvent")}</summary>
      <p>{t("cancelEventHint")}</p>
      {command.error ? (
        <EventError error={command.error} retry={onChanged} />
      ) : null}
      <form onSubmit={cancel} className="support-form">
        <fieldset disabled={command.pending}>
          <TextArea
            label={t("reason")}
            name="reason"
            minLength={3}
            maxLength={500}
            required
            rows={3}
          />
          <Button type="submit" variant="destructive">
            {command.pending ? eventText("loading") : t("cancelEventSubmit")}
          </Button>
        </fieldset>
      </form>
    </details>
  )
}
