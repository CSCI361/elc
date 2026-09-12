import { describe, expect, it } from "vite-plus/test"
import {
  createInvitationMemory,
  readInvitationToken,
  withoutInvitationSecrets,
} from "./invitation-memory"
import { withoutPaymentSecrets, isEventPath } from "../events/policies"
import { readAuthRoute, withoutAuthSecrets } from "../auth/navigation"

const token = "A".repeat(43)
describe("invitation navigation privacy", () => {
  it("accepts only one valid fragment token on its dedicated route", () => {
    expect(
      readInvitationToken(
        new URL(`https://elc.test/invitations/accept#token=${token}`)
      )
    ).toBe(token)
    for (const path of [
      `/invitations/accept?token=${token}`,
      `/events/demo#token=${token}`,
      `/invitations/accept#token=${token}&token=${token}`,
      "/invitations/accept#token=short",
      "/invitations/accept#token=%3Cscript%3E",
    ]) {
      expect(readInvitationToken(new URL(path, "https://elc.test"))).toBeNull()
    }
  })
  it("removes every invitation query and fragment before links can be built", () => {
    const initial = new URL(
      `https://elc.test/invitations/accept?token=${token}&email=private#token=${token}`
    )
    expect(withoutInvitationSecrets(initial)).toBe("/invitations/accept")
    const auth = new URL("/auth/sign-in", initial.origin)
    auth.searchParams.set(
      "returnTo",
      `/invitations/accept?token=${token}#token=${token}`
    )
    expect(
      new URL(withoutInvitationSecrets(auth), auth.origin).searchParams.get(
        "returnTo"
      )
    ).toBe("/invitations/accept")
  })
  it("preserves the existing password reset and payment sanitization flow", () => {
    const reset = new URL(`https://elc.test/auth/reset-password?token=${token}`)
    const sanitized = new URL(
      withoutPaymentSecrets(
        new URL(withoutInvitationSecrets(reset), reset.origin)
      ),
      reset.origin
    )
    expect(readAuthRoute(sanitized).resetToken).toBe(token)
    expect(withoutAuthSecrets(sanitized)).not.toContain(token)
    const payment = new URL(
      "https://elc.test/payments/return?attempt=known&customer_session_token=secret"
    )
    expect(
      withoutPaymentSecrets(
        new URL(withoutInvitationSecrets(payment), payment.origin)
      )
    ).toBe("/payments/return?attempt=known")
  })
  it("discards consumed tokens and does not share them between page instances", () => {
    const page = createInvitationMemory(token)
    const another = createInvitationMemory(null)
    expect(another.read()).toBeNull()
    page.clear()
    expect(page.read()).toBeNull()
    page.replace("B".repeat(43))
    expect(page.read()).toBe("B".repeat(43))
    page.replace(null)
    expect(page.read()).toBeNull()
  })
  it("recognizes only the bounded organizer access route", () => {
    expect(isEventPath("/organizer/events/fixture/access")).toBe(true)
    expect(isEventPath("/organizer/events/fixture/access/extra")).toBe(false)
    expect(isEventPath("/organizer/events/fixture/platform")).toBe(false)
  })
})
