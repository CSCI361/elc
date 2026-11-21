import { navigate } from "@/lib/navigation"
import {
  openSupportCaseSchema,
  supportMutationResponseSchema,
  type SupportAudience,
} from "@elc/shared"
import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { AuthNotice } from "@/auth/notice"
import { EventApiError, segment, useCommand } from "@/events/api"
import { useEventText } from "@/events/messages"
import { EventError, Field, SelectField, TextArea } from "@/events/ui"
import { readSupportContext, supportCategories } from "./policies"
import { useSupportText } from "./messages"

export function NewSupportPage() {
  const { t } = useSupportText(),
    { t: eventText } = useEventText(),
    command = useCommand()
  const [context] = useState(() => readSupportContext(window.location.search))
  const hasContext = Boolean(
    context.eventId || context.orderId || context.ticketId
  )
  const [audience, setAudience] = useState<SupportAudience>(
    context.audience ?? (hasContext ? "attendee" : "organizer_platform")
  )
  const categories = supportCategories(context, audience)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const parsed = openSupportCaseSchema.safeParse({
      ...context,
      requestId: "validate",
      audience,
      subject: form.get("subject"),
      category: form.get("category"),
      body: form.get("body"),
    })
    if (!parsed.success) {
      command.setError(new EventApiError("INVALID_INPUT", 400))
      return
    }
    const result = await command.send(
      "/support/cases",
      supportMutationResponseSchema,
      parsed.data
    )
    if (result) navigate(`/support/cases/${segment(result.case.id)}`)
  }
  return (
    <div className="events-page support-page">
      <a className="back-link" href="/support">
        {t("title")}
      </a>
      <h1>{t("newCase")}</h1>
      <section className="event-panel support-new">
        <div className="support-context">
          {context.eventId ? (
            <a
              className="text-action"
              href={`/events/${segment(context.eventId)}`}
            >
              {eventText("details")}
            </a>
          ) : null}
          {context.orderId ? (
            <a
              className="text-action"
              href={`/orders/${segment(context.orderId)}`}
            >
              {eventText("order")}
            </a>
          ) : null}
        </div>
        {!hasContext ? <p>{t("contextHint")}</p> : null}
        {command.error ? <EventError error={command.error} /> : null}
        <form className="support-form" onSubmit={submit}>
          <fieldset disabled={command.pending}>
            <SelectField
              label={t("audience")}
              value={audience}
              onValueChange={(value) => setAudience(value as SupportAudience)}
            >
              <option value="attendee" disabled={!hasContext}>
                {t("attendee")}
              </option>
              <option value="organizer_platform">
                {t("organizer_platform")}
              </option>
            </SelectField>
            {audience === "attendee" && !hasContext ? (
              <AuthNotice>{t("contextRequired")}</AuthNotice>
            ) : null}
            <SelectField
              key={audience}
              label={t("category")}
              name="category"
              defaultValue={
                categories.includes(context.category!)
                  ? context.category
                  : categories[0]
              }
            >
              {categories.map((value) => (
                <option value={value} key={value}>
                  {t(value)}
                </option>
              ))}
            </SelectField>
            <Field
              label={t("subject")}
              name="subject"
              required
              maxLength={160}
            />
            <TextArea
              label={t("message")}
              name="body"
              required
              maxLength={8000}
              rows={8}
            />
            <p className="field-hint">{t("privacy")}</p>
            <Button
              type="submit"
              disabled={audience === "attendee" && !hasContext}
            >
              {command.pending ? eventText("loading") : t("submit")}
            </Button>
          </fieldset>
        </form>
      </section>
    </div>
  )
}
