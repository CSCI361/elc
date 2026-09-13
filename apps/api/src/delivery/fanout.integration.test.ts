import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"
import { createAuthTestDatabase } from "../auth/test-database"
import { activateTestEvent } from "../activation/test-fixture"
import {
  createSupportCase,
  assignSupportCase,
  addSupportMessage,
} from "../support/service"
import { consumeNotificationOutbox, dispatchNotificationOutbox } from "./fanout"

describe("durable notification fanout on real D1", () => {
  let fixture: Awaited<ReturnType<typeof createAuthTestDatabase>>,
    db: D1Database,
    now: number
  const clock = () => now
  beforeEach(async () => {
    fixture = await createAuthTestDatabase()
    db = fixture.DB
    now = Date.now()
    await users([
      "owner",
      "buyer",
      "other",
      "staff",
      "platform",
      "scanner",
      "unverified",
    ])
    await db
      .prepare("UPDATE user SET email_verified=0 WHERE id='unverified'")
      .run()
    await db
      .prepare(`INSERT INTO events(id,organizer_id,title,description,category,venue_name,venue_address,starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,max_tickets_per_order,publication_state,calendar_uid,reporting_id,revision,created_at,updated_at)
      VALUES('event','owner','Қазақ өнері / Музыка / Music','Description','Music','Hall','Address',?,?,?,?,200,200,'published','event@elc','event-report',1,?,?)`)
      .bind(
        now + 3_600_000,
        now + 7_200_000,
        now - 3_600_000,
        now + 3_600_000,
        now,
        now
      )
      .run()
    await db
      .prepare(
        `INSERT INTO ticket_types(id,event_id,name,kind,price_minor,quantity,sales_start_at,sales_end_at,updated_at) VALUES('type','event','Free','free',0,200,?,?,?)`
      )
      .bind(now - 3_600_000, now + 3_600_000, now)
      .run()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fixture?.runtime.dispose()
  })

  async function users(ids: string[]) {
    await db.batch(
      ids.map((id) =>
        db
          .prepare(
            "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)"
          )
          .bind(id, id, `${id}@example.test`, now, now)
      )
    )
  }
  const source = async (
    kind: string,
    entity: string,
    payload: unknown,
    id: string = crypto.randomUUID()
  ) => {
    await db
      .prepare(
        "INSERT INTO outbox(id,kind,entity_id,payload_json,created_at,next_attempt_at) VALUES(?,?,?,?,?,?)"
      )
      .bind(
        id,
        kind,
        entity,
        typeof payload === "string" ? payload : JSON.stringify(payload),
        now,
        now
      )
      .run()
    return id
  }
  const orders = (
    rows: {
      id: string
      account?: string
      at?: number | null
      state?: string
      amount?: number
      blocked?: boolean
    }[]
  ) =>
    db.batch(
      rows.map((row) =>
        db
          .prepare(`INSERT INTO orders(id,account_id,event_id,state,subtotal_minor,discount_minor,total_minor,processing_fee_minor,refund_policy_version,created_at,completed_at,admission_blocked_at)
    VALUES(?,?,'event',?,?,0,?,0,'academic-v1',?,?,?)`)
          .bind(
            row.id,
            row.account ?? "buyer",
            row.state ?? "completed",
            row.amount ?? 0,
            row.amount ?? 0,
            now - 1000,
            row.at === undefined ? now : row.at,
            row.blocked ? now : null
          )
      )
    )
  const grant = (actor: string, permission = "support:manage") =>
    db
      .prepare(
        "INSERT INTO event_permissions(event_id,user_id,permission,granted_at) VALUES('event',?,?,?)"
      )
      .bind(actor, permission, now)
      .run()
  const jobs = (id: string) =>
    db
      .prepare(
        "SELECT id,kind,entity_id,event_id,recipient_id,part_key,metadata_json FROM email_deliveries WHERE source_id=? ORDER BY recipient_id,CAST(part_key AS INTEGER)"
      )
      .bind(id)
      .all<{
        id: string
        kind: string
        entity_id: string
        event_id: string | null
        recipient_id: string
        part_key: string
        metadata_json: string
      }>()
      .then((result) => result.results)
  const progress = (id: string) =>
    db
      .prepare(
        "SELECT cursor,completed_at FROM delivery_fanout WHERE source_id=?"
      )
      .bind(id)
      .first<{ cursor: string; completed_at: number | null }>()
  const consume = (id: string, beforeCommit?: () => Promise<void>) =>
    consumeNotificationOutbox({ DB: db }, id, {
      now: clock,
      ...(beforeCommit ? { beforeCommit } : {}),
    })
  async function drain(id: string, maximum = 20) {
    for (let index = 0; index < maximum; index++) {
      await consume(id)
      if ((await progress(id))?.completed_at != null) return
    }
    throw new Error("Synthetic notification source did not finish")
  }
  async function ticketSource(count = 13) {
    await orders([{ id: "ticket-order", state: "pending", at: null }])
    await db
      .prepare(`INSERT INTO order_items(id,order_id,ticket_type_id,ticket_type_name,quantity,unit_price_minor,subtotal_minor,discount_minor,total_minor,attendees_json,seats_json)
      VALUES('item','ticket-order','type','Free',?,0,0,0,0,?,'[]')`)
      .bind(
        count,
        JSON.stringify(Array.from({ length: count }, () => "Synthetic guest"))
      )
      .run()
    const ids = Array.from(
      { length: count },
      (_, index) => `ticket-${String(index).padStart(4, "0")}`
    )
    await db.batch(
      ids.toReversed().flatMap((id) => [
        db
          .prepare(
            "INSERT INTO inventory(id,event_id,ticket_type_id,order_id) VALUES(?,'event','type','ticket-order')"
          )
          .bind(`slot-${id}`),
        db
          .prepare(`INSERT INTO tickets(id,order_id,order_item_id,inventory_id,event_id,ticket_type_id,attendee_name,token_hash,credential_ciphertext,created_at)
        VALUES(?,'ticket-order','item',?,'event','type','Synthetic guest',?,'synthetic encrypted credential',?)`)
          .bind(id, `slot-${id}`, `hash-${id}`, now),
      ])
    )
    await db
      .prepare(
        "UPDATE orders SET state='completed',completed_at=? WHERE id='ticket-order'"
      )
      .bind(now)
      .run()
    return {
      id: await source("order.completed", "ticket-order", {
        orderId: "ticket-order",
      }),
      ids,
    }
  }
  async function support(
    audience: "attendee" | "organizer_platform" = "attendee"
  ) {
    const result = await createSupportCase(
      db,
      audience === "attendee" ? "buyer" : "owner",
      {
        requestId: crypto.randomUUID(),
        audience,
        category: audience === "attendee" ? "technical" : "account",
        eventId: "event",
        subject: "PRIVATE CASE SUBJECT",
        body: "PRIVATE MESSAGE BODY",
      },
      { now: clock }
    )
    return { result, id: `support-notify:${result.change.id}` }
  }
  const eventSource = (action = "event.updated") =>
    source("event.changed", "event", {
      eventId: "event",
      resourceId: "event",
      action,
      revision: 1,
    })

  it("partitions canonical sorted tickets into six PDFs per deterministic delivery and replays once", async () => {
    const fixture = await ticketSource()
    await consume(fixture.id)
    const rows = await jobs(fixture.id)
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => JSON.parse(row.metadata_json))).toEqual([
      { ticketIds: fixture.ids.slice(0, 6), part: 1, parts: 3 },
      { ticketIds: fixture.ids.slice(6, 12), part: 2, parts: 3 },
      { ticketIds: fixture.ids.slice(12), part: 3, parts: 3 },
    ])
    expect(rows.map((row) => row.part_key)).toEqual(["1", "2", "3"])
    for (const row of rows)
      expect(row.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/)
    await Promise.all([consume(fixture.id), consume(fixture.id)])
    expect(await jobs(fixture.id)).toEqual(rows)
    expect(
      await db
        .prepare("SELECT count(*) n FROM outbox WHERE kind='email.send'")
        .first<number>("n")
    ).toBe(3)
    expect((await progress(fixture.id))?.completed_at).toBe(now)
    const emitted = (
      await db
        .prepare(
          "SELECT id,entity_id,payload_json FROM outbox WHERE kind='email.send' ORDER BY id"
        )
        .all<{ id: string; entity_id: string; payload_json: string }>()
    ).results
    for (const row of emitted) {
      expect(row.id).toBe(`email:${row.entity_id}`)
      expect(JSON.parse(row.payload_json)).toEqual({
        deliveryId: row.entity_id,
      })
      expect(row.payload_json).not.toContain("credential")
    }
  })
  it("bounds a large order to twenty delivery parts and resumes without repacking earlier parts", async () => {
    const fixture = await ticketSource(121)
    await consume(fixture.id)
    const first = await jobs(fixture.id)
    expect(first).toHaveLength(20)
    expect((await progress(fixture.id))?.completed_at).toBeNull()
    await consume(fixture.id)
    expect((await jobs(fixture.id)).slice(0, 20)).toEqual(first)
    expect(JSON.parse((await jobs(fixture.id))[20]!.metadata_json)).toEqual({
      ticketIds: [fixture.ids[120]],
      part: 21,
      parts: 21,
    })
    expect((await progress(fixture.id))?.completed_at).toBe(now)
  })
  it("rolls back deliveries, email jobs and cursor on a transaction failure and retries identically", async () => {
    const fixture = await ticketSource(7)
    await db
      .prepare(
        "CREATE TRIGGER synthetic_fanout_failure BEFORE INSERT ON outbox WHEN NEW.kind='email.send' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END"
      )
      .run()
    await consume(fixture.id)
    expect(await jobs(fixture.id)).toHaveLength(0)
    expect(await progress(fixture.id)).toBeNull()
    expect(
      await db
        .prepare("SELECT completed_at FROM outbox WHERE id=?")
        .bind(fixture.id)
        .first<number | null>("completed_at")
    ).toBeNull()
    await db.prepare("DROP TRIGGER synthetic_fanout_failure").run()
    await consume(fixture.id)
    expect(await jobs(fixture.id)).toHaveLength(2)
    expect((await progress(fixture.id))?.completed_at).toBe(now)
  })
  it("serializes concurrent consumers through the cursor compare-and-swap", async () => {
    const fixture = await ticketSource(121)
    let arrivals = 0,
      release!: () => void
    const ready = new Promise<void>((resolve) => {
      release = resolve
    })
    const barrier = async () => {
      arrivals++
      if (arrivals === 2) release()
      await ready
    }
    await Promise.all([
      consume(fixture.id, barrier),
      consume(fixture.id, barrier),
    ])
    expect(await jobs(fixture.id)).toHaveLength(20)
    expect(JSON.parse((await progress(fixture.id))!.cursor).part).toBe(20)
    await drain(fixture.id)
    expect(await jobs(fixture.id)).toHaveLength(21)
  })
  it("does not deliver ticket credentials after cancellation becomes current before commit", async () => {
    const fixture = await ticketSource(7)
    await consume(fixture.id, async () => {
      await db
        .prepare("UPDATE events SET cancelled_at=? WHERE id='event'")
        .bind(now)
        .run()
    })
    expect(await jobs(fixture.id)).toHaveLength(0)
    expect((await progress(fixture.id))?.completed_at).toBe(now)
  })
  it("rolls back the whole ticket page when a selected ticket is invalidated before commit", async () => {
    const fixture = await ticketSource(7)
    await consume(fixture.id, async () => {
      await db
        .prepare("UPDATE tickets SET state='cancelled' WHERE id=?")
        .bind(fixture.ids[0])
        .run()
    })
    expect(await jobs(fixture.id)).toHaveLength(0)
    expect(await progress(fixture.id)).toBeNull()
    await consume(fixture.id)
    expect(await jobs(fixture.id)).toHaveLength(0)
    expect((await progress(fixture.id))?.completed_at).toBe(now)
  })
  it("keeps raw-order progress when an entire intermediate page has no eligible recipients", async () => {
    await orders(
      Array.from({ length: 20 }, (_, index) => ({
        id: `a-${String(index).padStart(2, "0")}`,
        account: "unverified",
      }))
    )
    await orders([{ id: "z-later", account: "other" }])
    const id = await eventSource()
    await consume(id)
    expect(await jobs(id)).toHaveLength(0)
    expect((await progress(id))?.completed_at).toBeNull()
    await consume(id)
    expect((await jobs(id)).map((row) => row.recipient_id)).toEqual(["other"])
    expect((await progress(id))?.completed_at).toBe(now)
  })
  it("deduplicates repeat purchasers across equal-time pages and excludes later purchases", async () => {
    await orders(
      Array.from({ length: 23 }, (_, index) => ({
        id: `a-${String(index).padStart(2, "0")}`,
      }))
    )
    await orders([
      { id: "z-other", account: "other" },
      { id: "future", account: "staff", at: now + 1 },
    ])
    const id = await eventSource()
    await drain(id)
    expect((await jobs(id)).map((row) => row.recipient_id)).toEqual([
      "buyer",
      "other",
    ])
  })
  it("includes all previously completed cancellation recipients even after cancellation and refund", async () => {
    await orders([
      { id: "cancelled", account: "buyer", state: "cancelled", blocked: true },
      { id: "refunded", account: "other", state: "refunded", blocked: true },
      { id: "never-completed", account: "staff", state: "cancelled", at: null },
    ])
    await db
      .prepare("UPDATE events SET cancelled_at=? WHERE id='event'")
      .bind(now)
      .run()
    const id = await eventSource("event.cancelled")
    await drain(id)
    expect((await jobs(id)).map((row) => row.recipient_id)).toEqual([
      "buyer",
      "other",
    ])
  })
  it("rechecks account suspension and superseding event changes at commit", async () => {
    await orders([{ id: "one" }, { id: "two", account: "other" }])
    const id = await eventSource()
    await consume(id, async () => {
      await db
        .prepare(
          "INSERT INTO profiles(user_id,suspended_at,updated_at) VALUES('buyer',?,?)"
        )
        .bind(now, now)
        .run()
    })
    expect((await jobs(id)).map((row) => row.recipient_id)).toEqual(["other"])
    const older = await eventSource()
    await consume(older, async () => {
      await db.prepare("UPDATE events SET revision=2 WHERE id='event'").run()
      await source("event.changed", "event", {
        eventId: "event",
        resourceId: "event",
        action: "event.updated",
        revision: 2,
      })
    })
    expect(await jobs(older)).toHaveLength(0)
  })
  it("rejects malformed, extra, mismatched and irrelevant source payloads without delivery", async () => {
    await orders([{ id: "one" }])
    await expect(source("order.completed", "one", "not JSON")).rejects.toThrow(
      "domain_outbox"
    )
    const ids = [
      await source("order.completed", "one", "[]"),
      await source("order.completed", "one", {
        orderId: "one",
        to: "private@example.test",
      }),
      await source("event.changed", "event", {
        eventId: "other",
        resourceId: "event",
        action: "event.updated",
        revision: 1,
      }),
      await source("event.changed", "event", {
        eventId: "event",
        resourceId: "other",
        action: "event.updated",
        revision: 1,
      }),
      await eventSource("campaign.created"),
    ]
    for (const id of ids) {
      await consume(id)
      expect(await jobs(id)).toHaveLength(0)
      expect((await progress(id))?.completed_at).toBe(now)
    }
    expect(await consume(await source("support.live", "event", {}))).toBe(false)
  })
  it("finishes an empty recipient set without creating an email job", async () => {
    const id = await eventSource()
    await consume(id)
    expect(await jobs(id)).toHaveLength(0)
    expect((await progress(id))?.completed_at).toBe(now)
    expect(await consume("missing")).toBe(false)
  })
  it("requires the unchanged source envelope in the same transaction as its jobs", async () => {
    await orders([{ id: "one" }])
    const id = await eventSource()
    await consume(id, async () => {
      await db
        .prepare("UPDATE outbox SET payload_json=? WHERE id=?")
        .bind(
          JSON.stringify({
            eventId: "other",
            resourceId: "event",
            action: "event.updated",
            revision: 1,
          }),
          id
        )
        .run()
    })
    expect(await progress(id)).toBeNull()
    expect(await jobs(id)).toHaveLength(0)
    await consume(id)
    expect((await progress(id))?.completed_at).toBe(now)
    expect(await jobs(id)).toHaveLength(0)
  })
  it("pages more than twenty responsible staff and excludes actor, scan-only and inactive accounts", async () => {
    const ids = Array.from(
      { length: 25 },
      (_, index) => `staff-${String(index).padStart(2, "0")}`
    )
    await users(ids)
    await db.batch(
      ids.map((id) =>
        db
          .prepare(
            "INSERT INTO event_permissions(event_id,user_id,permission,granted_at) VALUES('event',?,'support:manage',?)"
          )
          .bind(id, now)
      )
    )
    await grant("scanner", "ticket:scan")
    await grant("unverified")
    await db
      .prepare(
        "INSERT INTO platform_grants(user_id,permission,granted_at) VALUES('platform','platform:moderate',?)"
      )
      .bind(now)
      .run()
    const { id } = await support()
    await consume(id)
    expect((await jobs(id)).length).toBeLessThanOrEqual(20)
    expect((await progress(id))?.completed_at).toBeNull()
    await drain(id)
    const recipients = (await jobs(id)).map((row) => row.recipient_id)
    expect(recipients).toEqual(["owner", "platform", ...ids])
    expect(recipients).not.toContain("buyer")
    expect(recipients).not.toContain("scanner")
    expect(recipients).not.toContain("unverified")
    for (const row of await jobs(id)) {
      expect(JSON.parse(row.metadata_json)).toHaveProperty("changeId")
      expect(row.metadata_json).not.toContain("PRIVATE")
    }
  })
  it("sends only to requester and valid assignee, then falls back if assignment is revoked during selection", async () => {
    await grant("staff")
    const opened = await support()
    const assigned = await assignSupportCase(
      db,
      "owner",
      opened.result.case.id,
      {
        requestId: crypto.randomUUID(),
        expectedRevision: opened.result.case.revision,
        assigneeId: "staff",
      },
      { now: clock }
    )
    const message = await addSupportMessage(
      db,
      "buyer",
      opened.result.case.id,
      {
        requestId: crypto.randomUUID(),
        expectedRevision: assigned.case.revision,
        body: "PRIVATE FOLLOW-UP",
      },
      { now: clock }
    )
    const id = `support-notify:${message.change.id}`
    await consume(id, async () => {
      await db
        .prepare(
          "UPDATE event_permissions SET revoked_at=? WHERE user_id='staff'"
        )
        .bind(now)
        .run()
    })
    expect(await progress(id)).toBeNull()
    expect(await jobs(id)).toHaveLength(0)
    await drain(id)
    expect((await jobs(id)).map((row) => row.recipient_id)).toEqual(["owner"])
  })
  it("does not notify broad fallback staff when an assignee becomes valid before commit", async () => {
    await grant("staff")
    const opened = await support()
    await consume(opened.id, async () => {
      await assignSupportCase(
        db,
        "owner",
        opened.result.case.id,
        {
          requestId: crypto.randomUUID(),
          expectedRevision: opened.result.case.revision,
          assigneeId: "staff",
        },
        { now: clock }
      )
    })
    expect(await progress(opened.id)).toBeNull()
    await drain(opened.id)
    expect((await jobs(opened.id)).map((row) => row.recipient_id)).toEqual([
      "staff",
    ])
  })
  it("restarts candidate paging after assignment validity changes without duplicating earlier deliveries", async () => {
    const ids = Array.from(
      { length: 25 },
      (_, index) => `staff-${String(index).padStart(2, "0")}`
    )
    await users(ids)
    await db.batch(
      ids.map((id) =>
        db
          .prepare(
            "INSERT INTO event_permissions(event_id,user_id,permission,granted_at) VALUES('event',?,'support:manage',?)"
          )
          .bind(id, now)
      )
    )
    const opened = await support()
    await assignSupportCase(
      db,
      "owner",
      opened.result.case.id,
      {
        requestId: crypto.randomUUID(),
        expectedRevision: opened.result.case.revision,
        assigneeId: ids[0]!,
      },
      { now: clock }
    )
    await consume(opened.id)
    expect((await jobs(opened.id)).map((row) => row.recipient_id)).toEqual([
      ids[0],
    ])
    expect((await progress(opened.id))?.completed_at).toBeNull()
    await db
      .prepare("UPDATE event_permissions SET revoked_at=? WHERE user_id=?")
      .bind(now, ids[0])
      .run()
    await drain(opened.id)
    const recipients = (await jobs(opened.id)).map((row) => row.recipient_id)
    expect(recipients).toEqual(["owner", ...ids])
    // The earlier revoked recipient's durable job remains for the delivery loader to suppress.
    expect(new Set(recipients).size).toBe(recipients.length)
  })
  it("restricts organizer-platform conversations to the requester and platform staff", async () => {
    await grant("staff")
    await db
      .prepare(
        "INSERT INTO platform_grants(user_id,permission,granted_at) VALUES('platform','platform:support',?)"
      )
      .bind(now)
      .run()
    const { id } = await support("organizer_platform")
    await drain(id)
    expect((await jobs(id)).map((row) => row.recipient_id)).toEqual([
      "platform",
    ])
  })
  it("validates support change identity and includes the requester when staff writes", async () => {
    await grant("staff")
    const opened = await support()
    const response = await addSupportMessage(
      db,
      "staff",
      opened.result.case.id,
      {
        requestId: crypto.randomUUID(),
        expectedRevision: opened.result.case.revision,
        body: "PRIVATE STAFF REPLY",
      },
      { now: clock }
    )
    await drain(`support-notify:${response.change.id}`)
    expect(
      (await jobs(`support-notify:${response.change.id}`)).map(
        (row) => row.recipient_id
      )
    ).toEqual(["buyer", "owner"])
    const bad = await source("support.notify", opened.result.case.id, {
      caseId: opened.result.case.id,
      changeId: response.change.id,
      sequence: response.change.sequence + 1,
    })
    await consume(bad)
    expect(await jobs(bad)).toHaveLength(0)
  })
  it("selects activation, failed payment and free cancellation recipients from current canonical ownership", async () => {
    await db
      .prepare(
        "UPDATE ticket_types SET kind='paid',price_minor=1000 WHERE id='type'"
      )
      .run()
    const payment = await activateTestEvent(db, "event", "owner", now)
    const activation = await source("activation.completed", "event", {
      eventId: "event",
      paymentAttemptId: payment,
    })
    await consume(activation)
    expect(await jobs(activation)).toMatchObject([
      {
        kind: "activation.completed",
        entity_id: payment,
        event_id: "event",
        recipient_id: "owner",
        metadata_json: "{}",
      },
    ])
    await orders([
      { id: "failed-order", state: "pending", at: null, amount: 1000 },
      { id: "cancelled-free", state: "cancelled", blocked: true },
    ])
    await db
      .prepare(
        `INSERT INTO payment_attempts(id,purpose,subject_id,state,provider,idempotency_key,amount_minor,actor_id,created_at) VALUES('failed','ticket_order','failed-order','failed','polar_sandbox','failed-key',1000,'buyer',?)`
      )
      .bind(now)
      .run()
    const failed = await source(
      "payment.failed",
      "failed",
      { paymentAttemptId: "failed" },
      "payment-failed:failed"
    )
    const cancelled = await source("registration.cancelled", "cancelled-free", {
      orderId: "cancelled-free",
    })
    await consume(failed)
    await consume(cancelled)
    expect(await jobs(failed)).toMatchObject([
      { kind: "payment.failed", entity_id: "failed", recipient_id: "buyer" },
    ])
    expect(await jobs(cancelled)).toMatchObject([
      {
        kind: "order.cancelled",
        entity_id: "cancelled-free",
        recipient_id: "buyer",
      },
    ])
    const mismatched = await source("payment.failed", "failed", {
      paymentAttemptId: payment,
    })
    await consume(mismatched)
    expect(await jobs(mismatched)).toHaveLength(0)
  })
  it("binds refund and payout notices to the canonical payment, payout and adjustment identities", async () => {
    await orders([{ id: "paid", amount: 1000 }])
    await db
      .prepare(`INSERT INTO payment_attempts(id,purpose,subject_id,state,provider,idempotency_key,amount_minor,actor_id,created_at,succeeded_at)
      VALUES('paid-attempt','ticket_order','paid','succeeded','simulation','paid-key',1000,'buyer',?,?)`)
      .bind(now, now)
      .run()
    await db
      .prepare(`INSERT INTO reservations(id,order_id,account_id,event_id,state,created_at,expires_at,payment_attempt_id)
      VALUES('held','paid','buyer','event','consumed',?,?,'paid-attempt')`)
      .bind(now, now + 600000)
      .run()
    const eligible = now + 7_200_000 + 604800000
    await db
      .prepare(`INSERT INTO simulated_payouts(id,event_id,organizer_id,amount_minor,order_count,eligible_at,completed_at)
      VALUES('payout','event','owner',1000,1,?,?)`)
      .bind(eligible, eligible)
      .run()
    await db
      .prepare(`INSERT INTO simulated_payout_items(id,payout_id,order_id,payment_attempt_id,paid_minor,processing_fee_minor,contribution_minor)
      VALUES('payout-item','payout','paid','paid-attempt',1000,0,1000)`)
      .run()
    now = eligible
    const payout = await source("payout.simulated", "payout", {
      payoutId: "payout",
      eventId: "event",
      simulation: true,
    })
    await consume(payout)
    expect(await jobs(payout)).toMatchObject([
      {
        kind: "payout.status",
        entity_id: "payout",
        recipient_id: "owner",
        metadata_json: "{}",
      },
    ])
    await db
      .prepare(`INSERT INTO refunds(id,payment_attempt_id,reason,state,amount_minor,created_at,confirmed_at)
      VALUES('refund','paid-attempt','technical_compensation','succeeded',1000,?,?)`)
      .bind(now, now)
      .run()
    await db
      .prepare(`INSERT INTO simulated_payout_adjustments(id,payout_item_id,refund_id,amount_minor,created_at)
      VALUES('adjustment','payout-item','refund',-1000,?)`)
      .bind(now)
      .run()
    const refund = await source("refund.changed", "refund", {
      refundId: "refund",
      paymentAttemptId: "paid-attempt",
      state: "succeeded",
    })
    const pending = await source("refund.changed", "refund", {
      refundId: "refund",
      paymentAttemptId: "paid-attempt",
      state: "pending",
    })
    const wrongPayment = await source("refund.changed", "refund", {
      refundId: "refund",
      paymentAttemptId: "other-payment",
      state: "succeeded",
    })
    const adjusted = await source("payout.adjusted", "adjustment", {
      payoutId: "payout",
      eventId: "event",
      refundId: "refund",
      simulation: true,
    })
    const wrongAdjustment = await source("payout.adjusted", "payout", {
      payoutId: "payout",
      eventId: "event",
      refundId: "refund",
      simulation: true,
    })
    for (const id of [refund, pending, wrongPayment, adjusted, wrongAdjustment])
      await consume(id)
    expect(await jobs(refund)).toMatchObject([
      {
        kind: "refund.completed",
        entity_id: "refund",
        recipient_id: "buyer",
        metadata_json: "{}",
      },
    ])
    expect(await jobs(adjusted)).toMatchObject([
      {
        kind: "payout.status",
        entity_id: "payout",
        recipient_id: "owner",
        metadata_json: '{"adjustmentId":"adjustment"}',
      },
    ])
    for (const id of [pending, wrongPayment, wrongAdjustment])
      expect(await jobs(id)).toHaveLength(0)
  })
  it("dispatches at most twenty source messages and preserves failures for the next sweep", async () => {
    for (let index = 0; index < 23; index++)
      await source(
        "event.changed",
        "event",
        {
          eventId: "event",
          resourceId: "event",
          action: "event.updated",
          revision: 1,
        },
        `source-${index}`
      )
    const send = vi
      .fn()
      .mockResolvedValue(undefined)
      .mockRejectedValueOnce(new Error("synthetic queue failure"))
    await dispatchNotificationOutbox(
      { DB: db, DELIVERY: { send } as unknown as Queue<{ id: string }> },
      now
    )
    expect(send).toHaveBeenCalledTimes(20)
    expect(
      await db
        .prepare(
          "SELECT count(*) n FROM outbox WHERE dispatched_at IS NOT NULL"
        )
        .first<number>("n")
    ).toBe(19)
    await dispatchNotificationOutbox(
      { DB: db, DELIVERY: { send } as unknown as Queue<{ id: string }> },
      now
    )
    expect(send).toHaveBeenCalledTimes(24)
    expect(
      await db
        .prepare("SELECT count(*) n FROM outbox WHERE completed_at IS NOT NULL")
        .first<number>("n")
    ).toBe(0)
  })
  it("uses matching indexes for keyset order, ticket, source and grant lookups", async () => {
    const queries = [
      [
        "EXPLAIN QUERY PLAN SELECT id FROM orders WHERE event_id='event' AND completed_at<=1 ORDER BY completed_at,id LIMIT 20",
        "orders_delivery_recipients",
      ],
      [
        "EXPLAIN QUERY PLAN SELECT id FROM tickets WHERE event_id='event' AND order_id='order' AND id>'a' ORDER BY id LIMIT 120",
        "tickets_delivery_parts",
      ],
      [
        "EXPLAIN QUERY PLAN SELECT user_id FROM platform_grants WHERE permission='platform:support' AND user_id>'a' ORDER BY user_id LIMIT 20",
        "platform_grants_delivery",
      ],
      [
        "EXPLAIN QUERY PLAN SELECT user_id FROM event_permissions WHERE event_id='event' AND permission='support:manage' AND user_id>'a' ORDER BY user_id LIMIT 20",
        "event_permissions_delivery",
      ],
      [
        "EXPLAIN QUERY PLAN SELECT id FROM outbox WHERE kind='event.changed' AND entity_id='event' LIMIT 1",
        "outbox_delivery_source",
      ],
    ]
    for (const [sql, index] of queries)
      expect(JSON.stringify((await db.prepare(sql!).all()).results)).toContain(
        index
      )
  })
})
