import { ga4EventSchema, reportingIdSchema, type Ga4Event } from "./operations"
import { localeSchema, type Locale } from "./common"

export const analyticsConsentKey = "elc.analytics-consent.v1"
export type AnalyticsConsent = "unset" | "granted" | "denied"
export type AnalyticsPage =
  | { kind: "marketing" | "directory"; locale: Locale }
  | {
      kind: "event"
      locale: Locale
      eventReportingId: string
      campaignReportingId?: string
    }
export type AnalyticsTransport = {
  start: (page: { location: string; title: string; locale: Locale }) => void
  event: (
    name: Ga4Event["name"],
    parameters: Record<string, string | number>
  ) => void
  stop: (clear?: boolean) => void
}
export function analyticsPageMetadata(origin: string, input: AnalyticsPage) {
  const url = new URL(origin)
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("INVALID_ANALYTICS_ORIGIN")
  const locale = localeSchema.parse(input.locale)
  if (input.kind === "event") {
    reportingIdSchema.parse(input.eventReportingId)
    if (input.campaignReportingId)
      reportingIdSchema.parse(input.campaignReportingId)
    return {
      location: `${url.origin}/events/${input.eventReportingId}`,
      title: "elc public event",
      locale,
    }
  }
  if (input.kind !== "marketing" && input.kind !== "directory")
    throw new Error("INVALID_ANALYTICS_PAGE")
  return {
    location: `${url.origin}${input.kind === "directory" ? "/events" : locale === "kk" ? "/" : `/${locale}/`}`,
    title: input.kind === "directory" ? "elc public events" : "elc",
    locale,
  }
}

/** This controller accepts reporting metadata, never raw URLs, referrers or customer details. */
export class AnalyticsConsentController {
  private consent: AnalyticsConsent
  private page: AnalyticsPage | null = null
  private activeKey: string | null = null
  private listeners = new Set<() => void>()
  private readonly origin: string
  private readonly transport: AnalyticsTransport
  private readonly storage: {
    get: () => string | null
    set: (value: string) => void
  }
  constructor(
    origin: string,
    transport: AnalyticsTransport,
    storage: { get: () => string | null; set: (value: string) => void }
  ) {
    this.origin = origin
    this.transport = transport
    this.storage = storage
    this.consent = this.readConsent()
  }
  private readConsent(): AnalyticsConsent {
    try {
      const value = this.storage.get()
      return value === "granted" || value === "denied" ? value : "unset"
    } catch {
      return "unset"
    }
  }
  snapshot = () => this.consent
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private changed() {
    for (const listener of this.listeners) listener()
  }
  setConsent = (choice: "granted" | "denied") => {
    this.consent = choice
    if (choice === "denied") this.page = null
    try {
      this.storage.set(choice)
    } catch {
      /* An explicit choice still applies to the current document. */
    }
    this.apply()
    this.changed()
  }
  refreshConsent = () => {
    this.consent = this.readConsent()
    if (this.consent !== "granted") this.page = null
    this.apply()
    this.changed()
  }
  setPage(page: AnalyticsPage | null) {
    if (page) {
      try {
        analyticsPageMetadata(this.origin, page)
      } catch {
        page = null
      }
    }
    this.page = page
    this.apply()
  }
  private apply() {
    try {
      this.applyInternal()
    } catch {
      this.activeKey = null
      try {
        this.transport.stop(true)
      } catch {
        /* Analytics failures never block the application. */
      }
    }
  }
  private applyInternal() {
    if (this.consent !== "granted" || !this.page) {
      this.activeKey = null
      this.transport.stop(this.consent !== "granted")
      return
    }
    const key = JSON.stringify(this.page)
    if (key === this.activeKey) return
    this.transport.stop()
    const metadata = analyticsPageMetadata(this.origin, this.page)
    this.transport.start(metadata)
    this.activeKey = key
    this.emit("page_view")
    if (this.page.kind === "event") {
      this.emit("view_item")
      if (this.page.campaignReportingId) this.emit("campaign_visit")
    }
  }
  private emit(
    name: Ga4Event["name"],
    purchase?: {
      valueMinor: number
      quantity: number
      includeCampaign: boolean
    }
  ) {
    const page = this.page
    if (this.consent !== "granted" || !page || !this.activeKey) return
    const parsed = ga4EventSchema.safeParse({
      name,
      locale: page.locale,
      pageKind:
        page.kind === "marketing"
          ? "marketing"
          : page.kind === "directory"
            ? "public_directory"
            : name === "begin_checkout"
              ? "public_event_checkout"
              : "public_event",
      ...(page.kind === "event"
        ? {
            eventReportingId: page.eventReportingId,
            ...(!purchase || purchase.includeCampaign
              ? { campaignReportingId: page.campaignReportingId }
              : {}),
          }
        : {}),
      ...(purchase
        ? {
            valueMinor: purchase.valueMinor,
            quantity: purchase.quantity,
            currency: "KZT",
          }
        : {}),
    })
    if (!parsed.success) return
    const event = parsed.data,
      metadata = analyticsPageMetadata(this.origin, page)
    const parameters: Record<string, string | number> = {
      page_location: metadata.location,
      page_title: metadata.title,
      page_referrer: "",
      locale: event.locale,
    }
    if (event.eventReportingId)
      parameters.event_reporting_id = event.eventReportingId
    if (event.campaignReportingId)
      parameters.campaign_reporting_id = event.campaignReportingId
    if (event.valueMinor !== undefined)
      parameters.value = event.valueMinor / 100
    if (event.quantity !== undefined) parameters.quantity = event.quantity
    if (event.currency) parameters.currency = event.currency
    try {
      this.transport.event(name, parameters)
    } catch {
      /* Collection is best effort. */
    }
  }
  checkout(valueMinor: number, quantity: number, includeCampaign = false) {
    if (
      this.page?.kind !== "event" ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 100
    )
      return
    this.emit("begin_checkout", { valueMinor, quantity, includeCampaign })
  }
  stop = () => {
    this.setPage(null)
  }
}

