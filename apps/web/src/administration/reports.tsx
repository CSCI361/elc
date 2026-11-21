import { useState, type FormEvent } from "react"
import {
  eventReportQueueResponseSchema,
  eventReportResolutionSchema,
  type EventReportQueueQuery,
  type EventReportQueueResponse,
} from "@elc/shared"
import { EventApiError, useCommand, useResource } from "../events/api"
import { dateText } from "../events/policies"
import { EventError, Field, SectionLoading, SelectField } from "../events/ui"
import { useReportText } from "../reports/messages"
import {
  reportQueuePath,
  resolutionDraft,
  type ResolutionKind,
  type ResolutionProblem,
} from "../reports/policies"

type QueueState = EventReportQueueQuery["state"]
type ReportItem = EventReportQueueResponse["items"][number]

const queueStates: readonly QueueState[] = [
  "open",
  "dismissed",
  "actioned",
  "all",
]

function useReportDate() {
  const { locale } = useReportText()
  return (value: string) => dateText(value, "Asia/Almaty", locale)
}

interface ReportCardProps {
  item: ReportItem
  onResolved: () => void
}

function ReportCard({ item, onResolved }: ReportCardProps) {
  const { t } = useReportText()
  const date = useReportDate()
  const command = useCommand()
  const [resolution, setResolution] = useState<ResolutionKind>("dismissed")
  const [reason, setReason] = useState("")
  const [problem, setProblem] = useState<ResolutionProblem | null>(null)
  const [resolved, setResolved] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const draft = resolutionDraft(item, resolution, reason)
    if (!draft.ok) {
      setProblem(draft.error)
      return
    }
    setProblem(null)
    const result = await command.send(
      `/admin/event-reports/${encodeURIComponent(item.id)}/resolution`,
      eventReportResolutionSchema,
      draft.body
    )
    if (!result) return
    if (result.reportId !== item.id) {
      command.setError(new EventApiError("INVALID_RESPONSE", 502))
      return
    }
    setResolved(true)
    onResolved()
  }

  return (
    <li className="event-panel" data-report-id={item.id}>
      <h3>{item.eventTitle}</h3>
      <p>
        {t(item.category)} · {t(item.state)}
      </p>
      <p className="preserve-lines">{item.details}</p>
      <dl className="fact-grid">
        <div>
          <dt>{t("event")}</dt>
          <dd>{item.eventId}</dd>
        </div>
        <div>
          <dt>{t("eventStatus")}</dt>
          <dd>{t(item.eventSuspended ? "eventSuspended" : "eventActive")}</dd>
        </div>
        <div>
          <dt>{t("openForEvent")}</dt>
          <dd>{item.openReportsForEvent}</dd>
        </div>
        <div>
          <dt>{t("reporter")}</dt>
          <dd>{item.reporterId}</dd>
        </div>
        <div>
          <dt>{t("submittedAt")}</dt>
          <dd>{date(item.createdAt)}</dd>
        </div>
        {item.resolutionReason ? (
          <div>
            <dt>{t("reason")}</dt>
            <dd>{item.resolutionReason}</dd>
          </div>
        ) : null}
      </dl>
      {item.state === "open" ? (
        <form onSubmit={submit}>
          <SelectField
            label={t("resolution")}
            value={resolution}
            disabled={command.pending || resolved}
            onValueChange={(value) =>
              setResolution(value === "actioned" ? "actioned" : "dismissed")
            }
          >
            <option value="dismissed">{t("dismissed")}</option>
            <option value="actioned">{t("actioned")}</option>
          </SelectField>
          <Field
            label={t("reason")}
            required
            maxLength={500}
            value={reason}
            disabled={command.pending || resolved}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="field-hint">{t("auditHint")}</p>
          {problem ? <p role="alert">{t(problem)}</p> : null}
          {problem === "suspendFirst" ? (
            <a className="secondary-link" href="/admin/events">
              {t("manageEvent")}
            </a>
          ) : null}
          {command.error ? <EventError error={command.error} /> : null}
          <button
            type="submit"
            className="primary-link"
            disabled={command.pending || resolved}
          >
            {t("resolve")}
          </button>
        </form>
      ) : null}
    </li>
  )
}

export function PlatformEventReports() {
  const { t } = useReportText()
  const [state, setState] = useState<QueueState>("open")
  const [cursors, setCursors] = useState<readonly string[]>([])
  const queue = useResource(
    reportQueuePath({ state, cursor: cursors.at(-1) }),
    eventReportQueueResponseSchema,
    15000
  )
  const nextCursor = queue.data?.nextCursor ?? null

  return (
    <section className="administration-reports" aria-label={t("queueTitle")}>
      <h2>{t("queueTitle")}</h2>
      <p>{t("queueIntro")}</p>
      <SelectField
        label={t("stateFilter")}
        value={state}
        onValueChange={(selected) => {
          const next = queueStates.find((value) => value === selected)
          if (!next) return
          setState(next)
          setCursors([])
        }}
      >
        {queueStates.map((value) => (
          <option key={value} value={value}>
            {t(value)}
          </option>
        ))}
      </SelectField>
      {queue.error ? (
        <EventError error={queue.error} retry={queue.reload} />
      ) : !queue.data ? (
        <SectionLoading />
      ) : queue.data.items.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <ul className="administration-records">
          {queue.data.items.map((item) => (
            <ReportCard
              key={`${item.id}:${item.revision}`}
              item={item}
              onResolved={queue.reload}
            />
          ))}
        </ul>
      )}
      {cursors.length > 0 || nextCursor ? (
        <nav className="analytics-actions" aria-label={t("pagination")}>
          <button
            type="button"
            className="text-action"
            disabled={cursors.length === 0}
            onClick={() => setCursors([])}
          >
            {t("first")}
          </button>
          <button
            type="button"
            className="text-action"
            disabled={!nextCursor}
            onClick={() => {
              if (nextCursor) setCursors([...cursors, nextCursor])
            }}
          >
            {t("next")}
          </button>
        </nav>
      ) : null}
    </section>
  )
}
