import { describe, expect, it } from "vite-plus/test"
import {
  authHref,
  readAuthRoute,
  safeReturnPath,
  withoutAuthSecrets,
} from "./navigation"

const origin = "https://app.example.test"

describe("authentication navigation", () => {
  it("keeps a local destination with its search and fragment", () => {
    expect(safeReturnPath("/events/one?view=tickets#details", origin)).toBe(
      "/events/one?view=tickets#details"
    )
    expect(safeReturnPath("/events/../account", origin)).toBe("/account")
    expect(authHref("sign-in", "/events/one?view=tickets")).toBe(
      "/auth/sign-in?returnTo=%2Fevents%2Fone%3Fview%3Dtickets"
    )
  })

  it("rejects off-site, ambiguous, API and recursive auth destinations", () => {
    for (const destination of [
      null,
      "",
      "https://attacker.test/",
      "//attacker.test/",
      "/\\attacker.test/",
      "javascript:alert(1)",
      "/\n/attacker.test",
      "/\t/attacker.test",
      "/api/me",
      "/api",
      "/auth/sign-out",
      "/account/../auth/sign-in",
    ]) {
      expect(safeReturnPath(destination, origin)).toBe("/account")
    }
  })

  it("accepts reset credentials only on the reset page and sanitizes return paths", () => {
    expect(
      readAuthRoute(
        new URL(
          `${origin}/auth/reset-password?token=private-test-token&returnTo=https://attacker.test`
        )
      )
    ).toMatchObject({
      mode: "reset-password",
      resetToken: "private-test-token",
      returnTo: "/account",
    })
    expect(
      readAuthRoute(new URL(`${origin}/auth/sign-in?token=private-test-token`))
        .resetToken
    ).toBeNull()
    expect(readAuthRoute(new URL(`${origin}/anything/sign-in`)).mode).toBeNull()
  })

  it("removes auth secrets from browser history while preserving a safe notice", () => {
    const url = new URL(
      `${origin}/auth/reset-password?token=private&token=again&code=oauth&state=opaque&email=person%40example.test&password=secret&error_description=sensitive&notice=password-reset`
    )
    expect(withoutAuthSecrets(url)).toBe(
      "/auth/reset-password?notice=password-reset"
    )
    expect(url.searchParams.get("token")).toBe("private")
  })
})
