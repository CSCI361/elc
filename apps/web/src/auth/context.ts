import { createContext, useContext } from "react"
import type { AuthMessages, Locale } from "@elc/shared"

export type Account = {
  user: { id: string; name: string; email: string; emailVerified: boolean }
  profile: { locale: Locale; hasSavedLocale: boolean }
}
export type AccountStatus =
  | "loading"
  | "signed-out"
  | "verification-required"
  | "active"
  | "denied"
  | "unavailable"
export type AuthCapabilities = {
  emailAndPassword: boolean
  emailDelivery: boolean
  google: boolean
}

export type AuthContextValue = {
  account: Account | null
  status: AccountStatus
  capabilities: AuthCapabilities | null
  capabilitiesFailed: boolean
  locale: Locale
  messages: AuthMessages
  changeLocale: (locale: Locale) => Promise<boolean>
  preferencePending: boolean
  preferenceError: boolean
  refresh: () => void
  signOut: () => Promise<boolean>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAccount() {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAccount requires AuthProvider")
  return context
}
