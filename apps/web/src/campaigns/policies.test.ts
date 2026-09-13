import { describe, expect, it } from "vite-plus/test"
import {
  campaignLink,
  parseCampaignDraft,
  type CampaignDraft,
} from "./policies"
import { campaignQrSvg } from "./qr"

const link = {
  url: "https://elc.example/events/event-1?campaign=opaque-code",
  origin: "https://elc.example",
  eventId: "event-1",
  code: "opaque-code",
  allowLocalDevelopment: false,
}
const draft: CampaignDraft = {
  name: "Early birds",
  kind: "percentage",
  amount: "10",
  maxRedemptions: "100",
  starts: "2026-09-13T12:00",
  ends: "2026-09-14T12:00",
  ticketTypeIds: ["type-1"],
}

describe("campaign creation policy", () => {
  it("preserves seconds and milliseconds in unchanged default event windows", () => {
    const window = {
      startsAt: "2026-09-13T07:00:35.123Z",
      endsAt: "2026-09-14T07:00:59.456Z",
    }
    expect(
      parseCampaignDraft(draft, "event-1", "Asia/Almaty", window)
    ).toMatchObject(window)
    expect(
      parseCampaignDraft(
        { ...draft, ends: "2026-09-15T12:00" },
        "event-1",
        "Asia/Almaty",
        window
      )
    ).toMatchObject({
      startsAt: window.startsAt,
      endsAt: "2026-09-15T07:00:00.000Z",
    })
  })
  it("creates a disabled campaign with exact percentage units and event-zone dates", () => {
    expect(parseCampaignDraft(draft, "event-1", "Asia/Almaty")).toMatchObject({
      enabled: false,
      discount: { kind: "percentage", basisPoints: 1000 },
      maxRedemptions: 100,
      startsAt: "2026-09-13T07:00:00.000Z",
      endsAt: "2026-09-14T07:00:00.000Z",
    })
  })
  it("accepts exact fixed KZT and hundredth percentage inputs", () => {
    expect(
      parseCampaignDraft(
        { ...draft, kind: "fixed", amount: "12,34" },
        "event-1",
        "UTC"
      )?.discount
    ).toEqual({ kind: "fixed", amountMinor: 1234 })
    expect(
      parseCampaignDraft({ ...draft, amount: "10.25" }, "event-1", "UTC")
        ?.discount
    ).toEqual({ kind: "percentage", basisPoints: 1025 })
  })
  it.each([
    { amount: "0" },
    { amount: "0.99" },
    { amount: "100.01" },
    { amount: "1.001" },
    { amount: "1e2" },
    { kind: "fixed" as const, amount: "0" },
    { kind: "fixed" as const, amount: "90071992547409.92" },
    { maxRedemptions: "0" },
    { maxRedemptions: "2.5" },
    { maxRedemptions: "9007199254740992" },
    { name: " " },
    { starts: "2026-02-30T12:00" },
    { ends: draft.starts },
    { ends: "2026-09-12T12:00" },
    { ticketTypeIds: [] },
    { ticketTypeIds: ["type-1", "type-1"] },
  ])("rejects invalid terms %j", (change) => {
    expect(
      parseCampaignDraft({ ...draft, ...change }, "event-1", "Asia/Almaty")
    ).toBeNull()
  })
})

describe("campaign QR URL boundary", () => {
  it("allows only the exact canonical same-origin campaign URL", () => {
    expect(campaignLink(link)).toEqual({ url: link.url, local: false })
  })
  it.each([
    "https://evil.example/events/event-1?campaign=opaque-code",
    "https://elc.example/events/other?campaign=opaque-code",
    "https://elc.example/events/event-1?campaign=other",
    "https://elc.example/events/event-1?campaign=opaque-code&campaign=opaque-code",
    "https://elc.example/events/event-1?campaign=opaque-code&token=secret",
    "https://elc.example/events/event-1?campaign=opaque-code#fragment",
    "https://user:pass@elc.example/events/event-1?campaign=opaque-code",
    "https://elc.example/tickets/event-1?campaign=opaque-code",
    "http://elc.example/events/event-1?campaign=opaque-code",
    "javascript:alert(1)",
    "data:text/plain,test",
  ])("rejects unsafe or non-campaign URLs: %s", (url) =>
    expect(campaignLink({ ...link, url })).toBeNull()
  )
  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "permits labelled local development only on %s",
    (host) => {
      const origin = `http://${host}:5173`
      const input = {
        ...link,
        origin,
        url: `${origin}/events/event-1?campaign=opaque-code`,
      }
      expect(campaignLink(input)).toBeNull()
      expect(campaignLink({ ...input, allowLocalDevelopment: true })).toEqual({
        url: input.url,
        local: true,
      })
    }
  )
  it.each(["localhost.evil.example", "192.168.1.2", "elc.example"])(
    "rejects HTTP host %s even in development",
    (host) => {
      const origin = `http://${host}:5173`
      expect(
        campaignLink({
          ...link,
          origin,
          url: `${origin}/events/event-1?campaign=opaque-code`,
          allowLocalDevelopment: true,
        })
      ).toBeNull()
    }
  )
})

describe("downloaded campaign SVG", () => {
  const labels = {
    name: "Campaign <script>alert('x')</script> & offer",
    promotionLabel: "Promotional campaign",
    notTicketLabel: "Not an admission ticket",
    localLabel: "Local development only",
  }
  it("escapes campaign text and includes permanent promotional and non-admission labels", () => {
    const result = campaignQrSvg({ ...link, ...labels })
    expect(result?.svg).toContain("Not an admission ticket")
    expect(result?.svg).toContain("Promotional campaign")
    expect(result?.svg).toContain("&lt;script&gt;")
    expect(result?.svg).not.toMatch(/<script|<foreignObject|href=|onload=/)
    expect(result?.svg).toContain('fill="white"')
    expect(result?.svg).toContain('shape-rendering="crispEdges"')
  })
  it("keeps maximum length titles within four rows above the QR", () => {
    const result = campaignQrSvg({ ...link, ...labels, name: "W".repeat(100) })
    const rows = [
      ...(result?.svg ?? "").matchAll(
        /<text[^>]+y="(\d+)"[^>]+font-size="16"[^>]*>(W+)<\/text>/g
      ),
    ]
    expect(rows).toHaveLength(4)
    expect(rows.map((row) => row[2]?.length)).toEqual([25, 25, 25, 25])
    expect(rows.at(-1)?.[1]).toBe("121")
  })
  it("never creates a QR for a rejected URL and embeds the local-only warning", () => {
    expect(
      campaignQrSvg({ ...link, ...labels, url: "https://evil.example" })
    ).toBeNull()
    const origin = "http://localhost:5173"
    expect(
      campaignQrSvg({
        ...link,
        ...labels,
        origin,
        url: `${origin}/events/event-1?campaign=opaque-code`,
        allowLocalDevelopment: true,
      })?.svg
    ).toContain("Local development only")
  })
})
