import {
  addSupportMessageSchema,
  assignSupportCaseSchema,
  supportAssigneeListSchema,
  supportCaseResponseSchema,
  supportChangeListSchema,
  supportMutationResponseSchema,
  supportStatusSchema,
  type SupportCase,
  type SupportCaseChange,
} from "@elc/shared"
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { useAccount } from "@/auth/context"
import { Button } from "@/components/ui/button"
import { EventApiError, segment, useCommand, useResource } from "@/events/api"
import { useEventText } from "@/events/messages"
import { EventError, Loading, SelectField, TextArea } from "@/events/ui"
import { RefundPanel } from "./refund-panel"
import { useSupportText } from "./messages"
import { useSupportLive } from "./live"
import { useSupportCase } from "./case-resource"

function Change({ change }: { change: SupportCaseChange }) {
  const { locale, t } = useSupportText()
  return (
    <li>
      <header>
        <strong>
          {change.message?.authorName ??
            t(
              change.kind === "assignment"
                ? "assignmentChange"
                : change.kind === "status"
                  ? "statusChange"
                  : "created"
            )}
        </strong>
        <time dateTime={change.createdAt}>
          {new Intl.DateTimeFormat(locale, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(change.createdAt))}
        </time>
      </header>
      {change.message ? (
        <p>{change.message.body}</p>
      ) : change.kind === "status" ? (
        <p>{t(change.after.status)}</p>
      ) : null}
    </li>
  )
}
function Assignment({
  value,
  reload,
}: {
  value: SupportCase
  reload: (saved?: boolean) => void
}) {
  const { t } = useSupportText(),
    { t: eventText } = useEventText(),
    { account } = useAccount(),
    command = useCommand()
  const [cursor, setCursor] = useState(""),
    [selected, setSelected] = useState(value.assigneeId ?? "")
  const candidates = useResource(
    `/support/cases/${segment(value.id)}/assignees?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    supportAssigneeListSchema,
    15000
  )
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = assignSupportCaseSchema.safeParse({
      requestId: "validate",
      expectedRevision: value.revision,
      assigneeId: selected || null,
    })
    if (!parsed.success) {
      command.setError(new EventApiError("INVALID_INPUT", 400))
      return
    }
    const result = await command.send(
      `/support/cases/${segment(value.id)}/assignment`,
      supportMutationResponseSchema,
      parsed.data,
      "PATCH"
    )
    if (result) reload(true)
  }
  return (
    <section className="event-panel">
      <h2>{t("assignment")}</h2>
      <p>
        {value.assigneeId === account?.user.id
          ? t("me")
          : value.assigneeId
            ? t("otherAssignee")
            : t("unassigned")}
      </p>
      {command.error ? (
        <EventError error={command.error} retry={reload} />
      ) : null}
      {candidates.error ? (
        <EventError error={candidates.error} retry={candidates.reload} />
      ) : !candidates.data ? (
        <Loading />
      ) : (
        <>
          <form onSubmit={submit} className="support-form">
            <SelectField
              label={t("assignment")}
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              disabled={command.pending}
            >
              <option value="">{t("unassigned")}</option>
              {selected &&
              !candidates.data.items.some(
                (item) => item.userId === selected
              ) ? (
                <option value={selected}>{t("otherAssignee")}</option>
              ) : null}
              {candidates.data.items.map((item) => (
                <option value={item.userId} key={item.userId}>
                  {item.name}
                  {item.userId === account?.user.id ? ` (${t("me")})` : ""}
                </option>
              ))}
            </SelectField>
            <Button type="submit" disabled={command.pending}>
              {command.pending ? eventText("loading") : t("assign")}
            </Button>
          </form>
          <div className="event-pagination">
            {cursor ? (
              <button
                type="button"
                className="text-action"
                onClick={() => setCursor("")}
              >
                {eventText("firstPage")}
              </button>
            ) : null}
            {candidates.data.nextCursor ? (
              <button
                type="button"
                className="text-action"
                onClick={() => setCursor(candidates.data!.nextCursor!)}
              >
                {eventText("more")}
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}
function Status({
  value,
  reload,
}: {
  value: SupportCase
  reload: (saved?: boolean) => void
}) {
  const { t } = useSupportText(),
    { t: eventText } = useEventText(),
    command = useCommand()
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const status = supportStatusSchema.safeParse(
      new FormData(event.currentTarget).get("status")
    )
    if (!status.success) return
    const result = await command.send(
      `/support/cases/${segment(value.id)}/status`,
      supportMutationResponseSchema,
      { expectedRevision: value.revision, status: status.data },
      "PATCH"
    )
    if (result) reload(true)
  }
  return (
    <section className="event-panel">
      <h2>{t("status")}</h2>
      {command.error ? (
        <EventError error={command.error} retry={reload} />
      ) : null}
      <form onSubmit={submit} className="support-form">
        <SelectField
          key={value.status}
          label={t("status")}
          name="status"
          defaultValue={value.status}
          disabled={command.pending}
        >
          {supportStatusSchema.options.map((status) => (
            <option key={status} value={status}>
              {t(status)}
            </option>
          ))}
        </SelectField>
        <Button type="submit" disabled={command.pending}>
          {command.pending ? eventText("loading") : t("statusSave")}
        </Button>
      </form>
    </section>
  )
}
function Reply({
  value,
  reload,
}: {
  value: SupportCase
  reload: (saved?: boolean) => void
}) {
  const { t } = useSupportText(),
    { t: eventText } = useEventText(),
    command = useCommand()
  const [body, setBody] = useState("")
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = addSupportMessageSchema.safeParse({
      requestId: "validate",
      expectedRevision: value.revision,
      body,
    })
    if (!parsed.success) {
      command.setError(new EventApiError("INVALID_INPUT", 400))
      return
    }
    const result = await command.send(
      `/support/cases/${segment(value.id)}/messages`,
      supportMutationResponseSchema,
      parsed.data
    )
    if (result) {
      setBody("")
      reload(true)
    }
  }
  return (
    <form className="support-form" onSubmit={submit}>
      {command.error ? (
        <EventError error={command.error} retry={reload} />
      ) : null}
      <TextArea
        label={t("message")}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        required
        maxLength={8000}
        rows={5}
        disabled={command.pending}
      />
      <p className="field-hint">{t("privacy")}</p>
      <Button type="submit" disabled={command.pending}>
        {command.pending ? eventText("loading") : t("send")}
      </Button>
    </form>
  )
}
function CaseContents({
  data,
  reload,
}: {
  data: ReturnType<typeof supportCaseResponseSchema.parse>
  reload: (saved?: boolean) => void
}) {
  const { t } = useSupportText(),
    { t: eventText } = useEventText()
  const [after, setAfter] = useState(Math.max(0, data.case.lastSequence - 20))
  const history = useResource(
    `/support/cases/${segment(data.case.id)}/changes?after=${after}&limit=20`,
    supportChangeListSchema,
    10000
  )
  const [notice, setNotice] = useState(0),
    noticeRef = useRef<HTMLParagraphElement>(null)
  const reloadHistory = history.reload
  const reloadAll = useCallback(() => {
    reload()
    reloadHistory()
  }, [reload, reloadHistory])
  const saved = (success = false) => {
    if (success) setNotice((value) => value + 1)
    reloadAll()
  }
  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])
  useSupportLive(data.case.id, data.case.lastSequence, reloadAll)
  if (history.error)
    return <EventError error={history.error} retry={reloadAll} />
  return (
    <>
      <div className="event-page-heading">
        <div>
          <p className="eyebrow">
            {t(data.case.audience)} · {t(data.case.category)}
          </p>
          <h1>{data.case.subject}</h1>
          <p>{t(data.case.status)}</p>
        </div>
        <button type="button" className="text-action" onClick={reloadAll}>
          {eventText("reload")}
        </button>
      </div>
      <p className="support-reference">
        {t("reference")}: {data.case.id}
      </p>
      {notice ? (
        <p
          className="support-notice"
          role="status"
          tabIndex={-1}
          ref={noticeRef}
        >
          {t("sent")}
        </p>
      ) : null}
      {data.case.payoutHeld ? (
        <p className="support-notice">{t("payoutHeld")}</p>
      ) : null}
      <div className="support-context">
        {data.case.eventId ? (
          <a
            className="text-action"
            href={`/events/${segment(data.case.eventId)}`}
          >
            {eventText("details")}
          </a>
        ) : null}
        {data.case.orderId ? (
          <a
            className="text-action"
            href={`/orders/${segment(data.case.orderId)}/refund`}
          >
            {t("refundTitle")}
          </a>
        ) : null}
      </div>
      <div className="support-grid">
        <section className="event-panel">
          <h2>{t("conversation")}</h2>
          {!history.data ? (
            <Loading />
          ) : (
            <ol className="support-timeline">
              {history.data.items.map((change) => (
                <Change change={change} key={change.id} />
              ))}
            </ol>
          )}
          <div className="event-pagination">
            {after > 0 ? (
              <button
                type="button"
                className="text-action"
                onClick={() => setAfter(0)}
              >
                {eventText("firstPage")}
              </button>
            ) : null}
            {history.data?.nextCursor ? (
              <button
                type="button"
                className="text-action"
                onClick={() => setAfter(history.data!.nextCursor!)}
              >
                {eventText("more")}
              </button>
            ) : null}
            <button
              type="button"
              className="text-action"
              onClick={() => {
                setAfter(Math.max(0, data.case.lastSequence - 20))
                history.reload()
              }}
            >
              {t("latest")}
            </button>
          </div>
          {data.permissions.canMessage ? (
            <Reply value={data.case} reload={saved} />
          ) : (
            <p>{t("resolvedHint")}</p>
          )}
        </section>
        <div>
          {data.permissions.canManage ? (
            <>
              <Assignment value={data.case} reload={saved} />
              <Status value={data.case} reload={saved} />
            </>
          ) : null}
          {data.case.orderId && data.case.category === "refund" ? (
            <RefundPanel
              orderId={data.case.orderId}
              supportCase={data.case}
              onChanged={reloadAll}
            />
          ) : null}
        </div>
      </div>
    </>
  )
}
export function SupportCasePage({ caseId }: { caseId: string }) {
  const { t } = useSupportText()
  const detail = useSupportCase(caseId)
  return (
    <div className="events-page support-page">
      <a className="back-link" href="/support">
        {t("title")}
      </a>
      {detail.error ? (
        <EventError error={detail.error} retry={detail.reload} />
      ) : !detail.data ? (
        <Loading />
      ) : (
        <CaseContents data={detail.data} reload={detail.reload} />
      )}
    </div>
  )
}
