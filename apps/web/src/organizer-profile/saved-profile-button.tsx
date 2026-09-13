import { organizerProfileResponseSchema } from "@elc/shared"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { api, EventApiError } from "@/events/api"
import { EventError } from "@/events/ui"
import type { OrganizerProfile } from "./policies"
import { useOrganizerProfileText } from "./messages"
import "./profile.css"

export function SavedOrganizerProfileButton({
  onUse,
  disabled = false,
  onPendingChange,
}: {
  onUse: (profile: OrganizerProfile) => void
  disabled?: boolean
  onPendingChange?: (pending: boolean) => void
}) {
  const { t } = useOrganizerProfileText()
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<"missing" | "used" | "denied" | null>(
    null
  )
  const [error, setError] = useState<unknown>(null)
  const request = useRef<AbortController | null>(null)
  const pendingCallback = useRef(onPendingChange)
  useEffect(() => {
    pendingCallback.current = onPendingChange
  }, [onPendingChange])
  useEffect(
    () => () => {
      if (request.current && !request.current.signal.aborted) {
        request.current.abort()
        pendingCallback.current?.(false)
      }
    },
    []
  )
  async function loadSaved() {
    if (disabled || (request.current && !request.current.signal.aborted)) return
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    pendingCallback.current?.(true)
    setNotice(null)
    setError(null)
    try {
      const result = await api(
        "/me/organizer-profile",
        organizerProfileResponseSchema,
        { signal: controller.signal }
      )
      if (controller.signal.aborted) return
      if (result.profile) {
        onUse(result.profile)
        setNotice("used")
      } else setNotice("missing")
    } catch (failure) {
      if (!controller.signal.aborted) {
        if (
          failure instanceof EventApiError &&
          [401, 403, 404].includes(failure.status)
        )
          setNotice("denied")
        else setError(failure)
      }
    } finally {
      if (!controller.signal.aborted) {
        setPending(false)
        pendingCallback.current?.(false)
      }
      controller.abort()
    }
  }
  return (
    <div className="saved-organizer-profile">
      <Button
        type="button"
        variant="outline"
        disabled={pending || disabled}
        onClick={() => void loadSaved()}
      >
        {t(pending ? "loading" : "useSaved")}
      </Button>
      {notice ? <p role="status">{t(notice)}</p> : null}
      {error ? <EventError error={error} /> : null}
    </div>
  )
}
