import { Buffer } from "node:buffer"
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test"
import type { Locale } from "@elc/shared"
import { createAuth, type Auth, type AuthEmail } from "./index"
import { resetPasswordEmail, verificationEmail } from "./email"
import { createAuthTestDatabase } from "./test-database"

describe("localized Better Auth callbacks on D1", () => {
  let fixture: Awaited<ReturnType<typeof createAuthTestDatabase>>,
    auth: Auth,
    sequence = 0
  const origin = "http://localhost:5173",
    authOrigin = "http://localhost:8787",
    mailbox: AuthEmail[] = [],
    providerFetch = vi.fn<typeof fetch>(async () => {
      throw new Error("External email delivery is disabled in this test")
    })

  beforeAll(async () => {
    fixture = await createAuthTestDatabase()
    auth = createAuth(
      {
        DB: fixture.DB,
        APP_ORIGIN: origin,
        AUTH_URL: authOrigin,
        AUTH_SECRET: "test-only-auth-secret-with-more-than-32-characters",
        EMAIL_FROM: "elc <noreply@example.test>",
        ENVIRONMENT: "local",
      },
      {
        sendEmail: async (email) => {
          mailbox.push(email)
        },
        fetch: providerFetch,
      }
    )
  })

  afterAll(async () => {
    await fixture?.runtime.dispose()
  })

  function post(
    path: string,
    body: unknown,
    acceptLanguage?: string,
    cookie?: string
  ) {
    return auth.handler(
      new Request(`${authOrigin}/api/auth${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          "CF-Connecting-IP": `192.0.2.${++sequence}`,
          ...(acceptLanguage ? { "Accept-Language": acceptLanguage } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify(body),
      })
    )
  }

  function link(email: AuthEmail) {
    const value = email.text.split("\n\n")[1]
    if (!value || new URL(value).origin !== authOrigin)
      throw new Error(
        "Expected a canonical authentication link in the private mailbox"
      )
    return value
  }

  function received(to: string, kind: AuthEmail["kind"], locale: Locale) {
    const email = mailbox.findLast(
      (item) => item.to === to && item.kind === kind
    )
    if (!email) throw new Error("Expected an email in the private mailbox")
    const template =
      kind === "verify-email" ? verificationEmail : resetPasswordEmail
    expect(email).toEqual(template(to, link(email), locale))
    expect(providerFetch).not.toHaveBeenCalled()
    return email
  }

  async function signUp(acceptLanguage?: string) {
    const account = {
      email: `locale-${sequence + 1}@example.test`,
      name: "Locale fixture",
      password: "fixture-password-123",
    }
    const response = await post("/sign-up/email", account, acceptLanguage)
    expect(response.status).toBe(200)
    const result = (await response.json()) as { user: { id: string } }
    return { ...account, id: result.user.id }
  }

  async function saveLocale(userId: string, locale: Locale) {
    await fixture.DB.prepare(
      `INSERT INTO profiles (user_id, locale, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET locale = excluded.locale, updated_at = excluded.updated_at`
    )
      .bind(userId, locale, Date.now())
      .run()
  }

  it.each([
    ["kk-KZ", "kk"],
    ["ru-KZ,kk;q=0.5", "ru"],
    ["fr-FR,en-US;q=0.8,ru;q=0.6", "en"],
  ] as const)(
    "passes request preference %s to both callbacks",
    async (header, locale) => {
      const account = await signUp(header),
        verification = received(account.email, "verify-email", locale)
      expect(
        await fixture.DB.prepare(
          "SELECT locale FROM profiles WHERE user_id = ?"
        )
          .bind(account.id)
          .first()
      ).toBeNull()
      const token = new URL(link(verification)).searchParams.get("token")!,
        payload = JSON.parse(
          Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")
        ) as { exp: number; iat: number }
      expect(payload.exp - payload.iat).toBe(3600)
      expect(
        (
          await post(
            "/request-password-reset",
            {
              email: account.email,
              redirectTo: `${origin}/reset-password`,
            },
            header
          )
        ).status
      ).toBe(200)
      const reset = received(account.email, "reset-password", locale),
        resetToken = new URL(link(reset)).pathname.split("/").at(-1)!,
        stored = await fixture.DB.prepare(
          "SELECT expires_at, created_at FROM verification WHERE identifier = ?"
        )
          .bind(`reset-password:${resetToken}`)
          .first<{ expires_at: number; created_at: number }>()
      expect(stored).not.toBeNull()
      expect(stored!.expires_at - stored!.created_at).toBeGreaterThanOrEqual(
        3_590_000
      )
      expect(stored!.expires_at - stored!.created_at).toBeLessThanOrEqual(
        3_600_000
      )
    }
  )

  it("falls back to Kazakh without a supported preference and does not persist the request locale", async () => {
    const account = await signUp("de-DE,*;q=0.5")
    received(account.email, "verify-email", "kk")
    expect(
      (await post("/request-password-reset", { email: account.email })).status
    ).toBe(200)
    received(account.email, "reset-password", "kk")
    expect(
      (
        await post(
          "/send-verification-email",
          { email: account.email },
          "en-US"
        )
      ).status
    ).toBe(200)
    received(account.email, "verify-email", "en")
    expect(
      await fixture.DB.prepare("SELECT locale FROM profiles WHERE user_id = ?")
        .bind(account.id)
        .first()
    ).toBeNull()
  })

  it.each(["kk", "ru", "en"] as const)(
    "uses current saved %s over conflicting headers for both callbacks",
    async (locale) => {
      const account = await signUp("en-US")
      await saveLocale(account.id, locale)
      const header = locale === "ru" ? "en-US,kk;q=0.5" : "ru-KZ"
      expect(
        (
          await post(
            "/send-verification-email",
            { email: account.email, locale: "en" },
            header
          )
        ).status
      ).toBe(200)
      received(account.email, "verify-email", locale)
      expect(
        (
          await post(
            "/request-password-reset",
            { email: account.email, locale: "ru" },
            header
          )
        ).status
      ).toBe(200)
      received(account.email, "reset-password", locale)
      const next = locale === "en" ? "kk" : "en"
      await saveLocale(account.id, next)
      expect(
        (
          await post(
            "/send-verification-email",
            { email: account.email },
            header
          )
        ).status
      ).toBe(200)
      received(account.email, "verify-email", next)
      expect(
        (
          await post(
            "/request-password-reset",
            { email: account.email },
            header
          )
        ).status
      ).toBe(200)
      received(account.email, "reset-password", next)
    }
  )

  it("uses the reset recipient's callback identity despite a different signed-in actor and spoofed fields", async () => {
    const actor = await signUp("en"),
      verification = received(actor.email, "verify-email", "en")
    expect((await auth.handler(new Request(link(verification)))).status).toBe(
      302
    )
    await saveLocale(actor.id, "en")
    const signIn = await post("/sign-in/email", actor)
    expect(signIn.status).toBe(200)
    const cookie = signIn.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
      recipient = await signUp("kk")
    await saveLocale(recipient.id, "ru")
    const response = await post(
      "/request-password-reset",
      {
        email: recipient.email.toUpperCase(),
        userId: actor.id,
        locale: "en",
      },
      "en-US",
      cookie
    )
    expect(response.status).toBe(200)
    received(recipient.email, "reset-password", "ru")
    expect(
      mailbox.filter(
        (email) => email.to === actor.email && email.kind === "reset-password"
      )
    ).toHaveLength(0)
  })

  it("keeps unknown-account recovery generic and sends no mail", async () => {
    const before = mailbox.length,
      response = await post(
        "/request-password-reset",
        { email: "unknown-locale@example.test" },
        "ru-KZ"
      )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: true,
      message:
        "If this email exists in our system, check your email for the reset link",
    })
    expect(mailbox).toHaveLength(before)
    expect(providerFetch).not.toHaveBeenCalled()
  })
})
