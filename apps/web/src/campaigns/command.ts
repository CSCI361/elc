import { eventMutationResponseSchema } from "@elc/shared"
import { useEffect, useRef, useState } from "react"
import { api, EventApiError } from "../events/api"

/** Keep the reviewed payload and request ID together across uncertain responses. */
export function useCampaignCommand(onDenied: (error: unknown) => void) {
  const last = useRef<{ signature: string; requestId: string } | null>(null)
  const controller = useRef<AbortController | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => () => controller.current?.abort(), [])
  async function send(path: string, body: Record<string, unknown>) {
    if (controller.current && !controller.current.signal.aborted) return
    const request = new AbortController()
    controller.current = request
    const signature = JSON.stringify({ path, body })
    if (last.current?.signature !== signature)
      last.current = { signature, requestId: crypto.randomUUID() }
    setPending(true)
    setError(null)
    try {
      const result = await api(path, eventMutationResponseSchema, {
        method: "POST",
        signal: request.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, requestId: last.current.requestId }),
      })
      if (!request.signal.aborted) return result
    } catch (failure) {
      if (!request.signal.aborted) {
        setError(failure)
        if (
          failure instanceof EventApiError &&
          [401, 403, 404].includes(failure.status)
        )
          onDenied(failure)
      }
    } finally {
      if (!request.signal.aborted) setPending(false)
      request.abort()
    }
  }
  return { pending, error, send, setError }
}
