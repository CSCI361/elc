import type { Locale } from "@elc/shared"

export type AuthEmail = {
  kind: "verify-email" | "reset-password"
  to: string
  subject: string
  text: string
}

export type AuthEmailTransport = (email: AuthEmail) => Promise<void>

export type AuthDependencies = {
  /** Tests and local development may inject a private mailbox transport. */
  sendEmail?: AuthEmailTransport
  fetch?: typeof fetch
}

type EmailConfig = {
  RESEND_API_KEY?: string
  EMAIL_FROM: string
}

export class AuthDeliveryError extends Error {
  readonly code: "EMAIL_UNAVAILABLE" | "EMAIL_DELIVERY_FAILED"

  constructor(code: AuthDeliveryError["code"]) {
    super(
      code === "EMAIL_UNAVAILABLE"
        ? "Email delivery is not configured."
        : "Email delivery failed. Please try again later."
    )
    this.name = "AuthDeliveryError"
    this.code = code
  }
}

export function hasEmailTransport(
  config: EmailConfig,
  dependencies: AuthDependencies = {}
) {
  return Boolean(
    dependencies.sendEmail || (config.RESEND_API_KEY && config.EMAIL_FROM)
  )
}

/** Resend receives the token only in the email body; provider errors never include it. */
export function createEmailSender(
  config: EmailConfig,
  dependencies: AuthDependencies = {}
): AuthEmailTransport {
  if (dependencies.sendEmail) return dependencies.sendEmail

  return async (email) => {
    if (!hasEmailTransport(config))
      throw new AuthDeliveryError("EMAIL_UNAVAILABLE")

    // Retrying the same verification/reset email must not create duplicate delivery.
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${email.kind}\n${email.to}\n${email.text}`)
    )
    const idempotencyKey = [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")

    let response: Response
    try {
      response = await (dependencies.fetch ?? fetch)(
        "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.RESEND_API_KEY}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `elc-auth-${idempotencyKey}`,
          },
          body: JSON.stringify({
            from: config.EMAIL_FROM,
            to: [email.to],
            subject: email.subject,
            text: email.text,
          }),
          signal: AbortSignal.timeout(10_000),
        }
      )
    } catch {
      throw new AuthDeliveryError("EMAIL_DELIVERY_FAILED")
    }
    if (!response.ok) throw new AuthDeliveryError("EMAIL_DELIVERY_FAILED")
  }
}

const copy: Record<
  Locale,
  {
    verificationSubject: string
    verificationInstruction: string
    verificationIgnore: string
    resetSubject: string
    resetInstruction: string
    resetIgnore: string
    expiry: string
    demo: string
  }
> = {
  kk: {
    verificationSubject: "elc тіркелгіңізді растаңыз",
    verificationInstruction:
      "elc тіркелгіңізді пайдалану үшін электрондық пошта мекенжайыңызды мына сілтеме арқылы растаңыз:",
    verificationIgnore:
      "Бұл тіркелгіні сіз жасамаған болсаңыз, хатты елемеуге болады.",
    resetSubject: "elc құпиясөзін қалпына келтіру",
    resetInstruction:
      "elc құпиясөзін қалпына келтіру үшін мына сілтемені ашыңыз:",
    resetIgnore:
      "Құпиясөзді қалпына келтіруді сіз сұрамаған болсаңыз, хатты елемеуге болады.",
    expiry: "Бұл сілтеме 1 сағат бойы жарамды.",
    demo: "elc оқу мақсатындағы демонстрациялық жоба.",
  },
  ru: {
    verificationSubject: "Подтвердите учётную запись elc",
    verificationInstruction:
      "Чтобы пользоваться учётной записью elc, подтвердите адрес электронной почты по этой ссылке:",
    verificationIgnore:
      "Если вы не создавали эту учётную запись, проигнорируйте письмо.",
    resetSubject: "Сброс пароля elc",
    resetInstruction: "Чтобы сбросить пароль elc, откройте эту ссылку:",
    resetIgnore: "Если вы не запрашивали сброс пароля, проигнорируйте письмо.",
    expiry: "Эта ссылка действительна в течение одного часа.",
    demo: "elc создан как учебный демонстрационный проект.",
  },
  en: {
    verificationSubject: "Verify your elc account",
    verificationInstruction:
      "Verify your email address to use your elc account:",
    verificationIgnore:
      "If you did not create this account, you can ignore this email.",
    resetSubject: "Reset your elc password",
    resetInstruction: "Use this link to reset your elc password:",
    resetIgnore: "If you did not request a reset, you can ignore this email.",
    expiry: "This link expires in one hour.",
    demo: "elc is an academic demonstration.",
  },
}

export function verificationEmail(
  to: string,
  url: string,
  locale: Locale = "kk"
): AuthEmail {
  const text = copy[locale]
  return {
    kind: "verify-email",
    to,
    subject: text.verificationSubject,
    text: `${text.verificationInstruction}\n\n${url}\n\n${text.expiry} ${text.verificationIgnore}\n\n${text.demo}`,
  }
}

export function resetPasswordEmail(
  to: string,
  url: string,
  locale: Locale = "kk"
): AuthEmail {
  const text = copy[locale]
  return {
    kind: "reset-password",
    to,
    subject: text.resetSubject,
    text: `${text.resetInstruction}\n\n${url}\n\n${text.expiry} ${text.resetIgnore}\n\n${text.demo}`,
  }
}
