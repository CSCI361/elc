import { describe, expect, it } from "vite-plus/test"
import {
  AnalyticsConsentController,
  analyticsPageMetadata,
  createBrowserAnalytics,
  analyticsConsentKey,
  type AnalyticsPage,
  type AnalyticsTransport,
} from "./analytics-browser"

const page = {
  kind: "event",
  locale: "en",
  eventReportingId: "rpt_event0001",
  campaignReportingId: "rpt_campaign01",
} as const
function fixture(saved: string | null = null) {
  const events: {
      name: string
      parameters: Record<string, string | number>
    }[] = [],
    starts: unknown[] = [],
    stops: boolean[] = []
  const transport: AnalyticsTransport = {
    start: (data) => {
      starts.push(data)
    },
    event: (name, parameters) => {
      events.push({ name, parameters })
    },
    stop: (clear) => {
      stops.push(Boolean(clear))
    },
  }
  const storage = {
    get: () => saved,
    set: (value: string) => {
      saved = value
    },
  }
  const controller = new AnalyticsConsentController(
    "https://elc.example.test",
    transport,
    storage
  )
  return { controller, events, starts, stops, storage, transport }
}
describe("explicit per-origin analytics consent", () => {
  it.each([null, "denied", "true", "malformed"])(
    "does not start collection for stored choice %s",
    (value) => {
      const f = fixture(value)
      f.controller.setPage(page)
      f.controller.checkout(10000, 1, true)
      expect(f.starts).toEqual([])
      expect(f.events).toEqual([])
    }
  )
  it("collects approved events only after an explicit opt-in and deduplicates unchanged metadata", () => {
    const f = fixture()
    f.controller.setPage(page)
    f.controller.setConsent("granted")
    f.controller.setPage({ ...page })
    expect(f.events.map((event) => event.name)).toEqual([
      "page_view",
      "view_item",
      "campaign_visit",
    ])
    expect(f.starts).toHaveLength(1)
    expect(f.storage.get()).toBe("granted")
    f.controller.checkout(9999, 2, true)
    expect(f.events.at(-1)).toMatchObject({
      name: "begin_checkout",
      parameters: {
        value: 99.99,
        quantity: 2,
        currency: "KZT",
        campaign_reporting_id: page.campaignReportingId,
      },
    })
  })
  it("withdraws immediately, clears controlled cookies and requires fresh page context after re-grant", () => {
    const f = fixture("granted")
    f.controller.setPage(page)
    f.controller.setConsent("denied")
    const count = f.events.length
    f.controller.checkout(100, 1)
    f.controller.setConsent("granted")
    expect(f.events).toHaveLength(count)
    expect(f.stops).toContain(true)
    f.controller.setPage(page)
    expect(f.events).toHaveLength(count + 3)
  })
  it("stops on protected pages even when consent remains granted", () => {
    const f = fixture("granted")
    f.controller.setPage(page)
    f.controller.setPage(null)
    f.controller.checkout(100, 1)
    expect(f.events).toHaveLength(3)
    expect(f.controller.snapshot()).toBe("granted")
    expect(f.stops.at(-1)).toBe(false)
  })
  it("uses only fixed titles, reporting IDs and sanitized locations", () => {
    const f = fixture("granted")
    f.controller.setPage({
      ...page,
      url: "https://elc.example.test/events/private?campaign=REDEEMABLE&email=person@example.test",
      title: "Private name",
      referrer: "https://example.test/token/secret",
      orderId: "order-secret",
    } as AnalyticsPage)
    const serialized = JSON.stringify({ starts: f.starts, events: f.events })
    for (const forbidden of [
      "REDEEMABLE",
      "person@example.test",
      "Private name",
      "order-secret",
      "token/secret",
    ])
      expect(serialized).not.toContain(forbidden)
    expect(f.events[0]!.parameters).toMatchObject({
      page_location: "https://elc.example.test/events/rpt_event0001",
      page_referrer: "",
      page_title: "elc public event",
    })
  })
  it.each(["private", "order", "ticket", "support", "scanner"])(
    "rejects the unapproved %s page kind",
    (kind) => {
      const f = fixture("granted")
      f.controller.setPage({ kind, locale: "en" } as AnalyticsPage)
      expect(f.events).toEqual([])
    }
  )
  it("rejects malformed reporting identifiers instead of forwarding arbitrary text", () => {
    const f = fixture("granted")
    f.controller.setPage({ ...page, eventReportingId: "user@example.test" })
    expect(f.events).toEqual([])
  })
  it("does not attach the previous campaign to a changed checkout code", () => {
    const f = fixture("granted")
    f.controller.setPage(page)
    f.controller.checkout(100, 1, false)
    expect(f.events.at(-1)!.parameters).not.toHaveProperty(
      "campaign_reporting_id"
    )
  })
  it.each([
    [-1, 1],
    [NaN, 1],
    [100, 0],
    [100, 101],
    [100, 1.5],
  ])("rejects invalid checkout value %s or quantity %s", (value, quantity) => {
    const f = fixture("granted")
    f.controller.setPage(page)
    f.controller.checkout(value, quantity)
    expect(f.events).toHaveLength(3)
  })
  it("responds to consent changes from another same-origin tab", () => {
    const f = fixture("granted")
    f.controller.setPage(page)
    f.storage.set("denied")
    f.controller.refreshConsent()
    f.controller.checkout(100, 1)
    expect(f.events).toHaveLength(3)
    expect(f.controller.snapshot()).toBe("denied")
  })
  it("keeps separate choices for web and marketing origins", () => {
    const web = fixture(),
      marketing = fixture()
    web.controller.setConsent("granted")
    marketing.controller.setPage({ kind: "marketing", locale: "ru" })
    expect(marketing.events).toEqual([])
    expect(marketing.controller.snapshot()).toBe("unset")
    expect(
      analyticsPageMetadata("https://marketing.example.test?secret=1", {
        kind: "marketing",
        locale: "ru",
      }).location
    ).toBe("https://marketing.example.test/ru/")
  })
  it("keeps application actions usable when storage or the transport fails", () => {
    const controller = new AnalyticsConsentController(
      "https://elc.example.test",
      {
        start: () => {
          throw new Error("offline")
        },
        stop: () => {
          throw new Error("blocked")
        },
        event: () => {
          throw new Error("blocked")
        },
      },
      {
        get: () => {
          throw new Error("storage")
        },
        set: () => {
          throw new Error("storage")
        },
      }
    )
    expect(() => {
      controller.setPage(page)
      controller.setConsent("granted")
      controller.checkout(100, 1)
      controller.setConsent("denied")
    }).not.toThrow()
  })
})

