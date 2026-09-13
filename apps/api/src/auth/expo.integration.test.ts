import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test"
import { createAuth, type AuthEmail } from "./index"
import { createAuthTestDatabase } from "./test-database"

describe("Expo authentication headers on D1", () => {
  let fixture: Awaited<ReturnType<typeof createAuthTestDatabase>>
  let auth: ReturnType<typeof createAuth>
  const mailbox: AuthEmail[] = []
  const origin = "http://localhost:8787"
  beforeAll(async () => {
    fixture = await createAuthTestDatabase()
    auth = createAuth(
      {
        DB: fixture.DB,
        APP_ORIGIN: "http://localhost:5173",
        AUTH_URL: origin,
        AUTH_SECRET: "test-only-auth-secret-with-more-than-32-characters",
        EMAIL_FROM: "elc <noreply@example.test>",
        ENVIRONMENT: "local",
      },
      {
        sendEmail: async (email) => {
          mailbox.push(email)
        },
      }
    )
  })
  afterAll(async () => {
    await fixture?.runtime.dispose()
  })
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = { "expo-origin": "elc://" }
  ) =>
    auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "192.0.2.90",
          ...headers,
        },
        body: JSON.stringify(body),
      })
    )

  it("accepts the native origin, verifies the account, and forwards a revocable cookie session", async () => {
    const account = {
      email: "native@example.test",
      name: "Native fixture",
      password: "fixture-password-123",
    }
    expect((await post("/sign-up/email", account)).status).toBe(200)
    expect((await post("/sign-in/email", account)).status).toBe(403)
    const url = mailbox[0]!.text.match(/https?:\/\/[^\s]+/)![0]
    expect((await auth.handler(new Request(url))).status).toBe(302)
    const signIn = await post("/sign-in/email", account)
    expect(signIn.status).toBe(200)
    const cookie = signIn.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ")
    expect(cookie).toContain("elc.session_token=")
    const session = await auth.handler(
      new Request(`${origin}/api/auth/get-session`, {
        headers: { Cookie: cookie, "expo-origin": "elc://" },
      })
    )
    expect(session.status).toBe(200)
    expect(await session.json()).toMatchObject({
      user: { email: account.email, emailVerified: true },
    })
    expect(
      (await post("/sign-out", {}, { Cookie: cookie, "expo-origin": "elc://" }))
        .status
    ).toBe(200)
    const after = await auth.handler(
      new Request(`${origin}/api/auth/get-session`, {
        headers: { Cookie: cookie, "expo-origin": "elc://" },
      })
    )
    expect(await after.json()).toBeNull()
  })

  it("rejects an untrusted native origin and never overrides an existing browser origin", async () => {
    const deniedHeaders: Record<string, string>[] = [
      { "expo-origin": "unknown://" },
      { "expo-origin": "elc://", Origin: "https://untrusted.example.test" },
    ]
    for (const headers of deniedHeaders) {
      expect(
        (
          await post(
            "/sign-up/email",
            {
              email: "denied@example.test",
              name: "Denied",
              password: "fixture-password-123",
            },
            headers
          )
        ).status
      ).toBe(403)
    }
    expect(
      await fixture.DB.prepare(
        "SELECT id FROM user WHERE email = 'denied@example.test'"
      ).first()
    ).toBeNull()
  })
})
