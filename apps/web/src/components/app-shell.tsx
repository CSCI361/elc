import { Menu } from "@base-ui/react/menu"
import { localeNames, localeSchema } from "@elc/shared"
import {
  CheckIcon,
  GlobeSimpleIcon,
  ListIcon,
  MoonIcon,
  SignOutIcon,
  SunIcon,
  UserIcon,
} from "@phosphor-icons/react"
import { useRef, useState, type ReactNode } from "react"
import { AnalyticsConsent } from "@/analytics/consent"
import { useAccount, useSignedIn } from "@/auth/context"
import { authHref } from "@/auth/navigation"
import { usePlatformLinks } from "@/delivery/navigation"
import { useEventText } from "@/events/messages"
import { useHistoryText } from "@/history/messages"
import { legalLabel } from "@/legal/messages"
import { useLocation } from "@/lib/navigation"
import { useOfflineText } from "@/offline-operations/messages"
import { useSupportText } from "@/support/messages"
import { Logo } from "./ui/logo"
import { useTheme } from "./theme-provider"

interface NavLink {
  href: string
  label: string
  current: boolean
}

function MenuPopup({
  children,
  align = "end",
}: {
  children: ReactNode
  align?: "start" | "end"
}) {
  return (
    <Menu.Portal>
      <Menu.Positioner className="menu-positioner" sideOffset={8} align={align}>
        <Menu.Popup className="menu-popup">{children}</Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

function MenuLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Menu.LinkItem className="menu-item" href={href} closeOnClick>
      {children}
    </Menu.LinkItem>
  )
}

function usePrimaryLinks(): NavLink[] {
  const signedIn = useSignedIn()
  const { pathname } = useLocation()
  const { t } = useEventText()
  return [
    {
      href: "/events",
      label: t("navEvents"),
      current:
        pathname === "/" ||
        (pathname.startsWith("/events") && !pathname.endsWith("/analytics")),
    },
    ...(signedIn
      ? [
          {
            href: "/orders",
            label: t("myTickets"),
            current:
              pathname.startsWith("/orders") || pathname.startsWith("/tickets"),
          },
        ]
      : []),
    {
      href: "/organizer/events",
      label: t("forOrganizers"),
      current: pathname.startsWith("/organizer"),
    },
  ]
}

function LocaleMenu() {
  const { locale, messages: t, changeLocale, preferencePending } = useAccount()
  return (
    <Menu.Root>
      <Menu.Trigger
        className="locale-trigger"
        aria-label={t.language}
        disabled={preferencePending}
      >
        <GlobeSimpleIcon size={18} aria-hidden />
        <span>{localeNames[locale]}</span>
      </Menu.Trigger>
      <MenuPopup>
        <Menu.RadioGroup
          value={locale}
          onValueChange={(value) =>
            void changeLocale(localeSchema.parse(value))
          }
        >
          {Object.entries(localeNames).map(([key, label]) => (
            <Menu.RadioItem
              key={key}
              value={key}
              className="menu-item"
              lang={key}
              closeOnClick
            >
              {label}
              <Menu.RadioItemIndicator className="menu-item-check">
                <CheckIcon size={16} weight="bold" aria-hidden />
              </Menu.RadioItemIndicator>
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </MenuPopup>
    </Menu.Root>
  )
}

function ThemeToggle() {
  const { messages: t } = useAccount()
  const { theme, setTheme } = useTheme()
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  return (
    <button
      className="icon-button"
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? t.lightTheme : t.darkTheme}
    >
      {dark ? (
        <SunIcon size={18} aria-hidden />
      ) : (
        <MoonIcon size={18} aria-hidden />
      )}
    </button>
  )
}

function AccountMenu() {
  const { messages: t, account, signOut } = useAccount()
  const { t: eventLabel } = useEventText()
  const { t: supportLabel } = useSupportText()
  const { t: historyLabel } = useHistoryText()
  const { t: offlineLabel } = useOfflineText()
  return (
    <Menu.Root>
      <Menu.Trigger className="account-trigger" aria-label={t.account}>
        <span className="avatar">
          <UserIcon size={16} weight="bold" aria-hidden />
        </span>
      </Menu.Trigger>
      <MenuPopup>
        {account ? (
          <div className="menu-account">
            <strong>{account.user.name}</strong>
            <span>{account.user.email}</span>
          </div>
        ) : null}
        <Menu.Separator className="menu-separator" />
        <MenuLink href="/orders">{eventLabel("myTickets")}</MenuLink>
        <MenuLink href="/support">{supportLabel("support")}</MenuLink>
        <MenuLink href="/account">{t.account}</MenuLink>
        <Menu.Separator className="menu-separator" />
        <Menu.Group>
          <Menu.GroupLabel className="menu-group-label">
            {eventLabel("forOrganizers")}
          </Menu.GroupLabel>
          <MenuLink href="/organizer/events">{eventLabel("organize")}</MenuLink>
          <MenuLink href="/organizer/analytics">
            {eventLabel("analytics")}
          </MenuLink>
          <MenuLink href="/organizer/history">{historyLabel("title")}</MenuLink>
          <MenuLink href="/offline">{offlineLabel("title")}</MenuLink>
        </Menu.Group>
        <Menu.Separator className="menu-separator" />
        <Menu.Item
          className="menu-item menu-item-danger"
          onClick={() => void signOut()}
        >
          <SignOutIcon size={16} aria-hidden />
          {t.signOut}
        </Menu.Item>
      </MenuPopup>
    </Menu.Root>
  )
}

function usePlatformNavLinks(): NavLink[] {
  const { pathname } = useLocation()
  const deliveries = pathname.startsWith("/admin/deliveries")
  return usePlatformLinks().map((link) => ({
    ...link,
    current:
      link.href === "/admin/deliveries"
        ? deliveries
        : pathname.startsWith("/admin/") && !deliveries,
  }))
}

function MobileNav({ links }: { links: NavLink[] }) {
  const { t } = useEventText()
  return (
    <Menu.Root>
      <Menu.Trigger
        className="icon-button mobile-nav-trigger"
        aria-label={t("menu")}
      >
        <ListIcon size={20} aria-hidden />
      </Menu.Trigger>
      <MenuPopup align="start">
        {links.map((link) => (
          <MenuLink key={link.href} href={link.href}>
            {link.label}
          </MenuLink>
        ))}
      </MenuPopup>
    </Menu.Root>
  )
}

function HeaderNav({ links }: { links: NavLink[] }) {
  const { messages: t } = useAccount()
  const { t: eventLabel } = useEventText()
  return (
    <>
      <MobileNav links={links} />
      <a className="brand-link" href="/" aria-label={`elc, ${t.home}`}>
        <Logo />
      </a>
      <nav className="primary-nav" aria-label={eventLabel("menu")}>
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            aria-current={link.current ? "page" : undefined}
          >
            {link.label}
          </a>
        ))}
      </nav>
    </>
  )
}