function browserFixture() {
  const scripts: Record<string, unknown>[] = [],
    cookies = new Map<string, string>(),
    listeners = new Map<string, (event: Record<string, unknown>) => void>(),
    storage = new Map<string, string>()
  const document = {
    get cookie() {
      return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ")
    },
    set cookie(value: string) {
      const [pair, ...attributes] = value.split(";"),
        [name, ...parts] = pair!.split("=")
      if (attributes.some((attribute) => attribute.trim() === "Max-Age=0"))
        cookies.delete(name!)
      else cookies.set(name!, parts.join("="))
    },
    createElement: () => ({ dataset: {}, remove() {} }),
    head: {
      append: (script: Record<string, unknown>) => {
        scripts.push(script)
      },
    },
  }
  const browser = {
    document,
    location: { origin: "https://elc.example.test" },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
    },
    addEventListener: (
      name: string,
      listener: (event: Record<string, unknown>) => void
    ) => listeners.set(name, listener),
    elcAnalyticsLayer: [] as unknown[],
    "ga-disable-G-TEST12345": false,
  }
  return {
    browser,
    scripts,
    cookies,
    listeners,
    storage,
    controller: createBrowserAnalytics(
      "G-TEST12345",
      browser as unknown as Window
    ),
    commands: () =>
      browser.elcAnalyticsLayer.map((value) =>
        Array.from(value as ArrayLike<unknown>)
      ),
  }
}
describe("Google tag boundary", () => {
  it("loads no tag before opt-in and configures sanitized page fields with ads and auto pageviews off", () => {
    const f = browserFixture()
    f.controller.setPage(page)
    expect(f.scripts).toEqual([])
    expect(f.commands()).toEqual([])
    f.controller.setConsent("granted")
    expect(f.scripts).toHaveLength(1)
    expect(f.scripts[0]).toMatchObject({
      referrerPolicy: "no-referrer",
      src: "https://www.googletagmanager.com/gtag/js?id=G-TEST12345&l=elcAnalyticsLayer",
    })
    const config = f.commands().find((command) => command[0] === "config")![2]
    expect(config).toMatchObject({
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      user_id: null,
      page_referrer: "",
      page_location: "https://elc.example.test/events/rpt_event0001",
      cookie_domain: "none",
      cookie_prefix: "elc_analytics",
      cookie_update: false,
    })
    expect(f.commands()[0]).toEqual([
      "consent",
      "default",
      {
        analytics_storage: "granted",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        personalization_storage: "denied",
      },
    ])
  })
  it("disables pending sends and deletes only application-controlled analytics cookies on withdrawal", () => {
    const f = browserFixture()
    f.controller.setConsent("granted")
    f.controller.setPage(page)
    f.cookies.set("elc_analytics_ga", "client")
    f.cookies.set("elc_analytics_ga_TEST12345", "session")
    f.cookies.set("better-auth.session_token", "keep")
    f.cookies.set("other_cookie", "keep")
    f.controller.setConsent("denied")
    expect(f.browser["ga-disable-G-TEST12345"]).toBe(true)
    expect(f.commands()).toEqual([])
    expect([...f.cookies.keys()]).toEqual([
      "better-auth.session_token",
      "other_cookie",
    ])
    expect(f.storage.get(analyticsConsentKey)).toBe("denied")
  })
  it("disables the previous document during page navigation", () => {
    const f = browserFixture()
    f.controller.setConsent("granted")
    f.controller.setPage(page)
    f.listeners.get("pagehide")!({})
    expect(f.browser["ga-disable-G-TEST12345"]).toBe(true)
    expect(f.commands()).toEqual([])
  })
})
