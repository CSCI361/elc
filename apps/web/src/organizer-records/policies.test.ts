import { describe, expect, it } from "vite-plus/test"
import {
  recordsBase,
  recordsDrilldown,
  recordsHref,
  recordsLinks,
  recordsPage,
  recordsQuery,
  recordsReset,
  recordsSearch,
  recordsTab,
} from "./policies"

describe("organizer records URL filters", () => {
  it("defaults to the first twenty attendees and preserves a normalized name query", () => {
    expect(recordsQuery("")).toEqual({ kind: "tickets", q: "", limit: 20 })
    expect(recordsQuery("?kind=orders&q=%20Жанар%20&orderId=order-1")).toEqual({
      kind: "orders",
      q: "Жанар",
      orderId: "order-1",
      limit: 20,
    })
  })
  it.each([
    "?kind=unknown",
    "?kind=orders&kind=tickets",
    "?q=a&q=b",
    "?cursor=a&cursor=b",
    "?accountId=secret",
    "?limit=0",
    "?limit=51",
    "?limit=1.5",
    "?q=" + "a".repeat(201),
    "?orderId=" + "a".repeat(129),
    "?ticketId=" + "a".repeat(129),
    "?cursor=" + "a".repeat(2049),
  ])("rejects ambiguous or out-of-contract query %s", (search) =>
    expect(recordsQuery(search)).toBeNull()
  )
  it("round trips opaque cursor and ID characters without introducing query parameters", () => {
    const query = {
      kind: "tickets" as const,
      q: "Алия & friends",
      orderId: "order&admin=true",
      ticketId: "ticket?x=y",
      cursor: "opaque+/=&value",
      limit: 20,
    }
    expect(recordsQuery(recordsSearch(query))).toEqual(query)
    expect(recordsBase("event/with?reserved#characters")).toBe(
      "/organizer/events/event%2Fwith%3Freserved%23characters/registrations"
    )
    const href = new URL(recordsHref("event-1", query), "https://elc.example")
    expect(href.searchParams.has("admin")).toBe(false)
    expect(href.pathname).toBe("/organizer/events/event-1/registrations")
  })
  it("preserves search and exact filters across keyset pages and resets only the cursor for first page", () => {
    const query = {
      kind: "checkins" as const,
      q: "Aida",
      orderId: "order-1",
      ticketId: "ticket-1",
      cursor: "old-page",
      limit: 20,
    }
    expect(recordsPage(query, "new-page")).toEqual({
      ...query,
      cursor: "new-page",
    })
    expect(recordsQuery(recordsSearch(recordsPage(query)))).toEqual({
      kind: query.kind,
      q: query.q,
      orderId: query.orderId,
      ticketId: query.ticketId,
      limit: query.limit,
    })
    expect(query.cursor).toBe("old-page")
  })
  it("changes view without carrying a cursor scoped to the previous view", () => {
    const query = {
      kind: "tickets" as const,
      q: "Aida",
      orderId: "order-1",
      cursor: "page",
      limit: 20,
    }
    expect(recordsTab(query, "orders")).toEqual({
      ...query,
      kind: "orders",
      cursor: undefined,
    })
  })
  it("exact record drilldown drops unrelated search and ID constraints", () => {
    const query = {
      kind: "tickets" as const,
      q: "previous name",
      orderId: "wrong-order",
      ticketId: "wrong-ticket",
      cursor: "page",
      limit: 20,
    }
    expect(
      recordsQuery(
        recordsSearch(
          recordsDrilldown(query, { kind: "orders", orderId: "right-order" })
        )
      )
    ).toEqual({ kind: "orders", q: "", orderId: "right-order", limit: 20 })
    expect(
      recordsQuery(
        recordsSearch(
          recordsDrilldown(query, {
            kind: "checkins",
            ticketId: "right-ticket",
          })
        )
      )
    ).toEqual({ kind: "checkins", q: "", ticketId: "right-ticket", limit: 20 })
    expect(recordsReset(query)).toEqual({ kind: "tickets", q: "", limit: 20 })
  })
})

describe("organizer records capability links", () => {
  const none = {
    manage: false,
    history: false,
    analytics: false,
    support: false,
    refund: false,
  }
  it("offers no related action when each permission is absent", () =>
    expect(recordsLinks("event", none, "order")).toEqual([]))
  it.each([
    ["manage", "/organizer/events/event"],
    ["history", "/organizer/events/event/history"],
    ["analytics", "/events/event/analytics"],
    ["support", "/support?view=staff&eventId=event"],
    ["refund", "/orders/order/refund"],
  ] as const)(
    "uses %s independently of event management permission",
    (permission, href) => {
      const links = recordsLinks(
        "event",
        { ...none, [permission]: true },
        "order"
      )
      expect(links).toHaveLength(1)
      expect(links[0]?.href).toBe(href)
    }
  )
  it("never opens purchaser checkout or admission credentials and needs an order for refunds", () => {
    const all = {
      manage: true,
      history: true,
      analytics: true,
      support: true,
      refund: true,
    }
    expect(
      recordsLinks("event", all).some((link) => link.label === "refundAction")
    ).toBe(false)
    const links = recordsLinks("event", all, "order/with?special")
    expect(links.find((link) => link.label === "refundAction")?.href).toBe(
      "/orders/order%2Fwith%3Fspecial/refund"
    )
    expect(
      links.some(
        (link) =>
          link.href.includes("credential") || link.href === "/orders/order"
      )
    ).toBe(false)
  })
})
