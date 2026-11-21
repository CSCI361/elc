import { offlineRoute } from "@/offline-operations/policies"
import { AuthPage } from "@/auth/auth-page"
import { AccountPage } from "@/auth/account-page"
import { useAccount } from "@/auth/context"
import { readAuthRoute, withoutAuthSecrets } from "@/auth/navigation"
import { AuthProvider } from "@/auth/provider"
import { AppShell } from "@/components/app-shell"
import { EventsRoute } from "@/events"
import { isEventPath, withoutPaymentSecrets } from "@/events/policies"
import { Suspense, useEffect, useRef, type ReactNode } from "react"
import { PageErrorBoundary } from "@/components/page-error-boundary"
import { preloadedPage, preloadPages } from "@/lib/preloaded-page"
import { interceptLinkClicks, useLocation } from "@/lib/navigation"
import { Loading } from "@/events/ui"
import { useEventText } from "@/events/messages"
import { OrganizerEventLayout } from "@/events/organizer-workspace"
import { SupportRoute } from "@/support"
import { isSupportPath } from "@/support/policies"
import { payoutEventId } from "@/payouts/policies"
import { HistoryRoute } from "@/history"
import { isHistoryPath } from "@/history/policies"
import { analyticsEventId } from "@/analytics/policies"
import { deliveryRoute } from "@/delivery/route"
import { LegalPage } from "@/legal/page"
import {
  createInvitationMemory,
  readInvitationToken,
  withoutInvitationSecrets,
} from "@/access/invitation-memory"

const OfflineOperationsPage = preloadedPage(() =>
  import("@/offline-operations/page").then(
    (module) => module.OfflineOperationsPage
  )
)

const InvitationPage = preloadedPage(() =>
  import("@/access/invitation-page").then((module) => module.InvitationPage)
)
const PayoutPage = preloadedPage(() =>
  import("@/payouts/page").then((module) => module.PayoutPage)
)
const EventAnalyticsPage = preloadedPage(() =>
  import("@/analytics/page").then((module) => module.EventAnalyticsPage)
)
const AnalyticsIndexPage = preloadedPage(() =>
  import("@/analytics/index-page").then((module) => module.AnalyticsIndexPage)
)
const DeliveryPage = preloadedPage(() =>
  import("@/delivery/page").then((module) => module.DeliveryPage)
)
const AdministrationPage = preloadedPage(() =>
  import("@/administration/page").then((module) => module.AdministrationPage)
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
const initialAuthRoute = readAuthRoute(paymentSafeURL)
const safeURL = withoutAuthSecrets(paymentSafeURL)
if (
  `${window.location.pathname}${window.location.search}${window.location.hash}` !==
  safeURL
) {
  window.history.replaceState(null, "", safeURL)
}

function lazyPage(page: ReactNode) {
  return <Suspense fallback={<Loading />}>{page}</Suspense>
}

function authRouteFor(location: string) {
  return location === safeURL.replace(/#.*$/, "")
    ? initialAuthRoute
    : readAuthRoute(new URL(location, window.location.origin))
}

function pageFor(pathname: string, location: string): ReactNode {
  const offline = offlineRoute(pathname)
  if (offline)
    return lazyPage(
      offline.eventId ? (
        <OrganizerEventLayout eventId={offline.eventId}>
          <OfflineOperationsPage eventId={offline.eventId} />
        </OrganizerEventLayout>
      ) : (
        <OfflineOperationsPage />
      )
    )
  const administrationSection =
    /^\/admin\/(accounts|events|settings|operations|campaigns|reports)$/.exec(
      pathname
    )?.[1] as
      | "accounts"
      | "events"
      | "settings"
      | "operations"
      | "campaigns"
      | "reports"
      | undefined
  if (administrationSection)
    return lazyPage(<AdministrationPage section={administrationSection} />)
  const delivery = deliveryRoute(pathname)
  if (delivery) return lazyPage(<DeliveryPage id={delivery.id} />)
  if (pathname === "/organizer/analytics")
    return lazyPage(<AnalyticsIndexPage />)
  const analyticsId = analyticsEventId(pathname)
  if (analyticsId)
    return lazyPage(
      <OrganizerEventLayout eventId={analyticsId}>
        <EventAnalyticsPage eventId={analyticsId} />
      </OrganizerEventLayout>
    )
  if (isHistoryPath(pathname)) return <HistoryRoute path={pathname} />
  const payoutId = payoutEventId(pathname)
  if (payoutId)
    return lazyPage(
      <OrganizerEventLayout eventId={payoutId}>
        <PayoutPage eventId={payoutId} />
      </OrganizerEventLayout>
    )
  if (isSupportPath(pathname)) return <SupportRoute path={pathname} />
  if (pathname === "/invitations/accept")
    return lazyPage(<InvitationPage memory={invitationMemory} />)
  if (isEventPath(pathname)) return <EventsRoute path={pathname} />
  if (pathname === "/account") return <AccountPage />
  if (pathname === "/privacy") return <LegalPage page="privacy" />
  if (pathname === "/terms") return <LegalPage page="terms" />
  const authRoute = authRouteFor(location)
  if (authRoute.mode) return <AuthPage route={authRoute} />
  return <NotFound />
}

function NotFound() {
  const { messages: t } = useAccount()
  const { t: eventText } = useEventText()
  return (
    <section className="auth-card account-state-card">
      <h1>{t.pageNotFound}</h1>
      <p>{eventText("notFoundHint")}</p>
      <a className="primary-link" href="/events">
        {eventText("discover")}
      </a>
    </section>
  )
}

function AppRoutes() {
  const { pathname, location } = useLocation()
  useEffect(() => interceptLinkClicks(), [])
  useEffect(() => {
    const timer = window.setTimeout(() => void preloadPages(), 1000)
    return () => window.clearTimeout(timer)
  }, [])
  const previousLocation = useRef(location)
  useEffect(() => {
    if (previousLocation.current === location) return
    previousLocation.current = location
    const main = document.getElementById("main-content")
    if (main && !main.contains(document.activeElement))
      main.focus({ preventScroll: true })
  }, [location])
  const page = pageFor(pathname, location)
  const authLayout =
    !isEventPath(pathname) && authRouteFor(location).mode !== null
  return (
    <AppShell authLayout={authLayout}>
      <div key={location} className="contents">
        <PageErrorBoundary>{page}</PageErrorBoundary>
      </div>
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
