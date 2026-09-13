import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { createAuthTestDatabase } from "../auth/test-database"
import {
  createResendEmailAdapter,
  EmailTransportError,
  freezeEmailRequest,
} from "./email"
import {
  deliveryDigest,
  processEmailDelivery,
  type DeliveryDependencies,
  type DeliveryRow,
} from "./jobs"
import { cleanupDeliveryPayloads } from "./payload-cleanup"

const hour = 3_600_000
const day = 24 * hour
function gate() {
  let open!: () => void
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

/** Run real D1 statements, delaying only a committed result's return to one worker. */
function delaySendPermit(
  db: D1Database,
  entered: ReturnType<typeof gate>,
  resume: ReturnType<typeof gate>
) {
  let delayed = false
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>()
  function statement(native: D1PreparedStatement): D1PreparedStatement {
    const wrapped = new Proxy(native, {
      get(target, property) {
        if (property === "bind")
          return (...values: unknown[]) => statement(target.bind(...values))
        if (property === "first")
          return async (...args: Parameters<D1PreparedStatement["first"]>) => {
            const result = await target.first(...args)
            if (
              !delayed &&
              result &&
              typeof result === "object" &&
              "attempts" in result &&
              result.attempts === 1 &&
              "email_state" in result &&
              result.email_state === "pending"
            ) {
              delayed = true
              entered.open()
              await resume.promise
            }
            return result
          }
        const value = Reflect.get(target, property)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    originals.set(wrapped, native)
    return wrapped
  }
  return new Proxy(db, {
    get(target, property) {
      if (property === "prepare")
        return (sql: string) => statement(target.prepare(sql))
      if (property === "batch")
        return (statements: D1PreparedStatement[]) =>
          target.batch(statements.map((value) => originals.get(value) ?? value))
      const value = Reflect.get(target, property)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

describe("delivery review regressions with real D1 and R2", () => {
  let database: Awaited<ReturnType<typeof createAuthTestDatabase>>
  let storage: Miniflare
  let db: D1Database
  let files: R2Bucket
  let now: number
  let version: string
  let dependencies: DeliveryDependencies
  let calls: { method: string; body: string; key: string | null }[]
  let provider: (method: string) => Promise<Response>
  const providerId = "9ab1a01a-a87c-4202-ae61-69f3f9ce790e"
  const env = (DB = db, FILES = files) => ({
    DB,
    FILES,
    ENVIRONMENT: "preview" as const,
  })
  const read = () =>
    db
      .prepare("SELECT * FROM email_deliveries WHERE id='review'")
      .first<DeliveryRow>()
  const outbox = () =>
    db
      .prepare("SELECT completed_at FROM outbox WHERE id='email:review'")
      .first<{ completed_at: number | null }>()
  const due = (milliseconds = 60_000) => {
    now += milliseconds
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  function interceptPut(
    action: (key: string, put: () => Promise<unknown>) => Promise<unknown>
  ): R2Bucket {
    return new Proxy(files, {
      get(target, property) {
        if (property === "put")
          return (...args: Parameters<R2Bucket["put"]>) =>
            action(args[0], () => target.put(...args))
        const value = Reflect.get(target, property)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
  }
  beforeEach(async () => {
    database = await createAuthTestDatabase()
    db = database.DB
    storage = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script:
          "export default {fetch(){return new Response('review storage')}}",
        compatibilityDate: "2026-09-12",
        r2Buckets: ["FILES"],
      })
    )
    files = (await storage.getR2Bucket("FILES")) as unknown as R2Bucket
    now = 1_800_000_000_000
    version = await deliveryDigest("original canonical content")
    await db.batch([
      db
        .prepare(
          "INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES ('buyer','Synthetic buyer','buyer@example.test',1,?,?)"
        )
        .bind(now, now),
      db
        .prepare(
          "INSERT INTO outbox (id,kind,entity_id,payload_json,created_at,next_attempt_at) VALUES ('source','order.completed','order','{}',?,?),('email:review','email.send','review','{}',?,?)"
        )
        .bind(now, now, now, now),
      db
        .prepare(
          "INSERT INTO email_deliveries (id,source_id,kind,entity_id,recipient_id,metadata_json,pdf_state,created_at,updated_at,next_attempt_at) VALUES ('review','source','order.tickets','order','buyer','{}','pending',?,?,?)"
        )
        .bind(now, now, now),
    ])
    calls = []
    provider = async (method) =>
      method === "POST"
        ? json({ id: providerId })
        : json({
            id: providerId,
            from: "elc <demo@example.test>",
            to: ["buyer@example.test"],
            last_event: "delivered",
          })
    dependencies = {
      available: true,
      now: () => now,
      adapter: createResendEmailAdapter(
        { apiKey: "re_synthetic" },
        {
          now: () => now,
          fetch: async (_input, init) => {
            const method = init?.method ?? "GET"
            const body = init?.body ?? ""
            if (typeof body !== "string")
              throw new Error("Expected a serialized provider request")
            calls.push({
              method,
              body,
              key: new Headers(init?.headers).get("Idempotency-Key"),
            })
            return provider(method)
          },
        }
      ),
      readCurrent: async () => {
        const account = await db
          .prepare(
            "SELECT email FROM user WHERE id='buyer' AND email_verified=1"
          )
          .first<{ email: string }>()
        return account ? { version, recipient: account.email } : null
      },
      prepare: async () =>
        freezeEmailRequest({
          deliveryId: "review",
          idempotencyKey: "elc-email/review",
          from: "elc <demo@example.test>",
          to: "buyer@example.test",
          subject: "Synthetic ticket delivery",
          text: "Synthetic delivery review. No real event or admission credential.",
          attachments: [
            {
              filename: "ticket.pdf",
              content: btoa("%PDF-1.7\nsynthetic review payload"),
            },
          ],
        }),
    }
  })
  afterEach(async () => {
    await storage?.dispose()
    await database?.runtime.dispose()
  })

  it("preserves a known provider receipt when a later lookup is forbidden", async () => {
    await processEmailDelivery(env(), "review", dependencies)
    expect(await read()).toMatchObject({
      email_state: "accepted",
      provider_id: providerId,
    })
    provider = async () => json({ name: "forbidden" }, 403)
    due()
    await processEmailDelivery(env(), "review", dependencies)
    expect(calls.map((call) => call.method)).toEqual(["POST", "GET"])
    expect(await read()).toMatchObject({
      email_state: "review_needed",
      provider_id: providerId,
      provider_status: "accepted",
      attempts: 1,
    })
    expect((await outbox())?.completed_at).toBe(now)
  })

  it("does not turn an ambiguous POST into a definite failure after a later permanent rejection", async () => {
    provider = async () => {
      throw new TypeError("Synthetic lost provider response")
    }
    await processEmailDelivery(env(), "review", dependencies)
    expect(await read()).toMatchObject({
      email_state: "pending",
      provider_id: null,
      attempts: 1,
    })
    provider = async () => json({ name: "forbidden" }, 403)
    due()
    await processEmailDelivery(env(), "review", dependencies)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual(calls[0])
    expect(calls[0]?.key).toBe("elc-email/review")
    expect(await read()).toMatchObject({
      email_state: "review_needed",
      provider_id: null,
      attempts: 2,
    })
  })

  it("prevents a stale worker from sending after its committed permit expires and another worker suppresses it", async () => {
    const entered = gate(),
      resume = gate()
    const stale = processEmailDelivery(
      env(delaySendPermit(db, entered, resume)),
      "review",
      dependencies
    )
    await entered.promise
    try {
      expect(await read()).toMatchObject({
        email_state: "pending",
        attempts: 1,
        last_attempt_at: now,
      })
      due(30_001)
      await db
        .prepare("UPDATE user SET email_verified=0 WHERE id='buyer'")
        .run()
      await processEmailDelivery(env(), "review", dependencies)
      expect(await read()).toMatchObject({
        email_state: "suppressed",
        attempts: 1,
      })
    } finally {
      resume.open()
      await stale
    }
    expect(calls).toHaveLength(0)
    expect(await read()).toMatchObject({
      email_state: "suppressed",
      provider_id: null,
      attempts: 1,
    })
  })

  it("keeps PDF failure and outbox finalization recoverable when the terminal transition fails", async () => {
    dependencies.prepare = async () => {
      throw new EmailTransportError("INVALID_REQUEST", "permanent")
    }
    await db
      .prepare(
        "CREATE TRIGGER review_terminal_failure BEFORE UPDATE ON email_deliveries WHEN OLD.pdf_state='pending' AND NEW.pdf_state='failed' BEGIN SELECT RAISE(ABORT,'synthetic PDF finalization failure'); END"
      )
      .run()
    await expect(
      processEmailDelivery(env(), "review", dependencies)
    ).rejects.toThrow()
    expect(await read()).toMatchObject({
      pdf_state: "pending",
      email_state: "pending",
      completed_at: null,
      first_attempt_at: null,
    })
    expect((await outbox())?.completed_at).toBeNull()
    await db.prepare("DROP TRIGGER review_terminal_failure").run()
    due(181_000)
    await processEmailDelivery(env(), "review", dependencies)
    expect(await read()).toMatchObject({
      pdf_state: "failed",
      email_state: "failed",
      completed_at: now,
    })
    expect((await outbox())?.completed_at).toBe(now)
    expect(calls).toHaveLength(0)
  })

  it("sweeps an R2 write lost before pointer attachment without deleting the current unresolved payload", async () => {
    let abandonedKey = ""
    const lostResponse = interceptPut(async (key, put) => {
      abandonedKey = key
      expect(
        await db
          .prepare("SELECT key FROM delivery_payload_objects WHERE key=?")
          .bind(key)
          .first()
      ).not.toBeNull()
      await put()
      throw new TypeError("Synthetic response loss after stored R2 write")
    })
    await processEmailDelivery(env(db, lostResponse), "review", dependencies)
    expect((await read())?.payload_key).toBeNull()
    const abandonedBody = await (await files.get(abandonedKey))!.text()
    due()
    await processEmailDelivery(env(), "review", dependencies)
    const currentKey = (await read())!.payload_key!
    expect(currentKey).not.toBe(abandonedKey)
    due(day)
    await cleanupDeliveryPayloads(env(), now)
    expect(await files.get(abandonedKey)).toBeNull()
    expect(await files.get(currentKey)).not.toBeNull()
    await files.put(abandonedKey, abandonedBody)
    due(hour)
    await cleanupDeliveryPayloads(env(), now)
    expect(await files.get(abandonedKey)).toBeNull()
    expect(await files.get(currentKey)).not.toBeNull()
    expect(await read()).toMatchObject({
      email_state: "accepted",
      provider_id: providerId,
      payload_key: currentKey,
    })
  })

  it("deletes a stale worker's late R2 write after an earlier sweep while preserving the replacement payload", async () => {
    const entered = gate(),
      resume = gate()
    let abandonedKey = ""
    const delayedPut = interceptPut(async (key, put) => {
      abandonedKey = key
      entered.open()
      await resume.promise
      return put()
    })
    const stale = processEmailDelivery(
      env(db, delayedPut),
      "review",
      dependencies
    )
    await entered.promise
    let currentKey = ""
    try {
      due(181_000)
      await processEmailDelivery(env(), "review", dependencies)
      currentKey = (await read())!.payload_key!
      expect(currentKey).not.toBe(abandonedKey)
      due(day)
      await cleanupDeliveryPayloads(env(), now)
      expect(await files.get(abandonedKey)).toBeNull()
    } finally {
      resume.open()
      await stale
    }
    expect(await files.get(abandonedKey)).not.toBeNull()
    expect((await read())?.payload_key).toBe(currentKey)
    due(hour)
    await cleanupDeliveryPayloads(env(), now)
    expect(await files.get(abandonedKey)).toBeNull()
    expect(await files.get(currentKey)).not.toBeNull()
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1)
  })

  it("removes superseded renders but retains the completed current payload for 30 days", async () => {
    const originalPrepare = dependencies.prepare
    let changed = false
    dependencies.prepare = async (row, current) => {
      const result = await originalPrepare(row, current)
      if (!changed) {
        changed = true
        version = await deliveryDigest("updated canonical content")
      }
      return result
    }
    await processEmailDelivery(env(), "review", dependencies)
    const oldKey = (await read())!.payload_key!
    expect(await read()).toMatchObject({
      email_state: "pending",
      first_attempt_at: null,
    })
    due()
    await processEmailDelivery(env(), "review", dependencies)
    const currentKey = (await read())!.payload_key!
    expect(currentKey).not.toBe(oldKey)
    due()
    await processEmailDelivery(env(), "review", dependencies)
    const completedAt = (await read())!.completed_at!
    due(day)
    await cleanupDeliveryPayloads(env(), now)
    expect(await files.get(oldKey)).toBeNull()
    expect(await files.get(currentKey)).not.toBeNull()
    now = completedAt + 30 * day - 1
    await cleanupDeliveryPayloads(env(), now)
    expect(await files.get(currentKey)).not.toBeNull()
    now++
    await cleanupDeliveryPayloads(env(), now)
    expect(await files.get(currentKey)).toBeNull()
    expect(await read()).toMatchObject({
      email_state: "delivered",
      provider_id: providerId,
      completed_at: completedAt,
    })
  })

  it("bounds one cleanup pass to 50 objects and leaves the remainder recoverable", async () => {
    for (let index = 0; index < 51; index++) {
      const body = `synthetic abandoned payload ${index}`,
        hash = await deliveryDigest(body),
        key = `private/email-deliveries/review/${hash}.json`
      await db
        .prepare(
          "INSERT INTO delivery_payload_objects (key,delivery_id,hash,delete_after,created_at) VALUES (?,'review',?,?,?)"
        )
        .bind(key, hash, now - 1, now - day)
        .run()
      await files.put(key, body)
    }
    expect(await cleanupDeliveryPayloads(env(), now)).toBe(50)
    expect((await files.list()).objects).toHaveLength(1)
    expect(await cleanupDeliveryPayloads(env(), now)).toBe(1)
    expect((await files.list()).objects).toHaveLength(0)
    expect(await read()).toMatchObject({
      email_state: "pending",
      first_attempt_at: null,
    })
  })
})
