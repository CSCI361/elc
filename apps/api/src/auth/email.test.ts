import { describe, expect, it, vi } from "vite-plus/test"
import {
  AuthDeliveryError,
  createEmailSender,
  hasEmailTransport,
  resetPasswordEmail,
  verificationEmail,
} from "./email"

const emailConfig = {
  RESEND_API_KEY: "test-provider-key",
  EMAIL_FROM: "elc <noreply@example.test>",
}

describe("authentication email delivery", () => {
  it("fails without delivery configuration and never treats a missing provider as success", async () => {
    const config = { EMAIL_FROM: emailConfig.EMAIL_FROM }
    expect(hasEmailTransport(config)).toBe(false)
    await expect(
      createEmailSender(config)(
        verificationEmail("user@example.test", "https://elc.test/verify")
      )
    ).rejects.toMatchObject({ code: "EMAIL_UNAVAILABLE" })
  })

  it("uses the explicitly injected private transport", async () => {
    const sendEmail = vi.fn().mockResolvedValue(undefined)
    const email = resetPasswordEmail(
      "user@example.test",
      "https://elc.test/reset?token=test-token"
    )
    await createEmailSender({ EMAIL_FROM: "" }, { sendEmail })(email)
    expect(sendEmail).toHaveBeenCalledWith(email)
    expect(hasEmailTransport({ EMAIL_FROM: "" }, { sendEmail })).toBe(true)
  })

  it("deduplicates a retry while keeping distinct reset links separate", async () => {
    const providerFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}"))
    const sendEmail = createEmailSender(emailConfig, { fetch: providerFetch })
    const first = resetPasswordEmail(
      "user@example.test",
      "https://elc.test/reset?token=first"
    )
    await sendEmail(first)
    await sendEmail(first)
    await sendEmail(
      resetPasswordEmail(first.to, "https://elc.test/reset?token=second")
    )

    const keys = providerFetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("Idempotency-Key")
    )
    expect(keys[0]).toBe(keys[1])
    expect(keys[0]).not.toBe(keys[2])
    expect(keys[0]).not.toContain("first")
    const [, request] = providerFetch.mock.calls[0]!
    expect(JSON.parse(request!.body as string)).toEqual({
      from: emailConfig.EMAIL_FROM,
      to: [first.to],
      subject: first.subject,
      text: first.text,
    })
  })

  it("does not include provider responses or transport secrets in delivery errors", async () => {
    const secret = "sensitive-provider-response"
    const providerFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(secret, { status: 422 }))
    const sendEmail = createEmailSender(emailConfig, { fetch: providerFetch })
    await expect(
      sendEmail(
        verificationEmail("user@example.test", "https://elc.test/verify")
      )
    ).rejects.toEqual(new AuthDeliveryError("EMAIL_DELIVERY_FAILED"))
    providerFetch.mockRejectedValue(new Error(secret))
    await expect(
      sendEmail(
        verificationEmail("user@example.test", "https://elc.test/verify")
      )
    ).rejects.toEqual(new AuthDeliveryError("EMAIL_DELIVERY_FAILED"))
  })
})
