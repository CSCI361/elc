import { Hono } from "hono"
import type { Miniflare } from "miniflare"
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test"
import type { Bindings } from "../env"
import {
  createAuth,
  getAuthCapabilities,
  type Auth,
  type AuthEmail,
} from "./index"
import { requireVerifiedSession } from "./session"
import { createAuthTestDatabase } from "./test-database"

describe("Better Auth with the generated schema on local D1", () => {
  let runtime: Miniflare
  let env: Bindings
  let auth: Auth
  const mailbox: AuthEmail[] = []
  const sendEmail = async (email: AuthEmail) => {
    mailbox.push(email)
  }
  const origin = "http://localhost:5173"
  const authOrigin = "http://localhost:8787"

  beforeAll(async () => {
    const database = await createAuthTestDatabase()
    runtime = database.runtime
    const DB = database.DB
    env = {
      DB,
      APP_ORIGIN: origin,
      AUTH_URL: authOrigin,
      AUTH_SECRET: "test-only-auth-secret-with-more-than-32-characters",
      EMAIL_FROM: "elc <noreply@example.test>",
      ENVIRONMENT: "local",
    } as Bindings
    auth = createAuth(env, { sendEmail })
  })

  afterAll(async () => {
    await runtime?.dispose()
  })

  function post(
    path: string,
    body: unknown,
    options: {
      cookie?: string
      ip?: string
      origin?: string
      instance?: Auth
    } = {}
  ) {
    return (options.instance ?? auth).handler(
      new Request(`${authOrigin}/api/auth${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: options.origin ?? origin,
          "CF-Connecting-IP": options.ip ?? "192.0.2.1",
          ...(options.cookie ? { Cookie: options.cookie } : {}),
        },
        body: JSON.stringify(body),
      })
    )
  }

  function cookieFrom(response: Response) {
    return response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ")
  }

  function emailLink(email: AuthEmail) {
    const match = email.text.match(/https?:\/\/[^\s]+/)
    if (!match)
      throw new Error(
        "Expected an authentication link in the private test mailbox."
      )
    return match[0]
  }

  it("requires verification, authenticates a cookie request, resets a password once, and revokes sessions", async () => {
    const account = {
      email: "flow@example.test",
      password: "first-password-123",
      name: "Flow test",
    }
    expect((await post("/sign-up/email", account)).status).toBe(200)
    expect((await post("/sign-in/email", account)).status).toBe(403)
    const email = mailbox.find(
      (entry) => entry.to === account.email && entry.kind === "verify-email"
    )!
    const verification = await auth.handler(new Request(emailLink(email)))
    expect(verification.status).toBe(302)
    expect(verification.headers.get("location")).not.toContain("error=")
    const signIn = await post("/sign-in/email", account)
    expect(signIn.status).toBe(200)
    const cookie = cookieFrom(signIn)
    expect(cookie).toContain("elc.session_token=")

    const app = new Hono<{ Bindings: Bindings }>().get(
      "/protected",
      async (context) => {
        const session = await requireVerifiedSession(context, { sendEmail })
        return context.json({
          userId: session.user.id,
          email: session.user.email,
        })
      }
    )
    expect((await app.request("/protected", undefined, env)).status).toBe(401)
    // Expo's application API client forwards this Cookie header from SecureStore.
    const permitted = await app.request(
      "/protected",
      { headers: { Cookie: cookie } },
      env
    )
    expect(permitted.status).toBe(200)
    expect(await permitted.json()).toMatchObject({ email: account.email })

    expect(
      (
        await post("/request-password-reset", {
          email: account.email,
          redirectTo: `${origin}/reset-password`,
        })
      ).status
    ).toBe(200)
    const reset = mailbox.findLast(
      (entry) => entry.to === account.email && entry.kind === "reset-password"
    )!
    const callback = await auth.handler(new Request(emailLink(reset)))
    expect(callback.status).toBe(302)
    const token = new URL(callback.headers.get("location")!).searchParams.get(
      "token"
    )
    const newPassword = "replacement-password-123"
    expect((await post("/reset-password", { token, newPassword })).status).toBe(
      200
    )
    expect((await post("/reset-password", { token, newPassword })).status).toBe(
      400
    )
    expect(
      (await app.request("/protected", { headers: { Cookie: cookie } }, env))
        .status
    ).toBe(401)
    expect((await post("/sign-in/email", account)).status).toBe(401)
    const newSignIn = await post("/sign-in/email", {
      ...account,
      password: newPassword,
    })
    expect(newSignIn.status).toBe(200)
    const newCookie = cookieFrom(newSignIn)
    await env.DB.prepare("UPDATE user SET email_verified = 0 WHERE email = ?")
      .bind(account.email)
      .run()
    expect(
      (await app.request("/protected", { headers: { Cookie: newCookie } }, env))
        .status
    ).toBe(403)
    expect((await post("/sign-out", {}, { cookie: newCookie })).status).toBe(
      200
    )
    expect(
      (await app.request("/protected", { headers: { Cookie: newCookie } }, env))
        .status
    ).toBe(401)
    const storedPassword = await env.DB.prepare(
      "SELECT password FROM account WHERE user_id = (SELECT id FROM user WHERE email = ?)"
    )
      .bind(account.email)
      .first<{ password: string }>()
    expect(storedPassword?.password).not.toBe(newPassword)
  })

  it("rejects untrusted origins before creating an account", async () => {
    const email = "csrf@example.test"
    const response = await post(
      "/sign-up/email",
      { email, name: "CSRF test", password: "password-12345" },
      {
        origin: "https://untrusted.example.test",
        ip: "192.0.2.2",
      }
    )
    expect(response.status).toBe(403)
    expect(
      await env.DB.prepare("SELECT id FROM user WHERE email = ?")
        .bind(email)
        .first()
    ).toBeNull()
  })

  it("reports unavailable email and Google configuration without creating accounts", async () => {
    const unavailable = createAuth(env)
    expect(getAuthCapabilities(env)).toEqual({
      emailAndPassword: true,
      emailDelivery: false,
      google: false,
    })
    const email = "unavailable@example.test"
    const response = await post(
      "/sign-up/email",
      { email, name: "Unavailable", password: "password-12345" },
      {
        instance: unavailable,
        ip: "192.0.2.3",
      }
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: "EMAIL_UNAVAILABLE" })
    expect(
      await env.DB.prepare("SELECT id FROM user WHERE email = ?")
        .bind(email)
        .first()
    ).toBeNull()
    const google = await post(
      "/sign-in/social",
      { provider: "google", callbackURL: `${origin}/account` },
      {
        instance: unavailable,
        ip: "192.0.2.3",
      }
    )
    expect(google.status).toBe(503)
    expect(await google.json()).toMatchObject({ code: "GOOGLE_UNAVAILABLE" })
  })

  it("builds Google's authorization request with the API callback and rejects an invalid callback state", async () => {
    const google = createAuth(
      {
        ...env,
        GOOGLE_CLIENT_ID: "test-client-id",
        GOOGLE_CLIENT_SECRET: "test-client-secret",
      },
      { sendEmail }
    )
    const start = await post(
      "/sign-in/social",
      { provider: "google", callbackURL: "elc://account" },
      {
        instance: google,
        ip: "192.0.2.4",
      }
    )
    expect(start.status).toBe(200)
    const { url } = (await start.json()) as { url: string }
    const authorizationURL = new URL(url)
    expect(authorizationURL.origin).toBe("https://accounts.google.com")
    expect(authorizationURL.searchParams.get("redirect_uri")).toBe(
      `${authOrigin}/api/auth/callback/google`
    )
    expect(authorizationURL.searchParams.get("state")).toBeTruthy()
    const invalidCallback = await google.handler(
      new Request(
        `${authOrigin}/api/auth/callback/google?code=invalid&state=invalid`
      )
    )
    expect(invalidCallback.status).toBe(302)
    expect(invalidCallback.headers.get("location")).toContain("error=")
    expect(invalidCallback.headers.getSetCookie().join(";")).not.toContain(
      "elc.session_token="
    )
  })

  it("caps concurrent password attempts using D1-backed rate limiting", async () => {
    const responses = await Promise.all(
      Array.from({ length: 14 }, () =>
        post(
          "/sign-in/email",
          {
            email: "rate-limit@example.test",
            password: "password-12345",
          },
          { ip: "192.0.2.5" }
        )
      )
    )
    expect(
      responses.filter((response) => response.status === 429)
    ).toHaveLength(4)
    expect(
      responses.filter((response) => response.status === 401)
    ).toHaveLength(10)
  })
})
