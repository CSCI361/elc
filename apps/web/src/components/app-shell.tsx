import {
  ArrowUpRightIcon,
  MoonIcon,
  SunIcon,
  TicketIcon,
  UserCircleIcon,
} from "@phosphor-icons/react"
import type { ReactNode } from "react"
import { useAccount } from "@/auth/context"
import { LocaleSelect } from "@/auth/locale-select"
import { useTheme } from "./theme-provider"
import { useEventText } from "@/events/messages"
import { useSupportText } from "@/support/messages"
import { useHistoryText } from "@/history/messages"
import { useAnalyticsText } from "@/analytics/messages"
import { DeliveryNavigation } from "@/delivery/navigation"

export function AppShell({
  children,
  authLayout = false,
}: {
  children: ReactNode
  authLayout?: boolean
}) {
  const { messages: t, status, account } = useAccount()
  const { theme, setTheme } = useTheme()
  const { t: eventLabel } = useEventText()
  const { t: supportLabel } = useSupportText()
  const { t: historyLabel } = useHistoryText()
  const { t: analyticsLabel } = useAnalyticsText()
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  return (
    <div className="elc-app">
      <a href="#main-content" className="skip-link">
        {t.skipToContent}
      </a>
      <div className="demo-banner" role="region" aria-label={t.academicDemo}>
        <span className="demo-dot" />
        {t.academicDemo}
        <span className="demo-detail">{t.demoDescription}</span>
      </div>
      <header className="app-header">
        <a className="wordmark" href="/" aria-label={`elc, ${t.home}`}>
          <span className="brand-mark">
            <TicketIcon size={25} weight="fill" aria-hidden />
          </span>
          elc<span className="wordmark-period">.</span>
        </a>
        <nav className="header-actions" aria-label={t.account}>
          <LocaleSelect />
          <button
            className="theme-toggle"
            type="button"
            onClick={() => setTheme(dark ? "light" : "dark")}
            aria-label={dark ? t.lightTheme : t.darkTheme}
          >
            {dark ? (
              <SunIcon size={21} aria-hidden />
            ) : (
              <MoonIcon size={21} aria-hidden />
            )}
          </button>
          <a
            className="header-account"
            href={status === "active" ? "/account" : "/auth/sign-in"}
            aria-label={status === "active" ? t.account : t.signIn}
          >
            <UserCircleIcon size={21} aria-hidden />
            <span>{status === "active" ? t.account : t.signIn}</span>
          </a>
        </nav>
      </header>
      <nav className="event-navigation" aria-label={eventLabel("discover")}>
        {status === "active" && account ? (
          <DeliveryNavigation key={account.user.id} />
        ) : null}
        {status === "active" ? (
          <a
            href="/support"
            aria-current={
              window.location.pathname.startsWith("/support")
                ? "page"
                : undefined
            }
          >
            {supportLabel("support")}
          </a>
        ) : null}
        <a
          href="/events"
          aria-current={
            window.location.pathname === "/" ||
            (window.location.pathname.startsWith("/events") &&
              !window.location.pathname.endsWith("/analytics"))
              ? "page"
              : undefined
          }
        >
          {eventLabel("discover")}
        </a>
        <a
          href="/organizer/events"
          aria-current={
            window.location.pathname.startsWith("/organizer/events") &&
            !window.location.pathname.endsWith("/history") &&
            !window.location.pathname.endsWith("/duplicate")
              ? "page"
              : undefined
          }
        >
          {eventLabel("organize")}
        </a>
        {status === "active" ? (
          <>
            <a
              href="/organizer/analytics"
              aria-current={
                window.location.pathname === "/organizer/analytics" ||
                window.location.pathname.endsWith("/analytics")
                  ? "page"
                  : undefined
              }
            >
              {analyticsLabel("availableEvents")}
            </a>
            <a
              href="/organizer/history"
              aria-current={
                window.location.pathname === "/organizer/history" ||
                window.location.pathname.endsWith("/history") ||
                window.location.pathname.endsWith("/duplicate")
                  ? "page"
                  : undefined
              }
            >
              {historyLabel("title")}
            </a>
          </>
        ) : null}
        {status === "active" ? (
          <a
            href="/orders"
            aria-current={
              window.location.pathname.startsWith("/orders") ||
              window.location.pathname.startsWith("/tickets")
                ? "page"
                : undefined
            }
          >
            {eventLabel("orders")}
          </a>
        ) : null}
      </nav>
      <main
        id="main-content"
        className={authLayout ? "auth-layout" : "main-layout"}
      >
        {authLayout ? (
          <aside className="auth-story" aria-label={t.welcomeTitle}>
            <div className="story-topline">
              <span>elc / {t.academicDemo}</span>
              <ArrowUpRightIcon size={24} aria-hidden />
            </div>
            <div className="story-copy">
              <h2>{t.welcomeTitle}</h2>
              <p>{t.welcomeDescription}</p>
            </div>
            <div className="ticket-art" aria-hidden="true">
              <div className="art-orbit orbit-one" />
              <div className="art-orbit orbit-two" />
              <div className="art-ticket">
                <span className="art-ticket-brand">elc.</span>
                <span className="art-ticket-line">{t.brandCaption}</span>
                <div className="art-ticket-perforation" />
                <span className="art-ticket-caption">{t.academicDemo}</span>
                <TicketIcon size={42} weight="thin" />
              </div>
              <span className="art-star">✳</span>
            </div>
            <p className="story-note">{t.welcomeNote}</p>
          </aside>
        ) : null}
        <div className={authLayout ? "auth-panel" : "main-panel"}>
          {children}
        </div>
      </main>
      <footer className="app-footer">
        <span>{t.footerNote}</span>
        <span>{t.privacyNote}</span>
      </footer>
    </div>
  )
}
