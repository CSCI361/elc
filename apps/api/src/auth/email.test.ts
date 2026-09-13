import { describe, expect, it, vi } from "vite-plus/test"
import type { Locale } from "@elc/shared"
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

describe("localized authentication email text", () => {
  const canonicalUrl =
    "https://elc.test/api/auth/verify-email?token=private-test-token&callbackURL=%2Faccount"
  const expected: Record<
    Locale,
    { verify: string; reset: string; expiry: string; demo: string }
  > = {
    kk: {
      verify: "elc тіркелгіңізді растаңыз",
      reset: "elc құпиясөзін қалпына келтіру",
      expiry: "1 сағат",
      demo: "оқу мақсатындағы демонстрациялық жоба",
    },
    ru: {
      verify: "Подтвердите учётную запись elc",
      reset: "Сброс пароля elc",
      expiry: "одного часа",
      demo: "учебный демонстрационный проект",
    },
    en: {
      verify: "Verify your elc account",
      reset: "Reset your elc password",
      expiry: "one hour",
      demo: "academic demonstration",
    },
  }
  it.each(["kk", "ru", "en"] as const)(
    "preserves the canonical link, one-hour expiry and demo notice in %s",
    (locale) => {
      const verification = verificationEmail(
          "recipient@example.test",
          canonicalUrl,
          locale
        ),
        reset = resetPasswordEmail(
          "recipient@example.test",
          canonicalUrl,
          locale
        )
      expect(verification.subject).toBe(expected[locale].verify)
      expect(reset.subject).toBe(expected[locale].reset)
      for (const email of [verification, reset]) {
        expect(email.text.split("\n\n")[1]).toBe(canonicalUrl)
        expect(email.text.split(canonicalUrl)).toHaveLength(2)
        expect(email.text).toContain(expected[locale].expiry)
        expect(email.text).toContain(expected[locale].demo)
        expect(email.subject).not.toMatch(/[\r\n]/)
        expect(email.subject).not.toContain("private-test-token")
        expect(email.subject).not.toContain(email.to)
        expect(email.text).not.toContain(email.to)
        expect(email.text).not.toMatch(/<html|<a\s|<script/i)
      }
    }
  )

  it("defaults both templates to Kazakh when no locale is supplied", () => {
    expect(verificationEmail("recipient@example.test", canonicalUrl)).toEqual(
      verificationEmail("recipient@example.test", canonicalUrl, "kk")
    )
    expect(resetPasswordEmail("recipient@example.test", canonicalUrl)).toEqual(
      resetPasswordEmail("recipient@example.test", canonicalUrl, "kk")
    )
  })

  it("keeps English text and the private transport contract compatible", () => {
    const email = verificationEmail(
      "recipient@example.test",
      canonicalUrl,
      "en"
    )
    expect(email).toEqual({
      kind: "verify-email",
      to: "recipient@example.test",
      subject: "Verify your elc account",
      text: `Verify your email address to use your elc account:\n\n${canonicalUrl}\n\nThis link expires in one hour. If you did not create this account, you can ignore this email.\n\nelc is an academic demonstration.`,
    })
  })
})
