import { describe, expect, it } from "vite-plus/test"
import { reportMessages } from "./messages"
import { reportDraft, reportQueuePath, resolutionDraft } from "./policies"

const openReport = {
  id: "report",
  revision: 2,
  eventSuspended: false,
}

describe("event report policies", () => {
  it("builds a trimmed report body for a supported category", () => {
    expect(reportDraft("fraud", "  Tickets resold elsewhere.  ")).toEqual({
      ok: true,
      body: { category: "fraud", details: "Tickets resold elsewhere." },
    })
  })

  it("rejects missing, unknown and overlong report input", () => {
    expect(reportDraft("fraud", "   ")).toEqual({ ok: false })
    expect(reportDraft("spam", "Details")).toEqual({ ok: false })
    expect(reportDraft("other", "x".repeat(1001))).toEqual({ ok: false })
  })

  it("dismisses with the current revision and a trimmed reason", () => {
    expect(
      resolutionDraft(openReport, "dismissed", "  Verified venue. ")
    ).toEqual({
      ok: true,
      body: {
        expectedRevision: 2,
        resolution: "dismissed",
        reason: "Verified venue.",
      },
    })
  })

  it("requires a reason and a suspended event before recording action taken", () => {
    expect(resolutionDraft(openReport, "dismissed", " ")).toEqual({
      ok: false,
      error: "reasonRequired",
    })
    expect(resolutionDraft(openReport, "actioned", "Confirmed fraud.")).toEqual(
      {
        ok: false,
        error: "suspendFirst",
      }
    )
    expect(
      resolutionDraft(
        { ...openReport, eventSuspended: true },
        "actioned",
        "Confirmed fraud."
      )
    ).toMatchObject({ ok: true, body: { resolution: "actioned" } })
  })

  it("encodes queue filters and omits an absent cursor", () => {
    expect(reportQueuePath({ state: "open" })).toBe(
      "/admin/event-reports?state=open"
    )
    expect(reportQueuePath({ state: "all", cursor: "a+b/c=" })).toBe(
      "/admin/event-reports?state=all&cursor=a%2Bb%2Fc%3D"
    )
  })

  it("provides Kazakh, Russian and English text for every message", () => {
    for (const [key, value] of Object.entries(reportMessages)) {
      expect(value, key).toHaveLength(3)
      for (const text of value) expect(text.trim(), key).not.toBe("")
    }
  })
})
