import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import type { DeliveryRecoveryMode } from "@elc/shared"
import { createAuthTestDatabase } from "../auth/test-database"
import { createPaymentFixture } from "../payments/test-fixture"
import { processPayment } from "../payments/reconcile"
import { EmailTransportError, freezeEmailRequest } from "./email"
import {
  deliveryDigest,
  processEmailDelivery,
  type DeliveryDependencies,
  type DeliveryRow,
} from "./jobs"
import {
  listDeliveries,
  readDelivery,
  requestDeliveryRecovery,
} from "./recovery"

const hour = 3_600_000
const providerId = "9ab1a01a-a87c-4202-ae61-69f3f9ce790e"
type Row = DeliveryRow & { last_error: string | null }

async function seed(
  db: D1Database,
  now: number,
  id = "mail",
  changes: Partial<Row> = {}
) {
  const values = {
    id,
    source_id: `source-${id}`,
    kind: "order.tickets",
    entity_id: "synthetic-order",
    event_id: null,
    recipient_id: "buyer",
    metadata_json: JSON.stringify({
      secret: "private-recipient@example.test",
      body: "PRIVATE_BODY",
    }),
    pdf_state: "failed",
    email_state: "failed",
    payload_key: "PRIVATE_PAYLOAD_KEY",
    payload_hash: "e".repeat(64),
    provider_id: null,
    provider_status: null,
    first_attempt_at: null,
    last_attempt_at: null,
    attempts: 0,
    failures: 7,
    last_error: "PROVIDER_UNAVAILABLE",
    next_attempt_at: now - 1000,
    lease_token: null,
    lease_until: null,
    created_at: now - 10_000,
    updated_at: now - 1000,
    completed_at: now - 1000,
    ...changes,
  }
  await db.batch([
    db
      .prepare(
        `INSERT INTO email_deliveries (${Object.keys(values).join(",")}) VALUES (${Object.keys(
          values
        )
          .map(() => "?")
          .join(",")})`
      )
      .bind(...Object.values(values)),
    db
      .prepare(
        "INSERT INTO outbox (id,kind,entity_id,payload_json,created_at,next_attempt_at,dispatched_at,completed_at,attempts) VALUES (?,'email.send',?,'{}',?,?,?,?,11)"
      )
      .bind(
        `email:${id}`,
        id,
        now - 10_000,
        now - 1000,
        now - 9000,
        now - 1000
      ),
  ])
}

