import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  accountResponseSchema,
  authCapabilitiesSchema,
  authMessages,
  type Locale,
} from "@elc/shared"
import { authClient } from "./client"
import {
  AuthContext,
  type Account,
  type AccountStatus,
  type AuthCapabilities,
} from "./context"
import { persistLocale, readBrowserLocale } from "./locale"

export function AuthProvider({ children }: { children: ReactNode }) {
  const session = authClient.useSession()
  const userId = session.data?.user.id
  const [locale, setLocale] = useState(readBrowserLocale)
  const localeRevision = useRef(0)
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(
    null
  )
  const [capabilitiesFailed, setCapabilitiesFailed] = useState(false)
  const [snapshot, setSnapshot] = useState<{
    userId: string
    account: Account | null
    status: AccountStatus
  } | null>(null)
  const [reload, setReload] = useState(0)
  const [preferencePending, setPreferencePending] = useState(false)
  const [preferenceError, setPreferenceError] = useState(false)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  useEffect(() => {
    const refreshAccount = () => setReload((value) => value + 1)
    const restorePage = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload()
    }
    window.addEventListener("focus", refreshAccount)
    window.addEventListener("pageshow", restorePage)
    return () => {
      window.removeEventListener("focus", refreshAccount)
      window.removeEventListener("pageshow", restorePage)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/auth-capabilities", {
      signal: controller.signal,
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Capabilities unavailable")
        const result = authCapabilitiesSchema.parse(await response.json())
        if (!controller.signal.aborted) {
          setCapabilities(result)
          setCapabilitiesFailed(false)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setCapabilitiesFailed(true)
      })
    return () => controller.abort()
  }, [reload])

  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    const revision = localeRevision.current
    fetch("/api/me", {
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        if (controller.signal.aborted) return
        if (!response.ok) {
          setSnapshot({
            userId,
            account: null,
            status:
              response.status === 403
                ? "denied"
                : response.status === 401
                  ? "signed-out"
                  : "unavailable",
          })
          return
        }
        const account = accountResponseSchema.parse(await response.json())
        if (controller.signal.aborted || account.user.id !== userId) return
        setSnapshot({ userId, account, status: "active" })
        if (
          revision === localeRevision.current &&
          account.profile.hasSavedLocale
        ) {
          setLocale(account.profile.locale)
          persistLocale(account.profile.locale)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setSnapshot({ userId, account: null, status: "unavailable" })
      })
    return () => controller.abort()
  }, [userId, reload])

  const current = snapshot?.userId === userId ? snapshot : null
  const status: AccountStatus = session.isPending
    ? "loading"
    : session.error
      ? "unavailable"
      : !session.data
        ? "signed-out"
        : !session.data.user.emailVerified
          ? "verification-required"
          : (current?.status ?? "loading")
  const account = status === "active" ? (current?.account ?? null) : null

  const changeLocale = useCallback(
    async (next: Locale) => {
      localeRevision.current += 1
      setLocale(next)
      persistLocale(next)
      setPreferenceError(false)
      if (!userId || status !== "active") return true
      setPreferencePending(true)
      try {
        const response = await fetch("/api/me/preferences", {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale: next }),
        })
        if (!response.ok) throw new Error("Preference save failed")
        setSnapshot((previous) =>
          previous?.userId === userId && previous.account
            ? {
                ...previous,
                account: {
                  ...previous.account,
                  profile: { locale: next, hasSavedLocale: true },
                },
              }
            : previous
        )
        return true
      } catch {
        setPreferenceError(true)
        return false
      } finally {
        setPreferencePending(false)
      }
    },
    [userId, status]
  )

  const refresh = useCallback(() => {
    void session.refetch()
    setReload((value) => value + 1)
  }, [session])
  const signOut = useCallback(async () => {
    try {
      const result = await authClient.signOut()
      if (result.error) return false
      setSnapshot(null)
      // A fresh document discards all private account and feature state.
      window.location.assign("/auth/sign-in")
      return true
    } catch {
      return false
    }
  }, [])

  return (
    <AuthContext.Provider
      value={{
        account,
        status,
        capabilities,
        capabilitiesFailed,
        locale,
        messages: authMessages[locale],
        changeLocale,
        preferencePending,
        preferenceError,
        refresh,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
