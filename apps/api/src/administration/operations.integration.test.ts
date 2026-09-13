import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { createAuthTestDatabase } from "../auth/test-database"
import { listOperations, operationsCsv, exportOperations } from "./operations"

describe("authorized operational search and exports", () => {
  let fixture: Awaited<ReturnType<typeof createAuthTestDatabase>>
  let db: D1Database
  const now = Date.parse("2026-09-13T10:00:00Z"),
    day = 86400000
  beforeEach(async () => {
    fixture = await createAuthTestDatabase()
    db = fixture.DB
    for (const id of ["admin", "owner", "other"])
      await db
        .prepare(
          "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)"
        )
        .bind(id, id, `${id}@example.test`, now, now)
        .run()
    await db
      .prepare(
        "INSERT INTO platform_grants(user_id,permission,granted_at) VALUES('admin','platform:moderate',?)"
      )
      .bind(now)
      .run()
    for (const [id, end] of [
      ["event", now + day],
      ["expired", now - 181 * day],
    ] as const) {
      await db
        .prepare(`INSERT INTO events(id,organizer_id,title,description,category,venue_name,venue_address,starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,calendar_uid,reporting_id,created_at,updated_at)
    VALUES(?,'owner','Synthetic','Description','Music','Hall','Address',?,?,?,?,10,?,?,?,?)`)
        .bind(
          id,
          end - 3600000,
          end,
          end - 2 * day,
          end - 3600000,
          `calendar-${id}`,
          `report-${id}`,
          now - 190 * day,
          now - 190 * day
        )
        .run()
      for (const suffix of ["a", "b"])
        await db
          .prepare(
            "INSERT INTO orders(id,account_id,event_id,state,currency,subtotal_minor,discount_minor,total_minor,processing_fee_minor,refund_policy_version,created_at) VALUES(?,'owner',?,'abandoned','KZT',1000,100,900,27,'academic-v1',?)"
          )
          .bind(`${id}-${suffix}`, id, now - 190 * day)
          .run()
    }
    for (const [id, eventId, createdAt] of [
      ["audit-event", "event", now],
      ["audit-expired-event", "expired", now],
      ["audit-platform", null, now],
      ["audit-expired-platform", null, now - 180 * day],
    ] as const)
      await db
        .prepare(
          "INSERT INTO audit_entries(id,event_id,actor_id,scope,action,entity_id,description,correlation_id,created_at) VALUES(?,?,'owner',?,'event.suspended','subject',?,'request-id',?)"
        )
        .bind(
          id,
          eventId,
          eventId ? "event" : "platform",
          ' =HYPERLINK("https://example.test")\nSynthetic reason',
          createdAt
        )
        .run()
  })
  afterEach(async () => {
    await fixture?.runtime.dispose()
  })
  const list = (
    kind: "orders" | "payments" | "audit",
    query: Record<string, unknown> = {}
  ) => listOperations(db, "admin", { kind, ...query }, { now: () => now })
  it("returns allowlisted order fields and frozen monetary amounts", async () => {
    const result = await list("orders")
    expect(result.kind).toBe("orders")
    expect(result.items.map((row) => row.id)).toEqual(["event-a", "event-b"])
    expect(result.items[0]).toMatchObject({
      accountId: "owner",
      eventId: "event",
      totalMinor: 900,
      discountMinor: 100,
      processingFeeMinor: 27,
      currency: "KZT",
      retention: { held: false },
    })
    expect(Object.keys(result.items[0]!).sort()).toEqual(
      [
        "id",
        "eventId",
        "accountId",
        "state",
        "totalMinor",
        "discountMinor",
        "processingFeeMinor",
        "currency",
        "createdAt",
        "retention",
      ].sort()
    )
  })
  it("paginates exact identifiers and applies event/account filters", async () => {
    const first = await list("orders", { limit: 1 })
    expect(first.nextCursor).toBe("event-a")
    expect(
      (await list("orders", { limit: 1, after: first.nextCursor })).items.map(
        (row) => row.id
      )
    ).toEqual(["event-b"])
    expect(
      (
        await list("orders", {
          q: "event-a",
          eventId: "event",
          accountId: "owner",
        })
      ).items
    ).toHaveLength(1)
    expect((await list("orders", { q: "%" })).items).toEqual([])
    expect((await list("orders", { accountId: "other" })).items).toEqual([])
  })
  it.each(["orders", "payments", "audit"] as const)(
    "requires current moderation authority on %s and rechecks before the read",
    async (kind) => {
      await expect(listOperations(db, "other", { kind })).rejects.toMatchObject(
        { status: 403 }
      )
      await expect(
        listOperations(
          db,
          "admin",
          { kind },
          {
            beforeRead: async () => {
              await db
                .prepare("DELETE FROM platform_grants WHERE user_id='admin'")
                .run()
            },
          }
        )
      ).rejects.toMatchObject({ status: 403 })
    }
  )
  it("does not substitute recovery permission or accept a suspended moderator", async () => {
    await db
      .prepare(
        "INSERT INTO platform_grants(user_id,permission,granted_at) VALUES('other','platform:recover',?)"
      )
      .bind(now)
      .run()
    await expect(listOperations(db, "other")).rejects.toMatchObject({
      status: 403,
    })
    await db
      .prepare(
        "INSERT INTO profiles(user_id,suspended_at,updated_at) VALUES('admin',?,?)"
      )
      .bind(now, now)
      .run()
    await expect(list("orders")).rejects.toMatchObject({ status: 403 })
  })
  it("searches retained audit entries by entity, correlation or exact action and applies the 180-day platform boundary", async () => {
    for (const q of ["subject", "request-id", "event.suspended"]) {
      expect((await list("audit", { q })).items.map((row) => row.id)).toEqual([
        "audit-event",
        "audit-platform",
      ])
    }
    expect(
      (await list("audit", { eventId: "event" })).items.map((row) => row.id)
    ).toEqual(["audit-event"])
  })
  it("exports a bounded page with quoted text, spreadsheet formula protection and exact minor units", async () => {
    const csv = operationsCsv(await list("audit", { limit: 1 }))
    expect(csv.startsWith('\uFEFF"id","eventId"')).toBe(true)
    expect(csv).toContain(
      '"\' =HYPERLINK(""https://example.test"")\nSynthetic reason"'
    )
    expect(csv).not.toContain("audit-platform")
    expect(csv).toContain(
      '"retentionExpiresAt","retentionHeld","retentionHoldReasons","generatedAt"'
    )
    const orders = operationsCsv(await list("orders", { limit: 1 }))
    expect(orders).toContain('"900","100","27","KZT"')
    expect(orders).not.toContain("event-b")
  })
  it("resolves payment events and filters provider identifiers without exposing request bodies or checkout links", async () => {
    await db
      .prepare(`INSERT INTO payment_attempts(id,purpose,subject_id,state,provider,provider_payment_id,provider_order_id,actor_id,request_hash,request_json,checkout_url,dispatch_state,idempotency_key,amount_minor,currency,created_at)
     VALUES('payment','ticket_order','event-a','pending','polar_sandbox','provider-checkout','provider-order','owner','private-hash','{"private":"request"}','https://example.test/private-checkout','dispatched','private-key',900,'KZT',?)`)
      .bind(now)
      .run()
    for (const q of [
      "payment",
      "event-a",
      "provider-checkout",
      "provider-order",
    ]) {
      const page = await list("payments", {
        q,
        eventId: "event",
        accountId: "owner",
      })
      expect(page.items).toHaveLength(1)
      expect(page.items[0]).toMatchObject({
        eventId: "event",
        subjectId: "event-a",
        state: "pending",
        amountMinor: 900,
        refundState: null,
      })
      expect(JSON.stringify(page)).not.toContain("private-")
      expect(operationsCsv(page)).not.toContain("private-")
    }
    expect((await list("payments", { eventId: "expired" })).items).toHaveLength(
      0
    )
  })
  it("retains an expired event's operational records while a payment is unresolved and hides them after resolution", async () => {
    await db
      .prepare(`INSERT INTO payment_attempts(id,purpose,subject_id,provider,actor_id,idempotency_key,amount_minor,currency,created_at)
      VALUES('held-payment','ticket_order','expired-a','simulation','owner','held-key',900,'KZT',?)`)
      .bind(now - 190 * day)
      .run()
    const held = await list("orders", { eventId: "expired" })
    expect(held.items).toHaveLength(2)
    expect(held.items[0]?.retention).toMatchObject({
      held: true,
      holdReasons: ["payment_reconciliation"],
    })
    expect((await list("payments", { q: "held-payment" })).items).toHaveLength(
      1
    )
    expect((await list("audit", { eventId: "expired" })).items).toHaveLength(1)
    await db
      .prepare(
        "UPDATE payment_attempts SET state='failed',dispatch_state='reconciled' WHERE id='held-payment'"
      )
      .run()
    expect((await list("orders", { eventId: "expired" })).items).toHaveLength(0)
    expect((await list("payments", { q: "held-payment" })).items).toHaveLength(
      0
    )
    expect((await list("audit", { eventId: "expired" })).items).toHaveLength(0)
  })

  it("audits CSV exports without including query text or private row contents in the audit", async () => {
    const result = await exportOperations(
      db,
      "admin",
      { kind: "orders", q: "event-a" },
      { now: () => now }
    )
    expect(result.csv).toContain('"event-a"')
    const audit = await db
      .prepare(
        "SELECT description,entity_id FROM audit_entries WHERE action='operations.exported'"
      )
      .first()
    expect(audit).toEqual({
      description: "Exported 1 record from orders.",
      entity_id: "orders",
    })
  })
  it("blocks a CSV download when moderation is revoked after its data query, without recording a successful export", async () => {
    await expect(
      exportOperations(
        db,
        "admin",
        { kind: "orders" },
        {
          now: () => now,
          beforeExport: async () => {
            await db
              .prepare("DELETE FROM platform_grants WHERE user_id='admin'")
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ status: 403 })
    expect(
      await db
        .prepare(
          "SELECT count(*) n FROM audit_entries WHERE action='operations.exported'"
        )
        .first("n")
    ).toBe(0)
  })

  it("rejects unknown filters and oversized exports before returning records", async () => {
    await expect(list("orders", { limit: 51 })).rejects.toMatchObject({
      status: 400,
    })
    await expect(list("audit", { includeSecrets: true })).rejects.toMatchObject(
      { status: 400 }
    )
  })
})
