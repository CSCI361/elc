import { useEffect, useRef, useState } from "react"
import type { OperationsKind } from "@elc/shared"
import { EventApiError } from "../events/api"
import { EventError } from "../events/ui"
import { useOperationsText } from "./operations-messages"

export function OperationsExport({
  query,
  kind,
  onDenied,
}: {
  query: string
  kind: OperationsKind
  onDenied: () => void
}) {
  const { t } = useOperationsText(),
    controller = useRef<AbortController | null>(null),
    urls = useRef(new Map<string, number>()),
    [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>(null),
    [started, setStarted] = useState(false)
  useEffect(() => {
    const activeUrls = urls.current
    return () => {
      controller.current?.abort()
      for (const [url, timer] of activeUrls) {
        window.clearTimeout(timer)
        URL.revokeObjectURL(url)
      }
      activeUrls.clear()
    }
  }, [])
  async function download() {
    if (controller.current) return
    const active = new AbortController()
    controller.current = active
    setPending(true)
    setStarted(false)
    setError(null)
    try {
      const response = await fetch(`/api/admin/operations/export?${query}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: active.signal,
      })
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) onDenied()
        throw new EventApiError(
          response.status === 403
            ? "FORBIDDEN"
            : response.status === 401
              ? "UNAUTHENTICATED"
              : "INTERNAL_ERROR",
          response.status
        )
      }
      if (!response.headers.get("content-type")?.startsWith("text/csv"))
        throw new EventApiError("INVALID_RESPONSE", 502)
      const blob = await response.blob()
      if (active.signal.aborted) return
      if (blob.size > 1048576) throw new EventApiError("INVALID_RESPONSE", 502)
      const url = URL.createObjectURL(blob)
      urls.current.set(
        url,
        window.setTimeout(() => {
          URL.revokeObjectURL(url)
          urls.current.delete(url)
        }, 60000)
      )
      const link = document.createElement("a")
      link.href = url
      link.download = `elc-${kind}-page.csv`
      link.hidden = true
      document.body.append(link)
      link.click()
      link.remove()
      setStarted(true)
    } catch (failure) {
      if (!active.signal.aborted) setError(failure)
    } finally {
      if (!active.signal.aborted) {
        controller.current = null
        setPending(false)
      }
    }
  }
  return (
    <div>
      <button
        type="button"
        className="secondary-link"
        disabled={pending}
        onClick={() => void download()}
      >
        {t("export")}
      </button>
      <p className="field-hint">{t("exportHint")}</p>
      {started ? <p role="status">{t("downloaded")}</p> : null}
      {error ? <EventError error={error} /> : null}
    </div>
  )
}
