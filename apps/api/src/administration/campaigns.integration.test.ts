import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import {
  operationsQuerySchema,
  platformCampaignsQuerySchema,
  platformCampaignsResponseSchema,
} from "@elc/shared"
import { createAuthTestDatabase } from "../auth/test-database"
import { listPlatformCampaigns } from "./campaigns"
import { exportOperations, listOperations } from "./operations"

describe("platform campaign activity", () => {
  let fixture: Awaited<ReturnType<typeof createAuthTestDatabase>>
  let db: D1Database
  const now = Date.parse("2026-09-13T12:00:00Z"),
    day = 86400000
  async function campaign(
    id: string,
    event = "event",
    enabled = true,
    name = `Campaign ${id}`
  ) {
    await db
      .prepare(`INSERT INTO campaigns(id,event_id,name,code,token_hash,reporting_id,discount_kind,discount_value,starts_at,ends_at,max_redemptions,enabled,updated_at)
      VALUES(?,?,?,?,?,?,'percentage',1000,?,?,100,?,?)`)
      .bind(
        id,
        event,
        name,
        `private-code-${id}`,
        `private-hash-${id}`,
        `report-${id}`,
        now - day,
        now + day,
        enabled ? 1 : 0,
        now
      )
      .run()
  }
  async function allocation(
    id: string,
    options: {
      campaignId?: string
      eventId?: string
      state?: string
      reservationState?: string
      expiresAt?: number
      committed?: boolean
      released?: boolean
      completed?: boolean
    } = {}
  ) {
    const event = options.eventId ?? "event",
      campaignId = options.campaignId ?? "a"
    await db
      .prepare(
        "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)"
      )
      .bind(id, id, `${id}@example.test`, now, now)
      .run()
    await db
      .prepare(`INSERT INTO orders(id,account_id,event_id,state,campaign_id,currency,subtotal_minor,discount_minor,total_minor,processing_fee_minor,refund_policy_version,created_at,completed_at)
      VALUES(?,?,?,?,?,'KZT',1000,100,900,27,'academic-v1',?,?)`)
      .bind(
        id,
        id,
        event,
        options.state ?? "pending",
        campaignId,
        now,
        options.completed ? now : null
      )
      .run()
    const expires = options.expiresAt ?? now + 600000
    await db
      .prepare(
        "INSERT INTO reservations(id,order_id,account_id,event_id,state,created_at,expires_at) VALUES(?,?,?,?,?,?,?)"
      )
      .bind(
        `r-${id}`,
        id,
        id,
        event,
        options.reservationState ?? "active",
        expires - 600000,
        expires
      )
      .run()
    await db
      .prepare(
        "INSERT INTO promo_allocations(order_id,campaign_id,reservation_id,committed_at,released_at) VALUES(?,?,?,?,?)"
      )
      .bind(
        id,
        campaignId,
        `r-${id}`,
        options.committed ? now : null,
        options.released ? now : null
      )
      .run()
  }
  beforeEach(async () => {
    fixture = await createAuthTestDatabase()
    db = fixture.DB
    for (const id of ["admin", "second-admin", "owner", "other"])
      await db
        .prepare(
          "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)"
        )
        .bind(id, id, `${id}@example.test`, now, now)
        .run()
    for (const id of ["admin", "second-admin"])
      await db
        .prepare(
          "INSERT INTO platform_grants(user_id,permission,granted_at) VALUES(?,'platform:moderate',?)"
        )
        .bind(id, now)
        .run()
    for (const [id, owner, end] of [
      ["event", "owner", now + day],
      ["other-event", "other", now + day],
      ["expired", "owner", now - 180 * day],
    ] as const)
      await db
        .prepare(`INSERT INTO events(id,organizer_id,title,description,category,venue_name,venue_address,starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,calendar_uid,reporting_id,created_at,updated_at)
        VALUES(?,?,?,'Description','Music','Hall','Address',?,?,?,?,10,?,?,?,?)`)
        .bind(
          id,
          owner,
          `Event ${id}`,
          end - 3600000,
          end,
          end - day,
          end - 3600000,
          `calendar-${id}`,
          `report-${id}`,
          now - 190 * day,
          now - 190 * day
        )
        .run()
    await campaign("a", "event", true, "Literal 10%_offer")
    await campaign("b", "event", false, "Another offer")
    await campaign("c", "other-event")
    await campaign("expired-campaign", "expired")
  })
  afterEach(async () => {
    await fixture?.runtime.dispose()
  })
  const list = (query: Record<string, unknown> = {}) =>
    listPlatformCampaigns(db, "admin", query, { now: () => now })

  it("returns only retained allowlisted fields and both discount kinds, without campaign secrets", async () => {
    await db
      .prepare(
        "UPDATE campaigns SET discount_kind='fixed',discount_value=25000 WHERE id='b'"
      )
      .run()
    const page = await list()
    expect(page.items.map((row) => row.id)).toEqual(["a", "b", "c"])
    expect(page.items[0]).toMatchObject({
      discount: { kind: "percentage", basisPoints: 1000 },
      activeHolds: 0,
      committedRedemptions: 0,
      retention: { held: false },
    })
    expect(page.items[1]).toMatchObject({
      enabled: false,
      discount: { kind: "fixed", amountMinor: 25000 },
    })
    expect(page.generatedAt).toBe(new Date(now).toISOString())
    expect(Object.keys(page.items[0]!).sort()).toEqual(
      [
        "id",
        "eventId",
        "eventTitle",
        "organizerId",
        "name",
        "enabled",
        "discount",
        "startsAt",
        "endsAt",
        "maxRedemptions",
        "activeHolds",
        "committedRedemptions",
        "updatedAt",
        "retention",
      ].sort()
    )
    expect(JSON.stringify(page)).not.toMatch(
      /private-code|private-hash|@example|report-a/
    )
    expect(
      platformCampaignsResponseSchema.safeParse({
        ...page,
        items: [{ ...page.items[0], code: "secret" }],
      }).success
    ).toBe(false)
  })
  it("counts only current holds and completed committed redemptions, retaining cancelled and refunded redemptions", async () => {
    await allocation("active")
    await allocation("expired-boundary", { expiresAt: now })
    await allocation("released", { released: true })
    await allocation("abandoned-reservation", { reservationState: "abandoned" })
    await allocation("nonpending-order", { state: "abandoned" })
    await allocation("completed", {
      state: "completed",
      completed: true,
      committed: true,
      reservationState: "consumed",
    })
    await allocation("refunded", {
      state: "refunded",
      completed: true,
      committed: true,
      reservationState: "consumed",
    })
    await allocation("cancelled", {
      state: "cancelled",
      completed: true,
      committed: true,
      reservationState: "consumed",
    })
    await allocation("uncompleted-commit", { committed: true })
    await allocation("unattributed-completion", {
      state: "completed",
      completed: true,
      reservationState: "consumed",
    })
    await allocation("other-campaign", { campaignId: "b" })
    expect(
      (await list({ q: "a" })).items.find((row) => row.id === "a")
    ).toMatchObject({ activeHolds: 1, committedRedemptions: 3 })
    expect(
      (await list({ q: "b" })).items.find((row) => row.id === "b")
    ).toMatchObject({ activeHolds: 1, committedRedemptions: 0 })
    await expect(
      db
        .prepare(
          "UPDATE promo_allocations SET campaign_id='b' WHERE order_id='completed'"
        )
        .run()
    ).rejects.toThrow()
    await expect(
      db
        .prepare(
          "UPDATE promo_allocations SET released_at=? WHERE order_id='completed'"
        )
        .bind(now)
        .run()
    ).rejects.toThrow()
    await expect(
      db
        .prepare(
          "UPDATE reservations SET event_id='other-event' WHERE id='r-active'"
        )
        .run()
    ).rejects.toThrow(/ELC invariant/)
    await expect(
      db
        .prepare(
          "UPDATE promo_allocations SET campaign_id='c' WHERE order_id='active'"
        )
        .run()
    ).rejects.toThrow(/ELC invariant/)
  })
  it("applies literal case-insensitive name search, exact IDs and combined filters", async () => {
    expect((await list({ q: "%_" })).items.map((row) => row.id)).toEqual(["a"])
    expect((await list({ q: "LITERAL" })).items.map((row) => row.id)).toEqual([
      "a",
    ])
    expect(
      (
        await list({
          q: "b",
          eventId: "event",
          organizerId: "owner",
          enabled: "no",
        })
      ).items.map((row) => row.id)
    ).toEqual(["b"])
    expect(
      (await list({ eventId: "event", organizerId: "other" })).items
    ).toEqual([])
    expect((await list({ enabled: "yes" })).items.map((row) => row.id)).toEqual(
      ["a", "c"]
    )
  })
  it("uses actor/filter-bound cursors and does not skip a row when the anchor is deleted", async () => {
    const first = await list({ limit: 1 })
    expect(first.items[0]?.id).toBe("a")
    await db.prepare("DELETE FROM campaigns WHERE id='a'").run()
    expect(
      (await list({ limit: 1, cursor: first.nextCursor })).items[0]?.id
    ).toBe("b")
    for (const changed of [
      { q: "offer" },
      { eventId: "event" },
      { organizerId: "owner" },
      { enabled: "yes" },
      { limit: 2 },
    ])
      await expect(
        list({ limit: 1, cursor: first.nextCursor, ...changed })
      ).rejects.toMatchObject({ status: 400 })
    await expect(
      listPlatformCampaigns(
        db,
        "second-admin",
        { limit: 1, cursor: first.nextCursor },
        { now: () => now }
      )
    ).rejects.toMatchObject({ status: 400 })
    await expect(list({ cursor: "garbage" })).rejects.toMatchObject({
      status: 400,
    })
  })
  it("defaults to twenty rows, enforces fifty maximum and rejects unsupported filters", async () => {
    for (let i = 0; i < 21; i++)
      await campaign(`page-${i.toString().padStart(2, "0")}`)
    const first = await list()
    expect(first.items).toHaveLength(20)
    const second = await list({ cursor: first.nextCursor })
    expect(second.items).toHaveLength(4)
    expect(
      new Set([...first.items, ...second.items].map((row) => row.id)).size
    ).toBe(24)
    expect(second.nextCursor).toBeNull()
    for (const query of [
      { limit: 51 },
      { includeCode: true },
      { enabled: "true" },
      { cursor: "" },
    ])
      await expect(list(query)).rejects.toMatchObject({ status: 400 })
    expect(platformCampaignsQuerySchema.parse({}).limit).toBe(20)
  })
  it.each(["revoke", "suspend", "unverify"])(
    "denies %s in the final snapshot even for an empty page",
    async (action) => {
      for (const q of ["no matching rows", ""]) {
        await db
          .prepare("UPDATE user SET email_verified=1 WHERE id='admin'")
          .run()
        await db.prepare("DELETE FROM profiles WHERE user_id='admin'").run()
        await db
          .prepare(
            "INSERT OR IGNORE INTO platform_grants(user_id,permission,granted_at) VALUES('admin','platform:moderate',?)"
          )
          .bind(now)
          .run()
        await expect(
          listPlatformCampaigns(
            db,
            "admin",
            { q },
            {
              now: () => now,
              beforeRead: async () => {
                if (action === "revoke")
                  await db
                    .prepare(
                      "DELETE FROM platform_grants WHERE user_id='admin'"
                    )
                    .run()
                else if (action === "suspend")
                  await db
                    .prepare(
                      "INSERT INTO profiles(user_id,suspended_at,updated_at) VALUES('admin',?,?)"
                    )
                    .bind(now, now)
                    .run()
                else
                  await db
                    .prepare(
                      "UPDATE user SET email_verified=0 WHERE id='admin'"
                    )
                    .run()
              },
            }
          )
        ).rejects.toMatchObject({ status: 403 })
      }
    }
  )
  it("does not substitute event ownership or platform recovery grants for moderation", async () => {
    await db
      .prepare(
        "INSERT INTO platform_grants(user_id,permission,granted_at) VALUES('owner','platform:recover',?)"
      )
      .bind(now)
      .run()
    await expect(listPlatformCampaigns(db, "owner")).rejects.toMatchObject({
      status: 403,
    })
  })
  it("rechecks retention and hold resolution in the final snapshot", async () => {
    await allocation("held-order", {
      eventId: "expired",
      campaignId: "expired-campaign",
    })
    await db
      .prepare(`INSERT INTO payment_attempts(id,purpose,subject_id,provider,actor_id,idempotency_key,amount_minor,currency,created_at)
      VALUES('held-payment','ticket_order','held-order','simulation','held-order','held-key',900,'KZT',?)`)
      .bind(now)
      .run()
    expect(
      (await list({ eventId: "expired" })).items[0]?.retention
    ).toMatchObject({ held: true, holdReasons: ["payment_reconciliation"] })
    const page = await listPlatformCampaigns(
      db,
      "admin",
      { eventId: "expired" },
      {
        now: () => now,
        beforeRead: async () => {
          await db
            .prepare(
              "UPDATE payment_attempts SET state='failed',dispatch_state='reconciled' WHERE id='held-payment'"
            )
            .run()
        },
      }
    )
    expect(page.items).toEqual([])
    expect(page.nextCursor).toBeNull()
  })
  it("materializes the page before indexed promo usage lookups", async () => {
    let sql = ""
    const traced = {
      prepare(query: string) {
        if (query.startsWith("WITH retained_events")) sql = query
        return db.prepare(query)
      },
      batch: db.batch.bind(db),
    } as D1Database
    await listPlatformCampaigns(
      traced,
      "admin",
      { eventId: "event" },
      { now: () => now }
    )
    const plan = await db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind("", "event", now, "admin", 21, now)
      .all<{ detail: string }>()
    const details = plan.results.map((row) => row.detail).join("\n")
    expect(details).toContain("MATERIALIZE page")
    expect(details).toContain("campaigns_event")
    expect(
      details.match(/USING (?:COVERING )?INDEX promo_usage/g),
      details
    ).toHaveLength(2)
    expect(details).not.toMatch(/SCAN a\b/)
  })
  it("filters order operations and audited CSV by campaign while rejecting other kinds", async () => {
    await allocation("first-order")
    await allocation("second-order", { campaignId: "b" })
    const query = { campaignId: "a", eventId: "event" }
    expect(
      (await listOperations(db, "admin", query, { now: () => now })).items.map(
        (row) => row.id
      )
    ).toEqual(["first-order"])
    const exported = await exportOperations(db, "admin", query, {
      now: () => now,
    })
    expect(exported.csv).toContain("first-order")
    expect(exported.csv).not.toContain("second-order")
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM audit_entries WHERE action='operations.exported'"
        )
        .first("n")
    ).toBe(1)
    for (const kind of ["payments", "audit"]) {
      expect(
        operationsQuerySchema.safeParse({ kind, campaignId: "a" }).success
      ).toBe(false)
      await expect(
        listOperations(db, "admin", { kind, campaignId: "a" })
      ).rejects.toMatchObject({ status: 400 })
      await expect(
        exportOperations(db, "admin", { kind, campaignId: "a" })
      ).rejects.toMatchObject({ status: 400 })
    }
  })
})
