import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { signJWT } from "better-auth/crypto"
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test"
import { createAuthTestDatabase } from "./test-database"
import { createAuth } from "./index"
import { verificationEmail, resetPasswordEmail } from "./email"
import {
  cleanupAuthEmailIntents,
  createAuthDeliverySources,
  durableAuthDependencies,
  enqueueAuthEmail,
} from "./delivery"
import {
  consumeEmailDelivery,
  processEmailDelivery,
  type DeliveryRow,
} from "../delivery/jobs"
import {
  EmailTransportError,
  type EmailAdapter,
  type EmailRequest,
} from "../delivery/email"
import type { Bindings } from "../env"

describe("durable authentication mail on D1 and R2", () => {
  let database: Awaited<ReturnType<typeof createAuthTestDatabase>>
  let storage: Miniflare
  let env: Bindings
  let now: number
  let userId: string
  let to: string
  let sent: EmailRequest[]
  let adapter: EmailAdapter
  const providerId = "e7d9b1cc-f70c-4a8e-b8b3-3b873b26c09b"
  beforeAll(async () => {
    database = await createAuthTestDatabase()
    storage = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script:
          "export default { fetch() { return new Response('auth mail storage') } }",
        compatibilityDate: "2026-09-12",
        r2Buckets: ["FILES"],
      })
    )
    env = {
      DB: database.DB,
      FILES: await storage.getR2Bucket("FILES"),
      APP_ORIGIN: "http://localhost:5173",
      AUTH_SECRET: "test-only-auth-secret-with-more-than-32-characters",
      EMAIL_FROM: "elc <noreply@example.test>",
      ENVIRONMENT: "preview",
      RESEND_API_KEY: "test-key",
      DELIVERY: {
        send: async () => {
          throw new Error("Queue temporarily unavailable")
        },
      },
    } as unknown as Bindings
  })
  afterAll(async () => {
    await storage?.dispose()
    await database?.runtime.dispose()
  })
  beforeEach(async () => {
    now = Date.now()
    userId = crypto.randomUUID()
    to = `${userId}@example.test`
    await env.DB.prepare(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES (?,'Auth mail',?,0,?,?)"
    )
      .bind(userId, to, now, now)
      .run()
    sent = []
    adapter = {
      send: async (request) => {
        sent.push(structuredClone(request))
        return {
          provider: "resend",
          deliveryId: request.deliveryId,
          providerEmailId: providerId,
          status: "accepted",
        }
      },
      lookup: async (id, request) => ({
        provider: "resend",
        deliveryId: request.deliveryId,
        providerEmailId: id,
        status: "delivered",
      }),
    }
  })
  const row = (id: string) =>
    env.DB.prepare("SELECT * FROM email_deliveries WHERE id=?")
      .bind(id)
      .first<DeliveryRow>()
  const options = () => ({ now: () => now })
  const deps = () => ({
    ...createAuthDeliverySources(env, options()),
    ...options(),
    adapter,
    available: true,
  })
  const verify = async () =>
    verificationEmail(
      to,
      `${env.APP_ORIGIN}/api/auth/verify-email?token=${await signJWT({ email: to }, env.AUTH_SECRET, 3600)}&callbackURL=%2Faccount`,
      "ru"
    )
  const reset = async () => {
    const token = crypto.randomUUID()
    await env.DB.prepare(
      "INSERT INTO verification(id,identifier,value,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?)"
    )
      .bind(
        crypto.randomUUID(),
        `reset-password:${token}`,
        userId,
        now + 3600000,
        now,
        now
      )
      .run()
    return resetPasswordEmail(
      to,
      `${env.APP_ORIGIN}/api/auth/reset-password/${token}?callbackURL=%2Freset-password`,
      "en"
    )
  }
  const due = async (id: string, advance = 60000) => {
    now += advance
    await env.DB.prepare(
      "UPDATE email_deliveries SET next_attempt_at=? WHERE id=?"
    )
      .bind(now, id)
      .run()
  }

  it("commits one encrypted intent and delivery despite concurrent publication failures", async () => {
    const email = await verify()
    const ids = await Promise.all([
      enqueueAuthEmail(env, email, options()),
      enqueueAuthEmail(env, email, options()),
    ])
    expect(ids[0]).toBe(ids[1])
    const stored = await env.DB.prepare(
      "SELECT * FROM auth_email_intents WHERE delivery_id=?"
    )
      .bind(ids[0])
      .first<{ encrypted_payload: string }>()
    expect(stored?.encrypted_payload).toMatch(/^[a-f0-9]+$/)
    expect(JSON.stringify(stored)).not.toContain(email.text)
    expect(JSON.stringify(stored)).not.toContain(to)
    expect(await row(ids[0]!)).toMatchObject({
      email_state: "pending",
      metadata_json: "{}",
      attempts: 0,
    })
    expect(
      (
        await env.DB.prepare(
          "SELECT count(*) n FROM email_deliveries WHERE recipient_id=?"
        )
          .bind(userId)
          .first<{ n: number }>()
      )?.n
    ).toBe(1)
    expect(await consumeEmailDelivery(env, `email:${ids[0]}`, deps())).toBe(
      true
    )
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      to,
      subject: email.subject,
      text: email.text,
    })
  })

  it("retries an uncertain send with exactly the frozen request and idempotency key", async () => {
    const id = (await enqueueAuthEmail(env, await reset(), options()))!
    const send = adapter.send.bind(adapter)
    adapter.send = async (request) => {
      sent.push(structuredClone(request))
      throw new EmailTransportError("NETWORK_UNCERTAIN", "uncertain")
    }
    await processEmailDelivery(env, id, deps())
    expect(await row(id)).toMatchObject({ email_state: "pending", attempts: 1 })
    await due(id)
    adapter.send = send
    await processEmailDelivery(env, id, deps())
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    expect(await row(id)).toMatchObject({
      email_state: "accepted",
      attempts: 2,
    })
  })

  it("never retries an expired authentication link and clears its encrypted intent", async () => {
    const id = (await enqueueAuthEmail(env, await reset(), options()))!
    adapter.send = async (request) => {
      sent.push(request)
      throw new EmailTransportError("NETWORK_UNCERTAIN", "uncertain")
    }
    await processEmailDelivery(env, id, deps())
    await due(id, 3600000)
    await processEmailDelivery(env, id, deps())
    expect(sent).toHaveLength(1)
    expect(await row(id)).toMatchObject({ email_state: "suppressed" })
    await cleanupAuthEmailIntents(env, now)
    expect(
      await env.DB.prepare(
        "SELECT encrypted_payload FROM auth_email_intents WHERE delivery_id=?"
      )
        .bind(id)
        .first()
    ).toEqual({ encrypted_payload: null })
    await expect(
      env.DB.prepare(
        "UPDATE auth_email_intents SET encrypted_payload='revived' WHERE delivery_id=?"
      )
        .bind(id)
        .run()
    ).rejects.toThrow()
    await expect(
      env.DB.prepare(
        "UPDATE auth_email_intents SET expires_at=expires_at+1 WHERE delivery_id=?"
      )
        .bind(id)
        .run()
    ).rejects.toThrow()
  })

  it("suppresses a reset whose token was consumed before dispatch", async () => {
    const id = (await enqueueAuthEmail(env, await reset(), options()))!
    await env.DB.prepare("DELETE FROM verification WHERE value=?")
      .bind(userId)
      .run()
    await processEmailDelivery(env, id, deps())
    expect(sent).toHaveLength(0)
    expect(await row(id)).toMatchObject({ email_state: "suppressed" })
  })

  it("suppresses a verification email once the account has been verified", async () => {
    const id = (await enqueueAuthEmail(env, await verify(), options()))!
    await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?")
      .bind(userId)
      .run()
    await processEmailDelivery(env, id, deps())
    expect(sent).toHaveLength(0)
    expect(await row(id)).toMatchObject({ email_state: "suppressed" })
  })

  it("rechecks suspension after preparing the payload and before any provider send", async () => {
    const id = (await enqueueAuthEmail(env, await reset(), options()))!
    const dependencies = deps()
    const prepare = dependencies.prepare
    dependencies.prepare = async (r, c) => {
      const request = await prepare(r, c)
      await env.DB.prepare(
        "INSERT INTO profiles(user_id,suspended_at,updated_at) VALUES (?,?,?)"
      )
        .bind(userId, now, now)
        .run()
      return request
    }
    await processEmailDelivery(env, id, dependencies)
    expect(sent).toHaveLength(0)
    expect(await row(id)).toMatchObject({
      email_state: "suppressed",
      first_attempt_at: null,
    })
  })

  it("expires queued auth mail even when delivery configuration remains unavailable", async () => {
    const id = (await enqueueAuthEmail(env, await reset(), options()))!
    await processEmailDelivery(env, id, { ...deps(), available: false })
    now += 3600000
    await cleanupAuthEmailIntents(env, now)
    expect(await row(id)).toMatchObject({
      email_state: "suppressed",
      attempts: 0,
      completed_at: now,
    })
    expect(
      await env.DB.prepare("SELECT completed_at FROM outbox WHERE id=?")
        .bind(`email:${id}`)
        .first()
    ).toEqual({ completed_at: now })
    expect(sent).toHaveLength(0)
  })

  it("reconciles an accepted provider ID after expiry without sending again", async () => {
    const id = (await enqueueAuthEmail(env, await reset(), options()))!
    await processEmailDelivery(env, id, deps())
    await due(id, 3600000)
    await cleanupAuthEmailIntents(env, now)
    const lookup = vi.fn(adapter.lookup.bind(adapter))
    adapter.lookup = lookup
    await processEmailDelivery(env, id, deps())
    expect(sent).toHaveLength(1)
    expect(lookup).toHaveBeenCalledOnce()
    expect(await row(id)).toMatchObject({
      email_state: "delivered",
      provider_id: providerId,
    })
  })

  it("rejects foreign links, forged JWTs and reset tokens for another account", async () => {
    const email = await verify()
    expect(
      await enqueueAuthEmail(
        env,
        {
          ...email,
          text: email.text.replace(
            env.APP_ORIGIN,
            "https://foreign.example.test"
          ),
        },
        options()
      )
    ).toBeNull()
    expect(
      await enqueueAuthEmail(
        env,
        verificationEmail(
          to,
          `${env.APP_ORIGIN}/api/auth/verify-email?token=forged`
        ),
        options()
      )
    ).toBeNull()
    const other = await reset()
    await env.DB.prepare(
      "UPDATE verification SET value='another-user' WHERE value=?"
    )
      .bind(userId)
      .run()
    expect(await enqueueAuthEmail(env, other, options())).toBeNull()
    expect(
      (
        await env.DB.prepare(
          "SELECT count(*) n FROM email_deliveries WHERE recipient_id=?"
        )
          .bind(userId)
          .first<{ n: number }>()
      )?.n
    ).toBe(0)
  })

  it("fails closed on rotated encryption keys and never exposes token material in errors", async () => {
    const id = (await enqueueAuthEmail(env, await verify(), options()))!
    await processEmailDelivery(env, id, {
      ...deps(),
      ...createAuthDeliverySources(
        {
          ...env,
          AUTH_SECRET: "replacement-test-key-with-more-than-32-characters",
        },
        options()
      ),
    })
    expect(sent).toHaveLength(0)
    expect(await row(id)).toMatchObject({ email_state: "suppressed" })
    await expect(
      durableAuthDependencies(env).sendEmail!({
        kind: "verify-email",
        to,
        subject: "bad",
        text: "http://[",
      })
    ).rejects.toMatchObject({ code: "EMAIL_DELIVERY_FAILED" })
  })

  it("completes real Better Auth registration and reset locally without calling a provider", async () => {
    const localEnv = { ...env, ENVIRONMENT: "local" as const }
    const auth = createAuth(localEnv, durableAuthDependencies(localEnv))
    const account = {
      email: `flow-${userId}@example.test`,
      name: "Durable auth flow",
      password: "first-password-123",
    }
    const post = (path: string, body: unknown) =>
      auth.handler(
        new Request(`${env.APP_ORIGIN}/api/auth${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: env.APP_ORIGIN,
            "CF-Connecting-IP": "192.0.2.151",
            "Accept-Language": "ru",
          },
          body: JSON.stringify(body),
        })
      )
    expect((await post("/sign-up/email", account)).status).toBe(200)
    const mail = async (kind: string) =>
      env.DB.prepare(
        "SELECT body,subject FROM development_mail WHERE recipient=? AND kind=? ORDER BY created_at DESC LIMIT 1"
      )
        .bind(account.email, kind)
        .first<{ body: string; subject: string }>()
    const verification = (await mail("verify-email"))!
    expect(verification.subject).toBe("Подтвердите учётную запись elc")
    expect(
      (
        await auth.handler(
          new Request(verification.body.match(/https?:\/\/[^\s]+/)![0])
        )
      ).status
    ).toBe(302)
    expect((await post("/sign-in/email", account)).status).toBe(200)
    expect(
      await env.DB.prepare(
        "SELECT a.last_sign_in_at FROM account_activity a JOIN user u ON u.id=a.user_id WHERE u.email=?"
      )
        .bind(account.email)
        .first()
    ).not.toBeNull()
    expect(
      await env.DB.prepare(
        "SELECT p.user_id FROM profiles p JOIN user u ON u.id=p.user_id WHERE u.email=?"
      )
        .bind(account.email)
        .first()
    ).toBeNull()
    expect(
      (
        await post("/request-password-reset", {
          email: account.email,
          redirectTo: `${env.APP_ORIGIN}/reset-password`,
        })
      ).status
    ).toBe(200)
    const resetMail = (await mail("reset-password"))!
    const callback = await auth.handler(
      new Request(resetMail.body.match(/https?:\/\/[^\s]+/)![0])
    )
    const token = new URL(callback.headers.get("Location")!).searchParams.get(
      "token"
    )
    expect(
      (
        await post("/reset-password", {
          token,
          newPassword: "replacement-password-123",
        })
      ).status
    ).toBe(200)
    expect(
      (
        await post("/reset-password", {
          token,
          newPassword: "replacement-password-123",
        })
      ).status
    ).toBe(400)
    expect(
      (
        await env.DB.prepare(
          "SELECT count(*) n FROM email_deliveries d JOIN user u ON u.id=d.recipient_id WHERE u.email=? AND d.email_state='delivered' AND d.provider_id LIKE 'local:%'"
        )
          .bind(account.email)
          .first<{ n: number }>()
      )?.n
    ).toBe(2)
  })
})
