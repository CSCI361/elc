import { describe, expect, it } from "vite-plus/test"
import { visibleStatus, type OfflineStatus } from "./model"

const status = { eventId: "event", pendingCount: 3 } as OfflineStatus

describe("offline card status", () => {
  it("should show the last status read for this event and account", () => {
    expect(visibleStatus(status, "account", "event")).toBe(status)
  })

  it("should hide the status once no offline account is open", () => {
    expect(visibleStatus(status, null, "event")).toBeNull()
  })

  it("should hide a status read for another event", () => {
    expect(visibleStatus(status, "account", "other")).toBeNull()
  })
})