describe("operator delivery inspection and recovery with real D1", () => {
  let database: Awaited<ReturnType<typeof createAuthTestDatabase>>
  let storage: Miniflare | undefined
  let db: D1Database
  let now: number
  const options = () => ({ now: () => now })
  const row = (id = "mail") =>
    db
      .prepare("SELECT * FROM email_deliveries WHERE id=?")
      .bind(id)
      .first<Row>()
  const outbox = (id = "mail") =>
    db
      .prepare("SELECT * FROM outbox WHERE id=?")
      .bind(`email:${id}`)
      .first<Record<string, unknown>>()
  const count = (
    table: "request_receipts" | "audit_entries" | "email_deliveries" | "outbox"
  ) => db.prepare(`SELECT count(*) n FROM ${table}`).first<number>("n")
  async function input(
    mode: DeliveryRecoveryMode = "retry_preparation",
    requestId = "recover",
    id = "mail"
  ) {
    return {
      requestId,
      mode,
      reason: "Provider access was restored.",
      expectedUpdatedAt: new Date((await row(id))!.updated_at).toISOString(),
    }
  }
  const recover = async (
    mode: DeliveryRecoveryMode = "retry_preparation",
    requestId = "recover",
    id = "mail"
  ) =>
    requestDeliveryRecovery(
      db,
      "operator",
      id,
      await input(mode, requestId, id),
      options()
    )
  async function attempted(id = "mail", changes: Partial<Row> = {}) {
    await seed(db, now, id, {
      first_attempt_at: now - hour,
      last_attempt_at: now - 30_000,
      attempts: 5,
      pdf_state: "ready",
      email_state: "review_needed",
      ...changes,
    })
  }
  beforeEach(async () => {
    database = await createAuthTestDatabase()
    db = database.DB
    now = 1_800_000_000_000
    await db.batch([
      db
        .prepare(
          "INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES ('operator','Operator','operator@example.test',1,?,?),('buyer','Buyer','buyer@example.test',1,?,?),('moderator','Moderator','moderator@example.test',1,?,?)"
        )
        .bind(now, now, now, now, now, now),
      db
        .prepare(
          "INSERT INTO profiles (user_id,updated_at) VALUES ('operator',?)"
        )
        .bind(now),
      db
        .prepare(
          "INSERT INTO platform_grants (user_id,permission,granted_at) VALUES ('operator','platform:recover',?),('moderator','platform:moderate',?)"
        )
        .bind(now, now),
    ])
  })
  afterEach(async () => {
    await storage?.dispose()
    storage = undefined
    await database?.runtime.dispose()
  })

  it("requires a current verified active recovery grant for every operation and receipt replay", async () => {
    await seed(db, now)
    const request = await input()
    for (const actor of ["buyer", "moderator", "missing"]) {
      await expect(listDeliveries(db, actor)).rejects.toMatchObject({
        status: 403,
      })
      await expect(readDelivery(db, actor, "mail")).rejects.toMatchObject({
        status: 403,
      })
      await expect(
        requestDeliveryRecovery(db, actor, "mail", request, options())
      ).rejects.toMatchObject({ status: 403 })
    }
    await db
      .prepare("UPDATE user SET email_verified=0 WHERE id='operator'")
      .run()
    await expect(listDeliveries(db, "operator")).rejects.toMatchObject({
      status: 403,
    })
    await expect(
      requestDeliveryRecovery(db, "operator", "mail", request, options())
    ).rejects.toMatchObject({ status: 403 })
    await db
      .prepare("UPDATE user SET email_verified=1 WHERE id='operator'")
      .run()
    await db
      .prepare("UPDATE profiles SET suspended_at=? WHERE user_id='operator'")
      .bind(now)
      .run()
    await expect(readDelivery(db, "operator", "mail")).rejects.toMatchObject({
      status: 403,
    })
    await expect(
      requestDeliveryRecovery(db, "operator", "mail", request, options())
    ).rejects.toMatchObject({ status: 403 })
    await db
      .prepare("UPDATE profiles SET suspended_at=NULL WHERE user_id='operator'")
      .run()
    await requestDeliveryRecovery(db, "operator", "mail", request, options())
    await db
      .prepare("DELETE FROM platform_grants WHERE user_id='operator'")
      .run()
    await expect(
      requestDeliveryRecovery(db, "operator", "mail", request, options())
    ).rejects.toMatchObject({ status: 403 })
    expect(await count("request_receipts")).toBe(1)
  })

  it("pages bounded safe metadata without exposing recipient addresses or frozen payloads", async () => {
    for (let index = 0; index < 52; index++)
      await seed(db, now, `mail-${String(index).padStart(2, "0")}`, {
        email_state: index === 51 ? "suppressed" : "failed",
      })
    const first = await listDeliveries(
      db,
      "operator",
      { limit: "50" },
      options()
    )
    expect(first.items).toHaveLength(50)
    const second = await listDeliveries(
      db,
      "operator",
      { limit: 50, after: first.nextCursor },
      options()
    )
    expect(second.items.map((item) => item.id)).toEqual(["mail-50", "mail-51"])
    expect(second.nextCursor).toBeNull()
    const filtered = await listDeliveries(
      db,
      "operator",
      { emailState: "suppressed", kind: "order.tickets", pdfState: "failed" },
      options()
    )
    expect(filtered.items.map((item) => item.id)).toEqual(["mail-51"])
    const detail = await readDelivery(db, "operator", "mail-00", options())
    expect(detail.delivery).toEqual(first.items[0])
    const serialized = JSON.stringify({ first, second, detail })
    for (const secret of [
      "@example.test",
      "PRIVATE_BODY",
      "PRIVATE_PAYLOAD_KEY",
      "e".repeat(64),
      "metadata",
      "payload",
      "attachment",
    ])
      expect(serialized).not.toContain(secret)
    await expect(
      listDeliveries(db, "operator", { limit: 51 })
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      listDeliveries(db, "operator", { emailState: "anything" })
    ).rejects.toMatchObject({ status: 400 })
    await expect(readDelivery(db, "operator", "../mail")).rejects.toMatchObject(
      { status: 400 }
    )
    await expect(readDelivery(db, "operator", "missing")).rejects.toMatchObject(
      { status: 404 }
    )
  })

  it("seeks each single-filter page through its cursor index without sorting the matching history", async () => {
    await seed(db, now)
    const captured: { sql: string; values: unknown[] }[] = []
    const observed = new Proxy(db, {
      get(target, property) {
        if (property === "prepare")
          return (sql: string) => {
            const statement = target.prepare(sql)
            if (!sql.includes("FROM email_deliveries")) return statement
            return new Proxy(statement, {
              get(native, method) {
                if (method === "bind")
                  return (...values: unknown[]) => {
                    captured.push({ sql, values })
                    return native.bind(...values)
                  }
                const value = Reflect.get(native, method)
                return typeof value === "function" ? value.bind(native) : value
              },
            })
          }
        const value = Reflect.get(target, property)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    for (const [filter, index] of [
      [{ emailState: "failed" }, "email_delivery_state_cursor"],
      [{ eventId: "synthetic-event" }, "email_delivery_event_cursor"],
      [{ pdfState: "failed" }, "email_delivery_pdf_cursor"],
      [{ kind: "order.tickets" }, "email_delivery_kind_cursor"],
    ] as const) {
      captured.length = 0
      await listDeliveries(
        observed,
        "operator",
        { ...filter, after: "cursor", limit: 20 },
        options()
      )
      expect(captured).toHaveLength(1)
      const query = captured[0]!
      const plan = (
        await db
          .prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
          .bind(...query.values)
          .all<{ detail: string }>()
      ).results.map((step) => step.detail)
      expect(
        plan.some(
          (step) =>
            step.includes(`USING INDEX ${index}`) && step.includes("id>?")
        )
      ).toBe(true)
      expect(
        plan.some((step) => /TEMP B-TREE.*ORDER BY|SCAN d\b/.test(step))
      ).toBe(false)
    }
  })

  it("restarts unsent preparation and restores the same outbox atomically with the receipt and platform audit", async () => {
    await seed(db, now)
    const before = (await row())!,
      originalOutbox = (await outbox())!
    const result = await recover()
    expect(result).toMatchObject({
      deliveryId: "mail",
      mode: "retry_preparation",
      state: "queued",
    })
    expect(await row()).toMatchObject({
      ...before,
      payload_key: null,
      payload_hash: null,
      email_state: "pending",
      pdf_state: "pending",
      failures: 0,
      last_error: null,
      completed_at: null,
      updated_at: now,
      next_attempt_at: now,
    })
    expect(await outbox()).toMatchObject({
      ...originalOutbox,
      completed_at: null,
      dispatched_at: null,
      next_attempt_at: now,
    })
    expect(await count("email_deliveries")).toBe(1)
    expect(await count("outbox")).toBe(1)
    const audit = await db.prepare("SELECT * FROM audit_entries").first<{
      scope: string
      event_id: null
      description: string
      correlation_id: string
    }>()
    expect(audit).toMatchObject({
      scope: "platform",
      event_id: null,
      correlation_id: "recover",
    })
    expect(JSON.parse(audit!.description)).toMatchObject({
      reason: "Provider access was restored.",
      previousEmailState: "failed",
      previousPdfState: "failed",
      previousErrorCode: "PROVIDER_UNAVAILABLE",
    })
    const receipt = await db
      .prepare("SELECT response_json FROM request_receipts")
      .first<string>("response_json")
    expect(JSON.parse(receipt!)).toEqual(result)
  })

  it("preserves the original attempted request, provider history and attempt count", async () => {
    await attempted()
    const before = (await row())!
    expect(
      (await readDelivery(db, "operator", "mail", options())).delivery
        .allowedRecoveryModes
    ).toEqual(["retry_same_request"])
    await recover("retry_same_request")
    expect(await row()).toMatchObject({
      ...before,
      email_state: "pending",
      failures: 0,
      last_error: null,
      completed_at: null,
      updated_at: now,
      next_attempt_at: now,
    })
    await expect(
      recover("retry_preparation", "wrong-mode")
    ).rejects.toMatchObject({ status: 409 })
    expect(await count("email_deliveries")).toBe(1)
    expect(await count("outbox")).toBe(1)
  })

  it("rejects the exact 23-hour boundary and clock rollback, including expiry between reading and committing", async () => {
    for (const [id, first] of [
      ["inside", now - 23 * hour + 1],
      ["boundary", now - 23 * hour],
      ["outside", now - 23 * hour - 1],
      ["future", now + 1],
    ] as const) {
      await attempted(id, { first_attempt_at: first, last_attempt_at: first })
    }
    await recover("retry_same_request", "inside", "inside")
    for (const id of ["boundary", "outside", "future"])
      await expect(recover("retry_same_request", id, id)).rejects.toMatchObject(
        { status: 409 }
      )
    await attempted("race", {
      first_attempt_at: now - 23 * hour + 1,
      last_attempt_at: now - 23 * hour + 1,
    })
    const before = await row("race")
    await expect(
      requestDeliveryRecovery(
        db,
        "operator",
        "race",
        await input("retry_same_request", "race", "race"),
        {
          now: () => now,
          beforeCommit: async () => {
            now++
          },
        }
      )
    ).rejects.toMatchObject({ status: 409 })
    expect(await row("race")).toEqual(before)
    expect(await count("request_receipts")).toBe(1)
  })

  it("rejects active leases and detects a worker claim even if its timestamp has not changed", async () => {
    await seed(db, now, "mail", {
      lease_token: "worker-a",
      lease_until: now + 1,
    })
    expect(
      (await readDelivery(db, "operator", "mail", options())).delivery
    ).toMatchObject({
      busyUntil: new Date(now + 1).toISOString(),
      allowedRecoveryModes: [],
    })
    await expect(recover()).rejects.toMatchObject({ status: 409 })
    now++
    await recover()
    await seed(db, now, "race")
    await expect(
      requestDeliveryRecovery(
        db,
        "operator",
        "race",
        await input("retry_preparation", "race", "race"),
        {
          ...options(),
          beforeCommit: async () => {
            await db
              .prepare(
                "UPDATE email_deliveries SET lease_token='worker-b',lease_until=? WHERE id='race'"
              )
              .bind(now + 30_000)
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ status: 409 })
    expect(await row("race")).toMatchObject({
      lease_token: "worker-b",
      email_state: "failed",
      failures: 7,
    })
    expect(await count("request_receipts")).toBe(1)
  })

  it("rechecks grant revocation and suspension inside the mutation batch", async () => {
    await seed(db, now)
    const before = await row(),
      request = await input()
    await expect(
      requestDeliveryRecovery(db, "operator", "mail", request, {
        ...options(),
        beforeCommit: async () => {
          await db
            .prepare("DELETE FROM platform_grants WHERE user_id='operator'")
            .run()
        },
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(await row()).toEqual(before)
    await db
      .prepare(
        "INSERT INTO platform_grants (user_id,permission,granted_at) VALUES ('operator','platform:recover',?)"
      )
      .bind(now)
      .run()
    await expect(
      requestDeliveryRecovery(db, "operator", "mail", request, {
        ...options(),
        beforeCommit: async () => {
          await db
            .prepare(
              "UPDATE profiles SET suspended_at=? WHERE user_id='operator'"
            )
            .bind(now)
            .run()
        },
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(await row()).toEqual(before)
    expect(await count("request_receipts")).toBe(0)
    expect(await count("audit_entries")).toBe(0)
  })

  it("rejects stale state and rolls back a competing terminal transition", async () => {
    await attempted()
    const request = await input("retry_same_request")
    await expect(
      requestDeliveryRecovery(
        db,
        "operator",
        "mail",
        { ...request, expectedUpdatedAt: new Date(now - 2000).toISOString() },
        options()
      )
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      requestDeliveryRecovery(db, "operator", "mail", request, {
        ...options(),
        beforeCommit: async () => {
          await db
            .prepare(
              "UPDATE email_deliveries SET email_state='delivered' WHERE id='mail'"
            )
            .run()
        },
      })
    ).rejects.toMatchObject({ status: 409 })
    expect(await row()).toMatchObject({ email_state: "delivered", failures: 7 })
    expect(await count("request_receipts")).toBe(0)
    expect(await count("audit_entries")).toBe(0)
  })

  it("commits one receipt and audit under concurrent exact replay and rejects changed reuse", async () => {
    await seed(db, now)
    const request = await input()
    let ready = 0,
      release!: () => void
    const bothReady = new Promise<void>((resolve) => {
      release = resolve
    })
    const beforeCommit = async () => {
      ready++
      if (ready === 2) release()
      await bothReady
    }
    const results = await Promise.all(
      [1, 2].map(() =>
        requestDeliveryRecovery(db, "operator", "mail", request, {
          ...options(),
          beforeCommit,
        })
      )
    )
    expect(results[0]).toEqual(results[1])
    expect(
      await requestDeliveryRecovery(db, "operator", "mail", request, options())
    ).toEqual(results[0])
    expect(await count("request_receipts")).toBe(1)
    expect(await count("audit_entries")).toBe(1)
    expect(await count("outbox")).toBe(1)
    await expect(
      requestDeliveryRecovery(
        db,
        "operator",
        "mail",
        { ...request, reason: "Different justification." },
        options()
      )
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      requestDeliveryRecovery(
        db,
        "operator",
        "mail",
        { ...request, requestId: "different-request" },
        options()
      )
    ).rejects.toMatchObject({ status: 409 })
  })

  it("rolls back job and outbox changes when the audit cannot commit, then recovers with the same request", async () => {
    await seed(db, now)
    const before = await row(),
      beforeOutbox = await outbox(),
      request = await input()
    await db
      .prepare(
        "CREATE TRIGGER reject_recovery_audit BEFORE INSERT ON audit_entries WHEN NEW.action='delivery.recovery_requested' BEGIN SELECT RAISE(ABORT,'synthetic_audit_failure'); END"
      )
      .run()
    await expect(
      requestDeliveryRecovery(db, "operator", "mail", request, options())
    ).rejects.toThrow("synthetic_audit_failure")
    expect(await row()).toEqual(before)
    expect(await outbox()).toEqual(beforeOutbox)
    expect(await count("request_receipts")).toBe(0)
    await db.prepare("DROP TRIGGER reject_recovery_audit").run()
    await requestDeliveryRecovery(db, "operator", "mail", request, options())
    expect(await count("request_receipts")).toBe(1)
    expect(await count("audit_entries")).toBe(1)
  })

  it("never recovers delivered, bounced or locally completed mail", async () => {
    for (const [id, state, provider] of [
      ["delivered", "delivered", providerId],
      ["bounced", "bounced", providerId],
      ["local", "review_needed", "local:mail"],
    ] as const) {
      await attempted(id, { email_state: state, provider_id: provider })
      expect(
        (await readDelivery(db, "operator", id, options())).delivery
          .allowedRecoveryModes
      ).toEqual([])
      for (const mode of [
        "retry_preparation",
        "retry_same_request",
        "reconcile",
      ] as const)
        await expect(recover(mode, `${id}-${mode}`, id)).rejects.toMatchObject({
          status: 409,
        })
    }
    expect(await count("request_receipts")).toBe(0)
  })

  async function frozen(id: string, changes: Partial<Row> = {}) {
    storage = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('storage')}}",
        compatibilityDate: "2026-09-12",
        r2Buckets: ["FILES"],
      })
    )
    const files = (await storage.getR2Bucket("FILES")) as unknown as R2Bucket
    const version = await deliveryDigest("canonical content")
    const request = freezeEmailRequest({
      deliveryId: id,
      idempotencyKey: `elc-email/${id}`,
      from: "elc <demo@example.test>",
      to: "buyer@example.test",
      subject: "Synthetic delivery",
      text: "Synthetic recovery test.",
    })
    const text = JSON.stringify({
        generation: crypto.randomUUID(),
        version,
        request,
      }),
      hash = await deliveryDigest(text),
      key = `private/email-deliveries/${id}/${hash}.json`
    await files.put(key, text)
    await attempted(id, { payload_key: key, payload_hash: hash, ...changes })
    return { files, request, version, text, key }
  }

  it("reconciles a known receipt past the send window without a POST even when provider status is missing", async () => {
    const f = await frozen("mail", {
      provider_id: providerId,
      provider_status: null,
      first_attempt_at: now - 48 * hour,
    })
    const before = (await row())!,
      calls: string[] = []
    const dependencies: DeliveryDependencies = {
      now: () => now,
      available: true,
      readCurrent: async () => {
        throw new Error("Reconciliation must not request a new send")
      },
      prepare: async () => {
        throw new Error("Reconciliation must not render")
      },
      adapter: {
        send: async () => {
          calls.push("POST")
          throw new Error("Unexpected send")
        },
        lookup: async (id, request) => {
          calls.push("GET")
          expect(id).toBe(providerId)
          expect(request).toEqual(f.request)
          throw new EmailTransportError("PROVIDER_REJECTED", "permanent", 403)
        },
      },
    }
    expect(
      (await readDelivery(db, "operator", "mail", options())).delivery
        .allowedRecoveryModes
    ).toEqual(["reconcile"])
    await recover("reconcile")
    expect(calls).toEqual([])
    expect(await row()).toMatchObject({
      ...before,
      email_state: "accepted",
      failures: 0,
      last_error: null,
      next_attempt_at: now,
      updated_at: now,
      completed_at: null,
    })
    await processEmailDelivery(
      { DB: db, FILES: f.files, ENVIRONMENT: "preview" },
      "mail",
      dependencies
    )
    expect(calls).toEqual(["GET"])
    expect(await row()).toMatchObject({
      email_state: "review_needed",
      provider_id: providerId,
      provider_status: null,
      attempts: 5,
      first_attempt_at: before.first_attempt_at,
      payload_key: before.payload_key,
      payload_hash: before.payload_hash,
    })
    expect(await f.files.get(f.key).then((object) => object!.text())).toBe(
      f.text
    )
  })

  it("queues the unchanged uncertain request and rechecks the recipient before any later send", async () => {
    const f = await frozen("mail")
    await recover("retry_same_request")
    await db.prepare("UPDATE user SET email_verified=0 WHERE id='buyer'").run()
    const calls: string[] = []
    await processEmailDelivery(
      { DB: db, FILES: f.files, ENVIRONMENT: "preview" },
      "mail",
      {
        now: () => now,
        available: true,
        readCurrent: async () =>
          (await db
            .prepare("SELECT 1 FROM user WHERE id='buyer' AND email_verified=1")
            .first())
            ? { version: f.version, recipient: "buyer@example.test" }
            : null,
        prepare: async () => {
          calls.push("prepare")
          return f.request
        },
        adapter: {
          send: async () => {
            calls.push("send")
            throw new Error("Unexpected send")
          },
          lookup: async () => {
            calls.push("lookup")
            throw new Error("Unexpected lookup")
          },
        },
      }
    )
    expect(calls).toEqual([])
    expect(await row()).toMatchObject({
      email_state: "suppressed",
      last_error: "CURRENT_ACCESS_OR_STATE_DENIED",
      attempts: 5,
      payload_key: f.key,
    })
  })
})

it("delivery recovery leaves existing payment, order, ticket and payout records unchanged", async () => {
  const f = await createPaymentFixture()
  try {
    f.provider.state = "succeeded"
    await processPayment(f.env, f.provider, f.paymentId, { now: () => f.now })
    await f.db
      .prepare(
        "INSERT INTO platform_grants (user_id,permission,granted_at) VALUES ('owner','platform:recover',?)"
      )
      .bind(f.now)
      .run()
    await seed(f.db, f.now)
    const financial = async () =>
      Promise.all(
        [
          "orders",
          "payment_attempts",
          "tickets",
          "refunds",
          "simulated_payouts",
        ].map(
          async (table) =>
            (await f.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all())
              .results
        )
      )
    const before = await financial(),
      providerCalls = JSON.stringify(f.provider)
    const original = await readDelivery(f.db, "owner", "mail", {
      now: () => f.now,
    })
    await requestDeliveryRecovery(f.db, "owner", "mail", {
      requestId: "recover-email",
      mode: "retry_preparation",
      reason: "Retry the notification preparation.",
      expectedUpdatedAt: original.delivery.updatedAt,
    })
    expect(await financial()).toEqual(before)
    expect(JSON.stringify(f.provider)).toBe(providerCalls)
  } finally {
    await f.runtime.dispose()
  }
})
