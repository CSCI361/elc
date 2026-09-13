import { supportCaseResponseSchema } from "@elc/shared"
import { useCallback, useEffect, useRef, useState } from "react"
import { api, segment } from "@/events/api"
import { supportAccessLost } from "./attachment-api"

type CaseData = ReturnType<typeof supportCaseResponseSchema.parse>
/** Background refresh keeps an in-progress reply mounted; failed access discards the case. */
export function useSupportCase(caseId: string, accountId: string) {
  const scope = `${accountId}:${caseId}`
  const [result, setResult] = useState<{
    scope: string
    data: CaseData | null
    error?: unknown
  } | null>(null)
  const mounted = useRef(false),
    active = useRef<AbortController | null>(null)
  const reload = useCallback(() => {
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    void api(`/support/cases/${segment(caseId)}`, supportCaseResponseSchema, {
      signal: controller.signal,
    })
      .then((result) => {
        if (mounted.current && !controller.signal.aborted) {
          setResult({ scope, data: result })
        }
      })
      .catch((failure) => {
        if (mounted.current && !controller.signal.aborted) {
          setResult((previous) => ({
            scope,
            data:
              !supportAccessLost(failure) && previous?.scope === scope
                ? previous.data
                : null,
            error: failure,
          }))
        }
      })
  }, [caseId, scope])
  const deny = useCallback(
    (error: unknown) => {
      active.current?.abort()
      setResult({ scope, data: null, error })
    },
    [scope]
  )
  useEffect(() => {
    mounted.current = true
    reload()
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") reload()
    }, 10000)
    window.addEventListener("focus", reload)
    return () => {
      mounted.current = false
      active.current?.abort()
      window.clearInterval(timer)
      window.removeEventListener("focus", reload)
    }
  }, [reload])
  const current = result?.scope === scope ? result : null
  return { data: current?.data, error: current?.error, reload, deny }
}
