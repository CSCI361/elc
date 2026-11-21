import { describe, expect, it, vi } from "vite-plus/test"
import { policy } from "@elc/shared"

vi.mock("react-native", () => ({ AppState: {}, Platform: { OS: "ios" } }))
vi.mock("expo-constants", () => ({ default: {} }))
vi.mock("expo-linking", () => ({}))

const { hasBetterAuthCookies } = await import("@better-auth/expo/client")

describe("mobile session cookie", () => {
  it.each([
    "elc.session_token=abc; Path=/; HttpOnly",
    "__Secure-elc.session_token=abc; Path=/; HttpOnly; Secure",
  ])("should keep the session cookie the API sets: %s", (header) => {
    expect(hasBetterAuthCookies(header, policy.authCookiePrefix)).toBe(true)
  })

  it("should ignore session cookies from another app", () => {
    expect(
      hasBetterAuthCookies(
        "better-auth.session_token=abc; Path=/",
        policy.authCookiePrefix
      )
    ).toBe(false)
  })
})
