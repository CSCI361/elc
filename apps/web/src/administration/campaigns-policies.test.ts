import { describe, expect, it } from "vite-plus/test"
import {
  campaignAuditHref,
  campaignFilters,
  campaignOrdersHref,
  campaignPage,
  campaignSearch,
  campaignSubmission,
} from "./campaigns-policies"
import {
  operationsFilters,
  operationsSearch,
  operationsSubmission,
} from "./operations-policies"
import { campaignAdministrationMessages } from "./campaigns-messages"

describe("platform campaign filters and operational drilldowns", () => {
  it("opens an attributed-order drilldown with campaign/event isolation and no redeemable URL fields", () => {
    const id = "campaign+id&x=1",
      eventId = "event #?"
    const url = new URL(campaignOrdersHref(id, eventId), "https://example.test")
    expect(url.pathname).toBe("/admin/operations")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      kind: "orders",
      campaignId: id,
      eventId,
    })
    const parsed = operationsFilters(url.search)!
    expect(parsed).toMatchObject({
      kind: "orders",
      campaignId: id,
      eventId,
      q: "",
      limit: 20,
    })
    expect(
      Object.fromEntries(new URLSearchParams(operationsSearch(parsed)))
    ).toEqual({ kind: "orders", campaignId: id, eventId, limit: "20" })
  })
  it("opens campaign lifecycle audit with its exact entity and event filters", () => {
    const url = new URL(
      campaignAuditHref("campaign-id", "event-id"),
      "https://example.test"
    )
    expect(operationsFilters(url.search)).toEqual({
      kind: "audit",
      q: "campaign-id",
      eventId: "event-id",
      limit: 20,
    })
    expect(url.searchParams.has("campaignId")).toBe(false)
  })
  it("keeps all applied operational filters and page cursor in a canonical export query", () => {
    const query = operationsFilters(
      "?kind=orders&campaignId=campaign&eventId=event&accountId=buyer&q=order&after=page-2&limit=20"
    )!
    expect(operationsFilters(`?${operationsSearch(query)}`)).toEqual(query)
    expect(
      Object.fromEntries(new URLSearchParams(operationsSearch(query)))
    ).toEqual({
      kind: "orders",
      q: "order",
      eventId: "event",
      accountId: "buyer",
      campaignId: "campaign",
      after: "page-2",
      limit: "20",
    })
  })
  it.each([
    "?kind=audit&campaignId=campaign",
    "?kind=payments&campaignId=campaign",
    "?kind=orders&kind=audit",
    "?q=first&q=second",
    "?unknown=ignored",
    "?kind=other",
    "?limit=51",
    "?limit=1.5",
    "?code=redeemable",
  ])(
    "rejects invalid or ambiguous operational URL %s instead of broadening the query",
    (search) => {
      expect(operationsFilters(search)).toBeNull()
    }
  )
  it("changes record kind without retaining a hidden order-only campaign filter or old cursor", () => {
    const fields = {
      kind: "audit" as const,
      q: " campaign ",
      eventId: " event ",
      accountId: " actor ",
      campaignId: "old-campaign",
    }
    expect(operationsSubmission(fields)).toEqual({
      kind: "audit",
      q: "campaign",
      eventId: "event",
      accountId: "actor",
      limit: 20,
    })
    expect(operationsSubmission({ ...fields, kind: "orders" })).toMatchObject({
      campaignId: "old-campaign",
    })
    expect(operationsSubmission({ ...fields, q: "x".repeat(201) })).toBeNull()
  })
  it("keeps campaign search filters while moving between opaque cursor pages", () => {
    const query = campaignFilters(
      "?q=%25_%20literal&eventId=event&organizerId=owner&enabled=no"
    )!
    const next = campaignPage(query, "opaque+/=&cursor")
    expect(campaignFilters(`?${campaignSearch(next)}`)).toEqual(next)
    expect(campaignPage(next)).toEqual({ ...query, cursor: undefined })
  })
  it.each([
    "?enabled=true",
    "?enabled=all&enabled=no",
    "?organizerId=a&organizerId=b",
    "?campaign=redeemable",
    "?limit=0",
    "?limit=999",
    `?q=${"x".repeat(201)}`,
    `?cursor=${"x".repeat(2049)}`,
  ])("rejects invalid catalog URL %s", (search) => {
    expect(campaignFilters(search)).toBeNull()
  })
  it("normalizes empty optional filters and keeps both web pages bounded at twenty records", () => {
    expect(
      campaignFilters("?q=&eventId=&organizerId=&cursor=&limit=50")
    ).toEqual({ q: "", enabled: "all", limit: 20 })
    expect(
      operationsFilters("?campaignId=&eventId=&accountId=&after=&limit=50")
    ).toEqual({ kind: "orders", q: "", limit: 20 })
  })
  it("applies new catalog filters without carrying an old cursor", () => {
    expect(
      campaignSubmission({
        q: " Music ",
        eventId: " event ",
        organizerId: " owner ",
        enabled: "yes",
      })
    ).toEqual({
      q: "Music",
      eventId: "event",
      organizerId: "owner",
      enabled: "yes",
      limit: 20,
    })
    expect(
      campaignSubmission({
        q: "",
        eventId: "",
        organizerId: "",
        enabled: "unknown",
      })
    ).toBeNull()
  })
  it("provides campaign terms, usage distinctions and drilldown labels in KK/RU/EN", () => {
    for (const values of Object.values(campaignAdministrationMessages)) {
      expect(values).toHaveLength(3)
      expect(values.every((value) => value.trim().length > 0)).toBe(true)
    }
    for (const key of [
      "usageHint",
      "eligibilityHint",
      "holds",
      "committed",
      "orders",
      "audit",
      "invalid",
    ] as const)
      expect(new Set(campaignAdministrationMessages[key]).size).toBe(3)
  })
})
