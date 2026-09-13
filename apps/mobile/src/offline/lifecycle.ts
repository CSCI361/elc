import { useEffect } from "react"
import { AppState } from "react-native"
import { offlineClockWatch, offlineController, offlineVault } from "./runtime"
import { offlinePolicy } from "./model"

/** Deletion and rollback checks continue outside the scanner tab and catch up after foregrounding. */
export function useOfflineLifecycle() {
  useEffect(() => {
    let running = false
    let disposed = false
    const tick = async () => {
      if (running || disposed) return
      running = true
      try {
        const unsafe = offlineClockWatch.sample(Date.now(), performance.now())
        const accountId = await offlineVault.restore()
        if (unsafe && accountId) await offlineController.unsafeClock(accountId)
      } catch {
        /* Storage failures never enable offline admission. The workspace displays them. */
      } finally {
        try {
          await offlineVault.cleanup()
        } catch {
          /* Each account remains encrypted if its platform key is unavailable. */
        }
        running = false
      }
    }
    void tick()
    const interval = setInterval(() => {
      void tick()
    }, offlinePolicy.cleanupInterval)
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void tick()
    })
    return () => {
      disposed = true
      clearInterval(interval)
      subscription.remove()
    }
  }, [])
}
