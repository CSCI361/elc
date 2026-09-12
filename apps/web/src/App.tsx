import { AuthPage } from "@/auth/auth-page"
import { AccountPage } from "@/auth/account-page"
import { useAccount } from "@/auth/context"
import { readAuthRoute, withoutAuthSecrets } from "@/auth/navigation"
import { AuthProvider } from "@/auth/provider"
import { AppShell } from "@/components/app-shell"
import { EventsRoute } from "@/events"
import { isEventPath, withoutPaymentSecrets } from "@/events/policies"
import { lazy, Suspense } from "react"
import { Loading } from "@/events/ui"
import { SupportRoute } from "@/support"
import { isSupportPath } from "@/support/policies"
import {
  createInvitationMemory,
  readInvitationToken,
  withoutInvitationSecrets,
} from "@/access/invitation-memory"

const InvitationPage = lazy(() =>
  import("@/access/invitation-page").then((module) => ({
    default: module.InvitationPage,
  }))
)

const initialURL = new URL(window.location.href)
const invitationMemory = createInvitationMemory(readInvitationToken(initialURL))
const invitationSafeURL = new URL(
  withoutInvitationSecrets(initialURL),
  initialURL.origin
)
if (initialURL.pathname === "/invitations/accept") {
  initialURL.search = ""
  initialURL.hash = ""
}
const paymentSafeURL = new URL(
  withoutPaymentSecrets(invitationSafeURL),
  initialURL.origin
)
const route = readAuthRoute(paymentSafeURL)
const safeURL = withoutAuthSecrets(paymentSafeURL)
if (
  `${window.location.pathname}${window.location.search}${window.location.hash}` !==
  safeURL
) {
  window.history.replaceState(null, "", safeURL)
}

function AppRoutes() {
  const { messages: t } = useAccount()
  if (isSupportPath(window.location.pathname))
    return (
      <AppShell>
        <SupportRoute path={window.location.pathname} />
      </AppShell>
    )
  if (window.location.pathname === "/invitations/accept")
    return (
      <AppShell>
        <Suspense fallback={<Loading />}>
          <InvitationPage memory={invitationMemory} />
        </Suspense>
      </AppShell>
    )
  if (isEventPath(window.location.pathname))
    return (
      <AppShell>
        <EventsRoute path={window.location.pathname} />
      </AppShell>
    )
  if (window.location.pathname === "/account")
    return (
      <AppShell>
        <AccountPage />
      </AppShell>
    )
  if (route.mode)
    return (
      <AppShell authLayout>
        <AuthPage route={route} />
      </AppShell>
    )
  return (
    <AppShell>
      <section className="auth-card account-state-card">
        <h1>{t.pageNotFound}</h1>
        <p>{t.pageNotFoundDescription}</p>
        <a className="primary-link" href="/account">
          {t.continueToAccount}
        </a>
      </section>
    </AppShell>
  )
}

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}

export default App
