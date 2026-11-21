import { describe, expect, it } from "vite-plus/test"
import { scanVerdict } from "./scan-verdict"

describe("scan verdict", () => {
  it("should tell staff to let a confirmed ticket in", () => {
    expect(scanVerdict({ response: "checked_in" })).toEqual({
      tone: "success",
      title: "letIn",
      body: "checkedInDone",
    })
  })

  it.each(["already_used", "invalid", "wrong_event", "refunded"] as const)(
    "should stop entry for an online %s result",
    (result) => {
      expect(scanVerdict({ response: result })?.tone).toBe("danger")
    }
  )

  it("should let an offline ticket in and say it is saved on the phone", () => {
    expect(scanVerdict({ local: "provisional" })).toEqual({
      tone: "success",
      title: "letIn",
      body: "savedOnPhone",
    })
  })

  it("should stop a ticket missing from the saved list", () => {
    expect(scanVerdict({ local: "unknown_ticket" })).toEqual({
      tone: "danger",
      title: "notOnList",
      body: "notOnListBody",
    })
  })

  it("should show an unconfirmed check as a warning, not a refusal", () => {
    expect(scanVerdict({ message: "notConfirmed" })).toEqual({
      tone: "warning",
      title: "noAnswer",
      body: "noAnswerBody",
    })
  })

  it("should report an undone offline check-in neutrally", () => {
    expect(scanVerdict({ local: "provisional", undone: true })?.tone).toBe(
      "neutral"
    )
  })

  it("should return nothing before a scan", () => {
    expect(scanVerdict({})).toBeNull()
  })
})