function SignedInNav({ links }: { links: NavLink[] }) {
  return <HeaderNav links={[...links, ...usePlatformNavLinks()]} />
}

function Header() {
  const { messages: t } = useAccount()
  const signedIn = useSignedIn()
  const { location } = useLocation()
  const links = usePrimaryLinks()
  return (
    <header className="app-header">
      <div className="app-header-inner">
        {signedIn ? <SignedInNav links={links} /> : <HeaderNav links={links} />}
        <div className="header-actions">
          <LocaleMenu />
          <ThemeToggle />
          {signedIn ? (
            <AccountMenu />
          ) : (
            <a
              className="btn btn-secondary btn-sm"
              href={
                location.startsWith("/auth/")
                  ? "/auth/sign-in"
                  : authHref("sign-in", location)
              }
            >
              {t.signIn}
            </a>
          )}
        </div>
      </div>
    </header>
  )
}

function Footer({
  onCookieSettings,
}: {
  onCookieSettings: (trigger: HTMLElement) => void
}) {
  const { t } = useEventText()
  const { t: supportLabel } = useSupportText()
  const { locale } = useAccount()
  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <div className="app-footer-brand">
          <Logo />
          <span>{t("footerTagline")}</span>
        </div>
        <nav aria-label="elc">
          <a href="/events">{t("navEvents")}</a>
          <a href="/organizer/events">{t("forOrganizers")}</a>
          <a href="/support">{supportLabel("support")}</a>
          <a href="/privacy">{legalLabel(locale, "privacy")}</a>
          <a href="/terms">{legalLabel(locale, "terms")}</a>
          <button
            type="button"
            onClick={(event) => onCookieSettings(event.currentTarget)}
          >
            {t("cookieSettings")}
          </button>
        </nav>
      </div>
    </footer>
  )
}

export function AppShell({
  children,
  authLayout = false,
}: {
  children: ReactNode
  authLayout?: boolean
}) {
  const { messages: t } = useAccount()
  const [cookieSettings, setCookieSettings] = useState(false)
  const cookieTrigger = useRef<HTMLElement | null>(null)
  return (
    <div className="elc-app">
      <a href="#main-content" className="skip-link">
        {t.skipToContent}
      </a>
      <Header />
      <main
        id="main-content"
        tabIndex={-1}
        className={authLayout ? "auth-layout" : "main-layout"}
      >
        <div className={authLayout ? "auth-panel" : "main-panel"}>
          {children}
        </div>
      </main>
      <Footer
        onCookieSettings={(trigger) => {
          cookieTrigger.current = trigger
          setCookieSettings(true)
        }}
      />
      <AnalyticsConsent
        reopened={cookieSettings}
        onClose={() => {
          setCookieSettings(false)
          cookieTrigger.current?.focus()
          cookieTrigger.current = null
        }}
      />
    </div>
  )
}
