import { useEffect, useState } from "react"
import { offlineController, offlineVault } from "./runtime"
import { OfflineFailure } from "./model"

export type OfflineAccount = {
  accountId: string | null
  unavailable: boolean
  ready: boolean
}

export function useOfflineAccount(
  onlineAccountId: string | null,
  online: boolean
): OfflineAccount {
  const [state, setState] = useState<OfflineAccount>({
    accountId: null,
    unavailable: false,
    ready: false,
  })
  useEffect(() => {
    let active = true
    const open = async () => {
      try {
        const id =
          onlineAccountId && online
            ? await offlineVault.connect(onlineAccountId)
            : await offlineVault.restore()
        if (!active) return
        const usable = id && (!onlineAccountId || id === onlineAccountId)
        setState({
          accountId: usable ? id : null,
          unavailable: false,
          ready: true,
        })
        if (usable && online && onlineAccountId)
          // Failed uploads stay in the journal; each event card shows its pending count.
          await offlineController.sync(id).catch(() => undefined)
      } catch (error) {
        if (active)
          setState({
            accountId: null,
            unavailable:
              error instanceof OfflineFailure &&
              error.code === "encryption_unavailable",
            ready: true,
          })
      }
    }
    void open()
    return () => {
      active = false
    }
  }, [onlineAccountId, online])
  return state
}
