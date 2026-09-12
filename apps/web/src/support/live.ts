import {
  SUPPORT_LIVE_PROTOCOL,
  supportLiveFrameSchema,
  type SupportLiveFrame,
} from "@elc/shared"
import { useEffect, useRef } from "react"

/** Live frames are invalidation hints; every displayed value comes from authorized REST. */
export function createSupportSignalLedger(caseId: string, initialSequence = 0) {
  const seen = new Set<string>()
  let sequence = initialSequence
  return (frame: SupportLiveFrame) => {
    if (frame.type !== "pong" && frame.caseId !== caseId) return false
    if (frame.type === "case_update") {
      if (seen.has(frame.updateId)) return false
      seen.add(frame.updateId)
      if (seen.size > 256) seen.delete(seen.values().next().value!)
    }
    const next =
      frame.type === "case_update" ? frame.sequence : frame.throughSequence
    if (next <= sequence) return false
    sequence = next
    return true
  }
}
export function useSupportLive(
  caseId: string,
  throughSequence: number,
  reload: () => void
) {
  const confirmed = useRef(throughSequence)
  useEffect(() => {
    confirmed.current = throughSequence
  }, [throughSequence])
  useEffect(() => {
    let socket: WebSocket | null = null,
      stopped = false,
      retry = 0,
      reconnectTimer: number | undefined,
      pingTimer: number | undefined
    const receive = createSupportSignalLedger(caseId, confirmed.current)
    const clearPing = () => window.clearInterval(pingTimer)
    const connect = () => {
      if (stopped || document.visibilityState !== "visible") return
      const url = new URL(
        `/api/support/cases/${encodeURIComponent(caseId)}/live`,
        window.location.origin
      )
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      url.searchParams.set("after", String(confirmed.current))
      const connection = new WebSocket(url, SUPPORT_LIVE_PROTOCOL)
      socket = connection
      connection.onmessage = (event) => {
        if (socket !== connection || stopped) return
        if (typeof event.data !== "string" || event.data.length > 2048) return
        let value: unknown
        try {
          value = JSON.parse(event.data)
        } catch {
          return
        }
        const parsed = supportLiveFrameSchema.safeParse(value)
        if (!parsed.success) return
        if (parsed.data.type === "ready") {
          retry = 0
          clearPing()
          pingTimer = window.setInterval(() => {
            if (socket?.readyState === WebSocket.OPEN)
              socket.send(JSON.stringify({ type: "ping" }))
          }, 30000)
        }
        if (receive(parsed.data)) reload()
      }
      connection.onclose = () => {
        if (socket !== connection) return
        clearPing()
        socket = null
        if (stopped || document.visibilityState !== "visible") return
        reload()
        reconnectTimer = window.setTimeout(
          connect,
          Math.min(30000, 1000 * 2 ** Math.min(retry++, 5))
        )
      }
      connection.onerror = () => connection.close()
    }
    const visibility = () => {
      window.clearTimeout(reconnectTimer)
      if (document.visibilityState === "visible") {
        reload()
        connect()
      } else {
        clearPing()
        socket?.close()
        socket = null
      }
    }
    connect()
    document.addEventListener("visibilitychange", visibility)
    return () => {
      stopped = true
      window.clearTimeout(reconnectTimer)
      clearPing()
      document.removeEventListener("visibilitychange", visibility)
      socket?.close()
    }
  }, [caseId, reload])
}