type AnalyticsWindow = Window &
  typeof globalThis & {
    elcAnalyticsLayer?: unknown[]
    [key: `ga-disable-${string}`]: boolean
  }
export function createBrowserAnalytics(
  measurementId: string | undefined,
  target: Window = window
) {
  const browser = target as AnalyticsWindow
  const id = /^G-[A-Z0-9]{6,20}$/.test(measurementId ?? "")
    ? measurementId!
    : null
  let script: HTMLScriptElement | undefined
  let initialized = false
  const layer = (browser.elcAnalyticsLayer ??= [])
  function command(..._args: unknown[]) {
    layer.push(arguments)
  }
  function clearCookies() {
    try {
      for (const pair of browser.document.cookie.split(";")) {
        const name = pair.trim().split("=")[0]!
        if (/^elc_analytics_[A-Za-z0-9_]+$/.test(name))
          browser.document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`
      }
    } catch {
      /* Blocked cookie access cannot affect the product flow. */
    }
  }
  const transport: AnalyticsTransport = {
    start(page) {
      if (!id) return
      browser[`ga-disable-${id}`] = false
      if (!initialized) {
        command("consent", "default", {
          analytics_storage: "granted",
          ad_storage: "denied",
          ad_user_data: "denied",
          ad_personalization: "denied",
          personalization_storage: "denied",
        })
        command("js", new Date())
        initialized = true
      }
      command("config", id, {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        user_id: null,
        cookie_domain: "none",
        cookie_path: "/",
        cookie_prefix: "elc_analytics",
        cookie_expires: 60 * 24 * 60 * 60,
        cookie_update: false,
        cookie_flags: "SameSite=Lax;Secure",
        page_location: page.location,
        page_referrer: "",
        page_title: page.title,
        language: page.locale,
        ignore_referrer: true,
        campaign_id: "",
        campaign_source: "",
        campaign_medium: "",
        campaign_name: "",
        campaign_term: "",
        campaign_content: "",
      })
      if (!script) {
        script = browser.document.createElement("script")
        script.async = true
        script.referrerPolicy = "no-referrer"
        script.src = `https://www.googletagmanager.com/gtag/js?id=${id}&l=elcAnalyticsLayer`
        script.dataset.elcAnalytics = "true"
        script.onerror = () => {
          script?.remove()
          script = undefined
          initialized = false
          layer.length = 0
        }
        browser.document.head.append(script)
      }
    },
    event(name, parameters) {
      if (id && !browser[`ga-disable-${id}`])
        command("event", name, { ...parameters, send_to: id })
    },
    stop(clear = false) {
      if (id) browser[`ga-disable-${id}`] = true
      layer.length = 0
      initialized = false
      if (clear) clearCookies()
    },
  }
  const controller = new AnalyticsConsentController(
    browser.location.origin,
    transport,
    {
      get: () => browser.localStorage.getItem(analyticsConsentKey),
      set: (value) => browser.localStorage.setItem(analyticsConsentKey, value),
    }
  )
  transport.stop(controller.snapshot() !== "granted")
  browser.addEventListener("storage", (event) => {
    if (event.key === analyticsConsentKey || event.key === null)
      controller.refreshConsent()
  })
  browser.addEventListener("pagehide", controller.stop)
  return controller
}
