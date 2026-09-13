import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { createAuthTestDatabase } from "../auth/test-database"
import {
  EmailTransportError,
  freezeEmailRequest,
  type EmailAdapter,
  type EmailLookupResult,
  type EmailRequest,
} from "./email"
import {
  consumeEmailDelivery,
  deliveryDigest,
  dispatchEmailDeliveries,
  processEmailDelivery,
  type DeliveryDependencies,
  type DeliveryRow,
} from "./jobs"

describe("durable email delivery on D1 and private R2", () => {
  let database: Awaited<ReturnType<typeof createAuthTestDatabase>>
  let storage: Miniflare
  let db: D1Database
  let files: R2Bucket
  let now: number
  let dependencies: DeliveryDependencies
  let sent: EmailRequest[]
  let prepared: number
  let lookups: number
  let version: string
  const providerId = "e7d9b1cc-f70c-4a8e-b8b3-3b873b26c09b"
  const env = (environment: "local" | "preview" = "preview") => ({
    DB: db,
    FILES: files,
    ENVIRONMENT: environment,
  })
  const read = () =>
    db
      .prepare("SELECT * FROM email_deliveries WHERE id='delivery'")
      .first<DeliveryRow>()
  const due = async (advance = 60_000) => {
    now += advance
    await db
      .prepare(
        "UPDATE email_deliveries SET next_attempt_at=? WHERE id='delivery'"
      )
      .bind(now)
      .run()
  }
  beforeEach(async () => {
    database = await createAuthTestDatabase()
    db = database.DB
    storage = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script:
          "export default { fetch() { return new Response('delivery storage'); } }",
        compatibilityDate: "2026-09-12",
        r2Buckets: ["FILES"],
      })
    )
    files = (await storage.getR2Bucket("FILES")) as unknown as R2Bucket
    now = 1_800_000_000_000
    version = await deliveryDigest("canonical version")
    await db.batch([
      db
        .prepare(
          "INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES ('buyer','Buyer','buyer@example.test',1,?,?)"
        )
        .bind(now, now),
      db
        .prepare(
          "INSERT INTO outbox (id,kind,entity_id,payload_json,created_at,next_attempt_at) VALUES ('source','order.completed','order','{}',?,?),('email:delivery','email.send','delivery','{}',?,?)"
        )
        .bind(now, now, now, now),
      db
        .prepare(
          "INSERT INTO email_deliveries (id,source_id,kind,entity_id,recipient_id,metadata_json,pdf_state,created_at,updated_at,next_attempt_at) VALUES ('delivery','source','order.tickets','order','buyer','{}','pending',?,?,?)"
        )
        .bind(now, now, now),
    ])
    sent = []
    prepared = 0
    lookups = 0
    const adapter: EmailAdapter = {
      send: async (request) => {
        sent.push(structuredClone(request))
        return {
          provider: "resend",
          deliveryId: request.deliveryId,
          providerEmailId: providerId,
          status: "accepted",
        }
      },
      lookup: async (id, request) => {
        lookups++
        return {
          provider: "resend",
          deliveryId: request.deliveryId,
          providerEmailId: id,
          status: "delivered",
        }
      },
    }
    dependencies = {
      adapter,
      available: true,
      now: () => now,
      readCurrent: async () => ({ version, recipient: "buyer@example.test" }),
      prepare: async () => {
        prepared++
        return freezeEmailRequest({
          deliveryId: "delivery",
          idempotencyKey: "elc-email/delivery",
          from: "elc <demo@example.test>",
          to: "buyer@example.test",
          subject: "Your tickets",
          text: "This is an academic demonstration.",
          attachments: [
            {
              filename: "ticket.pdf",
              content: btoa("%PDF-1.7\nsynthetic test PDF"),
            },
          ],
        })
      },
    }
  })
  afterEach(async () => {
    await storage?.dispose()
    await database?.runtime.dispose()
  })

  it("claims concurrent queue deliveries once, separates PDFs from email acceptance, and only looks up accepted sends", async () => {
    await Promise.all([
      processEmailDelivery(env(), "delivery", dependencies),
      processEmailDelivery(env(), "delivery", dependencies),
    ])
    expect(sent).toHaveLength(1)
    expect(prepared).toBe(1)
    expect(await read()).toMatchObject({
      pdf_state: "ready",
      email_state: "accepted",
      provider_id: providerId,
      completed_at: null,
      attempts: 1,
    })
    await due()
    expect(
      await consumeEmailDelivery(env(), "email:delivery", dependencies)
    ).toBe(true)
    expect(sent).toHaveLength(1)
    expect(lookups).toBe(1)
    expect(await read()).toMatchObject({
      email_state: "delivered",
      completed_at: now,
    })
    await due()
    await consumeEmailDelivery(env(), "email:delivery", dependencies)
    expect(lookups).toBe(1)
    expect(
      (
        await db
          .prepare("SELECT completed_at FROM outbox WHERE id='email:delivery'")
          .first()
      )?.completed_at
    ).toBe(now - 60_000)
  })

  it("replays the exact frozen body and provider key after an uncertain send without rendering PDFs again", async () => {
    const original = dependencies.adapter.send.bind(dependencies.adapter)
    dependencies.adapter.send = async (request, context) => {
      await original(request, context)
      throw new EmailTransportError("NETWORK_UNCERTAIN", "uncertain")
    }
    await processEmailDelivery(env(), "delivery", dependencies)
    const first = await read()
    expect(first).toMatchObject({
      pdf_state: "ready",
      email_state: "pending",
      provider_id: null,
      first_attempt_at: now,
      attempts: 1,
    })
    dependencies.adapter.send = original
    await due()
    await processEmailDelivery(env(), "delivery", dependencies)
    expect(prepared).toBe(1)
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    expect(await read()).toMatchObject({
      first_attempt_at: first!.first_attempt_at,
      attempts: 2,
      email_state: "accepted",
    })
  })

  it("recovers a crash after provider acceptance and before its D1 receipt with the same payload", async () => {
    await db
      .prepare(
        "CREATE TRIGGER synthetic_crash BEFORE UPDATE OF provider_id ON email_deliveries WHEN NEW.provider_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'synthetic'); END"
      )
      .run()
    await processEmailDelivery(env(), "delivery", dependencies)
    expect(sent).toHaveLength(1)
    expect(await read()).toMatchObject({
      provider_id: null,
      email_state: "pending",
      pdf_state: "ready",
    })
    await db.prepare("DROP TRIGGER synthetic_crash").run()
    await due()
    await processEmailDelivery(env(), "delivery", dependencies)
    expect(sent).toHaveLength(2)
    expect(sent[0]).toEqual(sent[1])
    expect(prepared).toBe(1)
  })

  it.each(["access", "content"])(
    "rechecks %s after PDF preparation before the first external side effect",
    async (change) => {
      const prepare = dependencies.prepare
      dependencies.prepare = async (row, current) => {
        const request = await prepare(row, current)
        if (change === "access") dependencies.readCurrent = async () => null
        else version = await deliveryDigest("new canonical version")
        return request
      }
      await processEmailDelivery(env(), "delivery", dependencies)
      expect(sent).toHaveLength(0)
      expect((await read())?.first_attempt_at).toBeNull()
      expect((await read())?.email_state).toBe(
        change === "access" ? "suppressed" : "pending"
      )
    }
  )

  it("suppresses a changed destination after an ambiguous send instead of changing the frozen body", async () => {
    dependencies.adapter.send = async (request) => {
      sent.push(request)
      throw new EmailTransportError("NETWORK_UNCERTAIN", "uncertain")
    }
    await processEmailDelivery(env(), "delivery", dependencies)
    dependencies.readCurrent = async () => ({
      version,
      recipient: "changed@example.test",
    })
    await due()
    await processEmailDelivery(env(), "delivery", dependencies)
    expect(sent).toHaveLength(1)
    expect(await read()).toMatchObject({
      email_state: "suppressed",
      attempts: 1,
    })
  })

  it.each(["expired", "rollback"])(
    "stops an ambiguous send after the %s automatic retry boundary",
    async (boundary) => {
      dependencies.adapter.send = async (request) => {
        sent.push(request)
        throw new EmailTransportError("NETWORK_UNCERTAIN", "uncertain")
      }
      await processEmailDelivery(env(), "delivery", dependencies)
      await due(boundary === "expired" ? 23 * 3_600_000 : -1)
      await processEmailDelivery(env(), "delivery", dependencies)
      expect(sent).toHaveLength(1)
      expect(await read()).toMatchObject({
        email_state: "review_needed",
        attempts: 1,
      })
    }
  )

  it("does not start the retry window while credentials are unavailable", async () => {
    dependencies.available = false
    await processEmailDelivery(env(), "delivery", dependencies)
    expect(sent).toHaveLength(0)
    expect(prepared).toBe(0)
    expect(await read()).toMatchObject({
      first_attempt_at: null,
      attempts: 0,
      email_state: "pending",
    })
    dependencies.available = true
    await due(2 * 86_400_000)
    await processEmailDelivery(env(), "delivery", dependencies)
    expect(sent).toHaveLength(1)
    expect((await read())?.first_attempt_at).toBe(now)
  })

  it("writes local development mail and completion atomically, never calling the adapter", async () => {
    dependencies.available = false
    await db
      .prepare(
        "CREATE TRIGGER synthetic_mail_crash BEFORE INSERT ON development_mail BEGIN SELECT RAISE(ABORT,'synthetic'); END"
      )
      .run()
    await processEmailDelivery(env("local"), "delivery", dependencies)
    expect((await read())?.email_state).toBe("pending")
    expect(
      (await db.prepare("SELECT count(*) count FROM development_mail").first())
        ?.count
    ).toBe(0)
    await db.prepare("DROP TRIGGER synthetic_mail_crash").run()
    await due()
    await Promise.all([
      processEmailDelivery(env("local"), "delivery", dependencies),
      processEmailDelivery(env("local"), "delivery", dependencies),
    ])
    expect(sent).toHaveLength(0)
    expect(prepared).toBe(1)
    expect(await read()).toMatchObject({
      pdf_state: "ready",
      email_state: "delivered",
      provider_id: "local:delivery",
    })
    expect(
      (await db.prepare("SELECT count(*) count FROM development_mail").first())
        ?.count
    ).toBe(1)
  })

  it("rejects a corrupt frozen R2 payload without external side effects", async () => {
    dependencies.adapter.send = async () => {
      throw new EmailTransportError("NETWORK_UNCERTAIN", "uncertain")
    }
    await processEmailDelivery(env(), "delivery", dependencies)
    await files.put((await read())!.payload_key!, "tampered")
    await due()
    await processEmailDelivery(env(), "delivery", dependencies)
    expect(await read()).toMatchObject({
      email_state: "review_needed",
      attempts: 1,
    })
    expect(prepared).toBe(1)
  })

  it("prevents an expired worker lease from committing a late PDF or sending email", async () => {
    let resume!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const pause = new Promise<void>((resolve) => {
      resume = resolve
    })
    const prepare = dependencies.prepare
    let first = true
    dependencies.prepare = async (row, current) => {
      const result = await prepare(row, current)
      if (first) {
        first = false
        entered()
        await pause
      }
      return result
    }
    const stale = processEmailDelivery(env(), "delivery", dependencies)
    await started
    await due(181_000)
    await processEmailDelivery(env(), "delivery", dependencies)
    resume()
    await stale
    expect(sent).toHaveLength(1)
    expect(await read()).toMatchObject({ email_state: "accepted", attempts: 1 })
  })

  it("retains unpublished jobs after a queue failure and lets a published job run immediately", async () => {
    const published: string[] = []
    let failing = true
    const queue = {
      send: async (body: { id: string }) => {
        if (failing) throw new Error("synthetic")
        published.push(body.id)
      },
    } as unknown as Queue<{ id: string }>
    await dispatchEmailDeliveries({ DB: db, DELIVERY: queue }, now)
    expect(published).toHaveLength(0)
    failing = false
    await dispatchEmailDeliveries({ DB: db, DELIVERY: queue }, now)
    expect(published).toEqual(["email:delivery"])
    await consumeEmailDelivery(env(), published[0]!, dependencies)
    expect(sent).toHaveLength(1)
  })

  it.each(["bounced", "failed", "delivery_delayed"] as const)(
    "tracks provider %s without submitting another email",
    async (status) => {
      await processEmailDelivery(env(), "delivery", dependencies)
      dependencies.adapter.lookup = async () =>
        ({
          provider: "resend",
          deliveryId: "delivery",
          providerEmailId: providerId,
          status,
        }) satisfies EmailLookupResult
      await due()
      await processEmailDelivery(env(), "delivery", dependencies)
      expect(sent).toHaveLength(1)
      expect((await read())?.email_state).toBe(
        status === "delivery_delayed" ? "accepted" : status
      )
    }
  )

  it("rejects delivery identity, frozen request and provider receipt edits at the database boundary", async () => {
    await processEmailDelivery(env(), "delivery", dependencies)
    for (const update of [
      "entity_id='other'",
      "recipient_id='other'",
      "metadata_json='[]'",
      "payload_key='different'",
      "first_attempt_at=1",
      "provider_id='different'",
    ])
      await expect(
        db
          .prepare(`UPDATE email_deliveries SET ${update} WHERE id='delivery'`)
          .run()
      ).rejects.toThrow(/email_delivery_(identity|payload|provider)_immutable/)
    expect(await consumeEmailDelivery(env(), "source", dependencies)).toBe(
      false
    )
  })

  it("retains a failed PDF job for review without changing any canonical ticket or sending mail", async () => {
    dependencies.prepare = async () => {
      throw new EmailTransportError("INVALID_REQUEST", "permanent")
    }
    await processEmailDelivery(env(), "delivery", dependencies)
    expect(sent).toHaveLength(0)
    expect(await read()).toMatchObject({
      pdf_state: "failed",
      email_state: "failed",
      first_attempt_at: null,
    })
    expect(
      (await db.prepare("SELECT count(*) count FROM tickets").first())?.count
    ).toBe(0)
  })
})
