import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react"
import type { SupportCase, SupportMessageAttachment } from "@elc/shared"
import { useAccount } from "@/auth/context"
import { Button } from "@/components/ui/button"
import { EventApiError, segment, useServerNow } from "@/events/api"
import { EventError, TextArea } from "@/events/ui"
import { useEventText } from "@/events/messages"
import { useSupportText } from "./messages"
import { AttachmentComposer } from "./attachment-composer"
import {
  attachmentErrorKey,
  attachmentSize,
  attachmentText,
} from "./attachment-messages"
import { supportAccessLost, supportResponseError } from "./attachment-api"

export function AttachmentReply({
  value,
  reload,
  onAccessLost,
  disabled,
}: {
  value: SupportCase
  reload: (saved?: boolean) => void
  onAccessLost: (error: unknown) => void
  disabled: boolean
}) {
  const { locale, t } = useSupportText(),
    { t: eventText } = useEventText()
  const [composer] = useState(() => new AttachmentComposer(value.id))
  const state = useSyncExternalStore(composer.subscribe, composer.snapshot)
  const id = useId(),
    now = useServerNow()
  const picker = useRef<HTMLInputElement>(null)
  const text = (key: Parameters<typeof attachmentText>[1]) =>
    attachmentText(locale, key)
  useEffect(() => {
    const unsubscribe = composer.subscribe(() => {
      const current = composer.snapshot()
      const denied = [
        current.error,
        ...current.files.map((file) => file.error),
      ].find(supportAccessLost)
      if (denied) onAccessLost(denied)
    })
    return () => {
      unsubscribe()
      composer.cancel()
    }
  }, [composer, onAccessLost])
  const frozen = state.pending || state.uncertain || disabled
  const blocked = state.files.some(
    (file) =>
      file.phase !== "ready" ||
      (!state.uncertain && Date.parse(file.upload!.expiresAt) <= now)
  )
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (blocked || disabled) return
    const result = await composer.send(value.revision)
    if (result) reload(true)
    else if (composer.snapshot().error instanceof EventApiError) reload()
  }
  return (
    <form className="support-form" onSubmit={submit}>
      {state.error ? <EventError error={state.error} retry={reload} /> : null}
      {state.uncertain ? <p role="status">{text("uncertain")}</p> : null}
      <TextArea
        label={t("message")}
        value={state.body}
        onChange={(event) => composer.setBody(event.target.value)}
        required
        maxLength={8000}
        rows={5}
        disabled={frozen}
      />
      <fieldset disabled={frozen} className="support-attachments">
        <legend>{text("files")}</legend>
        <p id={`${id}-limits`} className="field-hint">
          {text("limits")}
        </p>
        <button
          type="button"
          className="text-action"
          onClick={() => picker.current?.click()}
          aria-describedby={`${id}-limits ${id}-privacy`}
        >
          {text("choose")}
        </button>
        <input
          id={id}
          ref={picker}
          hidden
          aria-label={text("choose")}
          type="file"
          multiple
          accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"
          aria-describedby={`${id}-limits ${id}-privacy`}
          onChange={(event) => {
            composer.add(Array.from(event.target.files ?? []))
            event.target.value = ""
          }}
        />
        <p id={`${id}-privacy`} className="field-hint">
          {text("private")}
        </p>
        {state.selectionError ? <p role="alert">{text("limit")}</p> : null}
        <ul className="support-file-list" aria-live="polite">
          {state.files.map((file) => (
            <li key={file.key}>
              <strong>{file.upload?.fileName ?? file.file.name}</strong>
              <small>{attachmentSize(locale, file.file.size)}</small>
              <p>
                {file.phase === "rejected"
                  ? text(attachmentErrorKey(undefined, file.upload?.errorCode))
                  : file.phase === "failed"
                    ? text(attachmentErrorKey(file.error))
                    : file.phase === "remove_failed"
                      ? text("removeFailed")
                      : file.phase === "ready" &&
                          Date.parse(file.upload!.expiresAt) <= now
                        ? text("expired")
                        : text(
                            file.phase === "ready"
                              ? "ready"
                              : file.phase === "removing"
                                ? "removing"
                                : "uploading"
                          )}
              </p>
              {file.phase === "rejected" ? <p>{text("rejected")}</p> : null}
              {file.error ? <EventError error={file.error} /> : null}
              <div className="support-file-actions">
                {file.phase === "failed" ? (
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => void composer.upload(file.key)}
                  >
                    {text("retry")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="text-action"
                  disabled={
                    file.phase === "uploading" || file.phase === "removing"
                  }
                  onClick={() => void composer.remove(file.key)}
                  aria-label={`${text("remove")}: ${file.file.name}`}
                >
                  {text("remove")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </fieldset>
      {blocked ? <p role="status">{text("pendingFiles")}</p> : null}
      <p className="field-hint">{t("privacy")}</p>
      <Button type="submit" disabled={state.pending || blocked || disabled}>
        {state.pending
          ? eventText("loading")
          : state.uncertain
            ? text("retryMessage")
            : t("send")}
      </Button>
    </form>
  )
}

export function AttachmentDownload({
  caseId,
  file,
  onAccessLost,
}: {
  caseId: string
  file: SupportMessageAttachment
  onAccessLost: (error: unknown) => void
}) {
  const { locale } = useAccount()
  const [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>(null)
  const active = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      active.current?.abort()
    },
    []
  )
  async function download() {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setPending(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/support/cases/${segment(caseId)}/attachments/${segment(file.id)}/download`,
        {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        }
      )
      if (!response.ok) throw await supportResponseError(response)
      const blob = await response.blob()
      if (controller.signal.aborted) return
      if (blob.type !== file.contentType || blob.size !== file.size)
        throw new EventApiError("INVALID_RESPONSE", 502)
      const url = URL.createObjectURL(blob),
        link = document.createElement("a")
      link.href = url
      link.download = file.fileName
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure)
        if (supportAccessLost(failure)) onAccessLost(failure)
      }
    } finally {
      active.current = null
      if (!controller.signal.aborted) setPending(false)
    }
  }
  return (
    <li>
      <button
        type="button"
        className="text-action"
        disabled={pending}
        onClick={() => void download()}
      >
        {attachmentText(locale, pending ? "downloading" : "download")}:{" "}
        {file.fileName}
      </button>
      <small>
        {attachmentSize(locale, file.size)} ·{" "}
        {file.contentType === "application/pdf"
          ? "PDF"
          : file.contentType === "image/png"
            ? "PNG"
            : "JPEG"}
      </small>
      {error ? <EventError error={error} /> : null}
    </li>
  )
}
