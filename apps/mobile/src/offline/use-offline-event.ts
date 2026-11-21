import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react"
import type { ScannerEvent } from "@elc/shared"
import { offlineController } from "./runtime"
import {
  OfflineFailure,
  offlinePolicy,
  visibleStatus,
  type OfflineStatus,
} from "./model"

export type OfflineMessage =
  | "listSaved"
  | "sent"
  | "offlineFailed"
  | "offlineUnavailable"

export function useOfflineEvent({
  accountId,
  event,
  online,
  deviceLabel,
  onEvent,
}: {
  accountId: string | null
  event: ScannerEvent
  online: boolean
  deviceLabel: string
  onEvent: (event: ScannerEvent) => void
}) {
  const [stored, setStatus] = useState<OfflineStatus | null>(null)
  const [busy, setBusy] = useState<"save" | "send" | null>(null)
  const [message, setMessage] = useState<OfflineMessage | null>(null)
  const working = useRef(false)
  const eventId = event.id
  const status = visibleStatus(stored, accountId, eventId)
  const refreshStatus = useCallback(async () => {
    if (!accountId) return
    // A failed read keeps the last good status, so waiting check-ins stay visible.
    const next = await offlineController
      .status(accountId, eventId)
      .catch(() => null)
    if (next) setStatus(next)
  }, [accountId, eventId])
  useEffect(() => {
    if (!accountId) return
    let active = true
    const load = () =>
      offlineController
        .status(accountId, eventId)
        .then((next) => {
          if (active) setStatus(next)
        })
        .catch(() => undefined)
    void load()
    const timer = setInterval(() => {
      void load()
    }, offlinePolicy.cleanupInterval)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [accountId, eventId])
  const run = useCallback(
    async (download: boolean, manual: boolean) => {
      if (!accountId || !online || working.current) return
      working.current = true
      if (manual) {
        setBusy(download ? "save" : "send")
        setMessage(null)
      }
      try {
        await offlineController.sync(accountId)
        const next = download
          ? await offlineController.refresh(accountId, eventId, deviceLabel)
          : await offlineController.status(accountId, eventId)
        setStatus(next)
        if (next.event?.id === eventId) onEvent(next.event)
        if (manual) setMessage(download ? "listSaved" : "sent")
      } catch (error) {
        if (manual)
          setMessage(
            error instanceof OfflineFailure &&
              error.code === "encryption_unavailable"
              ? "offlineUnavailable"
              : "offlineFailed"
          )
        await refreshStatus()
      } finally {
        working.current = false
        if (manual) setBusy(null)
      }
    },
    [accountId, online, eventId, deviceLabel, onEvent, refreshStatus]
  )
  const saved = Boolean(status?.snapshot)
  const keepFresh = useEffectEvent(() => {
    void run(true, false)
  })
  useEffect(() => {
    if (!saved || !online) return
    const first = setTimeout(() => keepFresh(), 0)
    const timer = setInterval(() => keepFresh(), offlinePolicy.refreshInterval)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [saved, online])
  return {
    status,
    busy,
    message,
    save: () => run(true, true),
    send: () => run(false, true),
    refreshStatus,
  }
}
