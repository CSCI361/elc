import { describe, expect, it } from "vite-plus/test"
import { parsePlatformHint, platformHrefsFor } from "./header-hint"

describe("header hint", () => {
  it("should keep only known admin addresses from stored data", () => {
    expect(
      parsePlatformHint(
        '["/admin/accounts","https://evil.test","/admin/deliveries"]'
      )
    ).toEqual(["/admin/accounts", "/admin/deliveries"])
  })

  it("should give no admin links for missing or broken stored data", () => {
    expect(parsePlatformHint(null)).toEqual([])
    expect(parsePlatformHint("{not json")).toEqual([])
    expect(parsePlatformHint('{"href":"/admin/accounts"}')).toEqual([])
  })

  it("should pick the admin links that the permissions allow", () => {
    expect(platformHrefsFor(["platform:moderate", "platform:recover"])).toEqual(
      ["/admin/accounts", "/admin/deliveries"]
    )
    expect(platformHrefsFor(["platform:configure"])).toEqual([
      "/admin/settings",
    ])
    expect(platformHrefsFor([])).toEqual([])
  })
})
