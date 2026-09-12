import { AuthPage } from "@/auth/auth-page"
import { AccountPage } from "@/auth/account-page"
import { useAccount } from "@/auth/context"
import { readAuthRoute, withoutAuthSecrets } from "@/auth/navigation"
import { AuthProvider } from "@/auth/provider"
import { AppShell } from "@/components/app-shell"

const initialURL = new URL(window.location.href)
const route = readAuthRoute(initialURL)
const safeURL = withoutAuthSecrets(initialURL)
if (
  `${initialURL.pathname}${initialURL.search}${initialURL.hash}` !== safeURL
) {
  window.history.replaceState(null, "", safeURL)
}

function AppRoutes() {
  const { messages: t } = useAccount()
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
