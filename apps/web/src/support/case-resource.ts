import { supportCaseResponseSchema } from "@elc/shared"
import { useCallback, useEffect, useRef, useState } from "react"
import { api, segment } from "@/events/api"

type CaseData = ReturnType<typeof supportCaseResponseSchema.parse>
/** Background refresh keeps an in-progress reply mounted; failed access discards the case. */
export function useSupportCase(caseId: string) {
  const [data, setData] = useState<CaseData | null>(null),
    [error, setError] = useState<unknown>(null)
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
          setData(result)
          setError(null)
        }
      })
      .catch((failure) => {
        if (mounted.current && !controller.signal.aborted) {
          setData(null)
          setError(failure)
        }
      })
  }, [caseId])
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
  return { data, error, reload }
}
