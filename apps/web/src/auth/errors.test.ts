import { describe, expect, it } from "vite-plus/test"
import { authErrorMessage } from "./errors"

describe("safe authentication errors", () => {
  it("uses translated known errors and gives rate limiting priority", () => {
    expect(authErrorMessage({ code: "EMAIL_NOT_VERIFIED" })).toBe(
      "errorUnverified"
    )
    expect(authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD" })).toBe(
      "errorCredentials"
    )
    expect(authErrorMessage({ code: "INVALID_TOKEN" })).toBe("resetInvalid")
    expect(authErrorMessage({ code: "EMAIL_UNAVAILABLE" })).toBe(
      "emailUnavailable"
    )
    expect(
      authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD", status: 429 })
    ).toBe("errorRateLimit")
  })

  it("does not expose an unknown provider error or token as a message", () => {
    expect(
      authErrorMessage({
        code: "private-token-or-provider-detail",
        status: 500,
      })
    ).toBe("errorGeneric")
    expect(authErrorMessage({})).toBe("errorGeneric")
  })
})
