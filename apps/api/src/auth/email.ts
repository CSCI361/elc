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

export function verificationEmail(to: string, url: string): AuthEmail {
  return {
    kind: "verify-email",
    to,
    subject: "Verify your elc account",
    text: `Verify your email address to use your elc account:\n\n${url}\n\nThis link expires in one hour. If you did not create this account, you can ignore this email.\n\nelc is an academic demonstration.`,
  }
}

export function resetPasswordEmail(to: string, url: string): AuthEmail {
  return {
    kind: "reset-password",
    to,
    subject: "Reset your elc password",
    text: `Use this link to reset your elc password:\n\n${url}\n\nThis link expires in one hour. If you did not request a reset, you can ignore this email.\n\nelc is an academic demonstration.`,
  }
}
