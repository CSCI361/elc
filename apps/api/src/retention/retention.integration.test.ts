import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { createExportFixture } from "../exports/test-fixture"
import { createSupportCase, addSupportMessage } from "../support/service"
import { DAY, HISTORY_MS } from "./policy"
import {
  retireEvent,
  retireStandaloneCase,
  cleanupRetainedAggregates,
} from "./aggregates"
import { cleanupRetentionObjects } from "./objects"
import {
  cleanupCompletedPayloads,
  cleanupExpiredSnapshots,
  cleanupInactiveProfiles,
} from "./housekeeping"
import { listRetention } from "./queries"
import { getRetentionBacklog } from "./backlog"
import { simulateEventPayout } from "../payments/payouts"
import { scanOnline } from "../tickets/scan"

// The fixture completes a real simulated checkout through the same D1 payment/ticket transitions.
// R2 operations use Miniflare's bucket implementation, including pagination and missing-key deletion.
describe("academic retention on D1 and R2", () => {
  let fixture: Awaited<ReturnType<typeof createExportFixture>>,
    db: D1Database,
    now: number
  const clock = () => now
  const count = async (table: string) =>
    db.prepare(`SELECT count(*) AS count FROM ${table}`).first<number>("count")
  beforeEach(async () => {
    fixture = await createExportFixture()
    db = fixture.db
    now = fixture.now + HISTORY_MS + 2 * DAY
  })
  afterEach(async () => {
    await fixture?.dispose()
  })
  const support = () =>
    createSupportCase(
      db,
      "buyer",
      {
        requestId: crypto.randomUUID(),
        audience: "attendee",
        category: "technical",
        subject: "Private subject",
        eventId: "event",
        orderId: fixture.orderId,
        body: "Private message",
      },
      { now: () => fixture.now }
    )
  const addAttachment = async (caseId: string) => {
    const id = "retention-attachment"
    await db
      .prepare(`INSERT INTO support_attachments(id,case_id,uploader_id,upload_request_id,input_hash,safe_filename,declared_type,original_size,original_sha256,quarantine_key,object_key,validator_version,status,created_at,expires_at,cleanup_after)
   VALUES (?,?,'buyer','upload',?,'private.pdf','application/pdf',10,?,?,?,'test','quarantined',?,?,?)`)
      .bind(
        id,
        caseId,
        "a".repeat(64),
        "b".repeat(64),
        `private/support-quarantine/${id}`,
        `private/support-files/${id}`,
        fixture.now,
        fixture.now + DAY,
        fixture.now + DAY
      )
      .run()
    await fixture.files.put(
      `private/support-quarantine/${id}`,
      "private quarantine"
    )
    await fixture.files.put(`private/support-files/${id}`, "private validated")
  }
  it("retires a paid aggregate and its private files, preserving unrelated records and immutable guards", async () => {
    const opened = await support()
    await addAttachment(opened.case.id)
    const pdf = `private/ticket-pdfs/${fixture.ticketId}/en/${"a".repeat(64)}.pdf`
    await fixture.files.put(pdf, "private PDF")
    await fixture.files.put("private/ticket-pdfs/unrelated/en/keep.pdf", "keep")
    const before = await count("audit_entries")
    expect(before).toBeGreaterThan(0)
    expect(await retireEvent(db, "event", { now: clock })).toBe(true)
    for (const table of [
      "events",
      "orders",
      "order_items",
      "reservations",
      "tickets",
      "inventory",
      "ticket_types",
      "payment_attempts",
      "activation_attempts",
      "activation_checklist_history",
      "event_activations",
      "support_cases",
      "support_messages",
      "support_case_changes",
      "support_attachments",
      "audit_entries",
      "outbox",
      "request_receipts",
    ])
      expect(await count(table), table).toBe(0)
    expect(await count("user")).toBe(5)
    expect(await count("retention_object_jobs")).toBe(3)
    expect(await fixture.files.head(pdf)).not.toBeNull()
    expect(await cleanupRetentionObjects(fixture.env, { now: clock })).toEqual({
      swept: 3,
      retry: 0,
    })
    expect(await fixture.files.head(pdf)).toBeNull()
    expect(
      await fixture.files.head("private/ticket-pdfs/unrelated/en/keep.pdf")
    ).not.toBeNull()
    expect(await retireEvent(db, "event", { now: clock })).toBe(false)
  })
  it("uses the latest event end, cancellation and support activity, including equality", async () => {
    now = fixture.now + 7200000 + HISTORY_MS - 1
    expect(await retireEvent(db, "event", { now: clock })).toBe(false)
    now++
    await db
      .prepare("UPDATE events SET cancelled_at=? WHERE id='event'")
      .bind(fixture.now + DAY)
      .run()
    expect(await retireEvent(db, "event", { now: clock })).toBe(false)
    now = fixture.now + DAY + HISTORY_MS
    const opened = await support()
    await addSupportMessage(
      db,
      "buyer",
      opened.case.id,
      {
        requestId: "later-message",
        expectedRevision: 1,
        body: "Later support activity",
      },
      { now: () => fixture.now + 2 * DAY }
    )
    expect(await retireEvent(db, "event", { now: clock })).toBe(false)
    now = fixture.now + 2 * DAY + HISTORY_MS
    expect(await retireEvent(db, "event", { now: clock })).toBe(true)
  })
  it("rechecks a late support activity atomically before any canonical or object deletion", async () => {
    const opened = await support()
    expect(
      await retireEvent(db, "event", {
        now: clock,
        beforeCommit: async () => {
          await addSupportMessage(
            db,
            "buyer",
            opened.case.id,
            {
              requestId: "racing-message",
              expectedRevision: 1,
              body: "Late support activity",
            },
            { now: clock }
          )
        },
      })
    ).toBe(false)
    expect(await count("tickets")).toBe(1)
    expect(await count("retention_object_jobs")).toBe(0)
  })
  it("postpones unresolved financial cases and exposes the reason only to current recovery admins", async () => {
    await createSupportCase(
      db,
      "buyer",
      {
        requestId: "refund-case",
        audience: "attendee",
        category: "refund",
        subject: "Refund request",
        eventId: "event",
        orderId: fixture.orderId,
        body: "Resolve before deletion",
      },
      { now: () => fixture.now }
    )
    expect(await retireEvent(db, "event", { now: clock })).toBe(false)
    await db
      .prepare(
        "INSERT INTO platform_grants(user_id,permission,granted_at) VALUES ('manager','platform:recover',?)"
      )
      .bind(now)
      .run()
    const listing = await listRetention(db, "manager", {}, { now: clock })
    expect(listing.items[0]).toMatchObject({
      id: "event",
      held: true,
      holdReasons: ["financial_case"],
    })
    expect(JSON.stringify(listing)).not.toContain("Refund request")
    await expect(
      listRetention(db, "owner", {}, { now: clock })
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      listRetention(
        db,
        "manager",
        {},
        {
          now: clock,
          beforeReturn: async () => {
            await db
              .prepare("DELETE FROM platform_grants WHERE user_id='manager'")
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ status: 403 })
  })
  it("postpones unresolved refunds until provider confirmation", async () => {
    const payment = await db
      .prepare("SELECT id FROM payment_attempts WHERE purpose='ticket_order'")
      .first<string>("id")
    await db
      .prepare(
        "INSERT INTO refunds(id,payment_attempt_id,reason,state,amount_minor,created_at) VALUES ('retention-refund',?,'event_cancelled','pending',1234500,?)"
      )
      .bind(payment, fixture.now)
      .run()
    expect(await retireEvent(db, "event", { now: clock })).toBe(false)
    await db
      .prepare(
        "UPDATE refunds SET state='succeeded',confirmed_at=?,dispatch_state='reconciled' WHERE id='retention-refund'"
      )
      .bind(now)
      .run()
    expect(await retireEvent(db, "event", { now: clock })).toBe(true)
  })
  it("postpones pending payment reconciliation", async () => {
    await db
      .prepare(`INSERT INTO orders(id,account_id,event_id,state,subtotal_minor,discount_minor,total_minor,processing_fee_minor,refund_policy_version,created_at)
      VALUES ('pending-order','buyer','event','pending',1234500,0,1234500,37035,'academic-v1',?)`)
      .bind(fixture.now)
      .run()
    await db
      .prepare(`INSERT INTO payment_attempts(id,purpose,subject_id,state,provider,idempotency_key,amount_minor,created_at)
      VALUES ('pending-payment','ticket_order','pending-order','pending','simulation','pending-payment',1234500,?)`)
      .bind(fixture.now)
      .run()
    expect(await cleanupRetainedAggregates(db, { now: clock })).toEqual({
      events: 0,
      cases: 0,
    })
    await db
      .prepare(
        "UPDATE payment_attempts SET state='failed',dispatch_state='reconciled' WHERE id='pending-payment'"
      )
      .run()
    expect(await retireEvent(db, "event", { now: clock })).toBe(true)
  })
  it("concurrent retirement commits once without duplicate object jobs", async () => {
    const results = await Promise.all([
      retireEvent(db, "event", { now: clock }),
      retireEvent(db, "event", { now: clock }),
    ])
    expect(results.sort((left, right) => Number(left) - Number(right))).toEqual(
      [false, true]
    )
    expect(await count("retention_object_jobs")).toBe(1)
  })
  it("rolls the entire retirement back on a child deletion failure", async () => {
    await db
      .prepare(
        "CREATE TRIGGER retention_test_failure BEFORE DELETE ON orders BEGIN SELECT RAISE(ABORT,'fixture failure'); END"
      )
      .run()
    await expect(retireEvent(db, "event", { now: clock })).rejects.toThrow(
      "fixture failure"
    )
    expect(await count("tickets")).toBe(1)
    expect(await count("payment_attempts")).toBe(2)
    expect(await count("retention_object_jobs")).toBe(0)
  })
  it("retries failed R2 deletion without restoring D1 access and sweeps late puts", async () => {
    const key = `private/ticket-pdfs/${fixture.ticketId}/en/test.pdf`
    await fixture.files.put(key, "private")
    await retireEvent(db, "event", { now: clock })
    const bad = new Proxy(fixture.files, {
      get(target, property) {
        if (property === "delete")
          return async () => {
            throw new Error("transient")
          }
        const value = Reflect.get(target, property)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    expect(
      await cleanupRetentionObjects(
        { ...fixture.env, FILES: bad },
        { now: clock }
      )
    ).toEqual({ swept: 0, retry: 1 })
    expect(await count("events")).toBe(0)
    now += DAY
    expect(await cleanupRetentionObjects(fixture.env, { now: clock })).toEqual({
      swept: 1,
      retry: 0,
    })
    await fixture.files.put(key, "an earlier request completed late")
    now += DAY
    expect(await cleanupRetentionObjects(fixture.env, { now: clock })).toEqual({
      swept: 1,
      retry: 0,
    })
    expect(await fixture.files.head(key)).toBeNull()
    now += 30 * DAY
    await cleanupRetentionObjects(fixture.env, { now: clock })
    expect(await count("retention_object_jobs")).toBe(0)
  })
  it("does not let an expired worker delete or acknowledge a newer claim", async () => {
    await retireEvent(db, "event", { now: clock })
    const key = `private/ticket-pdfs/${fixture.ticketId}/en/test.pdf`
    await fixture.files.put(key, "retained until current worker")
    expect(
      await cleanupRetentionObjects(fixture.env, {
        now: clock,
        beforeDelete: async (id) => {
          now += 60001
          await db
            .prepare(
              "UPDATE retention_object_jobs SET lease_token='new-worker',lease_until=? WHERE id=?"
            )
            .bind(now + 60000, id)
            .run()
        },
      })
    ).toEqual({ swept: 0, retry: 0 })
    expect(await fixture.files.head(key)).not.toBeNull()
    expect(
      await db
        .prepare("SELECT lease_token FROM retention_object_jobs")
        .first("lease_token")
    ).toBe("new-worker")
  })
  it("never deletes backup or unrelated prefixes from a malformed restored job", async () => {
    await db
      .prepare(
        "INSERT INTO retention_object_jobs(id,bucket,mode,object_key,created_at,next_attempt_at) VALUES ('bad','files','prefix','',?,?)"
      )
      .bind(now, now)
      .run()
    await fixture.files.put("private/backups/test.sql", "keep")
    expect(await cleanupRetentionObjects(fixture.env, { now: clock })).toEqual({
      swept: 0,
      retry: 1,
    })
    expect(await fixture.files.head("private/backups/test.sql")).not.toBeNull()
  })
  it("retires a standalone support case only after its own activity deadline", async () => {
    const opened = await createSupportCase(
      db,
      "owner",
      {
        requestId: "standalone",
        audience: "organizer_platform",
        category: "account",
        subject: "Account help",
        body: "Private account help",
      },
      { now: () => fixture.now }
    )
    await addAttachment(opened.case.id)
    await db
      .prepare(`INSERT INTO email_deliveries(id,source_id,kind,entity_id,recipient_id,metadata_json,email_state,next_attempt_at,created_at,updated_at)
      VALUES ('case-delivery','case-source','support.notify',?,'owner','{}','pending',?,?,?)`)
      .bind(opened.case.id, fixture.now, fixture.now, fixture.now)
      .run()
    await db
      .prepare(`INSERT INTO outbox(id,kind,entity_id,payload_json,created_at,next_attempt_at)
      VALUES ('case-email-job','email.send','case-delivery','{}',?,?)`)
      .bind(fixture.now, fixture.now)
      .run()
    now = fixture.now + HISTORY_MS - 1
    expect(await retireStandaloneCase(db, opened.case.id, { now: clock })).toBe(
      false
    )
    now++
    expect(await retireStandaloneCase(db, opened.case.id, { now: clock })).toBe(
      true
    )
    expect(await count("support_cases")).toBe(0)
    expect(await count("tickets")).toBe(1)
    expect(await count("retention_object_jobs")).toBe(2)
    expect(
      await db
        .prepare("SELECT id FROM outbox WHERE id='case-email-job'")
        .first()
    ).toBeNull()
    expect(await count("email_deliveries")).toBe(0)
  })
  it("expires completed outbox payloads at30days while retaining event audits and pending work", async () => {
    await db
      .prepare(
        "UPDATE outbox SET completed_at=? WHERE id=(SELECT id FROM outbox LIMIT 1)"
      )
      .bind(fixture.now)
      .run()
    const total = (await count("outbox"))!,
      audits = await count("audit_entries")
    expect(await cleanupCompletedPayloads(db, fixture.now + 30 * DAY - 1)).toBe(
      0
    )
    expect(await cleanupCompletedPayloads(db, fixture.now + 30 * DAY)).toBe(1)
    expect(await count("outbox")).toBe(total - 1)
    expect(await count("audit_entries")).toBe(audits)
  })
  it("keeps recently signed in accounts and every retained business relationship", async () => {
    await db
      .prepare(
        "INSERT INTO organizer_profiles(user_id,display_name,legal_name,contact,dummy_payout_reference,revision,created_at,updated_at) VALUES ('other','Retained organizer','Demo organizer','demo@example.test','DEMO-RETAINED',1,?,?)"
      )
      .bind(fixture.now, fixture.now)
      .run()
    await db
      .prepare(
        "INSERT INTO account_activity(user_id,last_sign_in_at) VALUES ('other',?)"
      )
      .bind(now)
      .run()
    expect(await cleanupInactiveProfiles(db, now)).toBe(0)
    expect(await count("organizer_profiles")).toBe(1)
    expect(await count("user")).toBe(5)
    now += HISTORY_MS
    expect(await cleanupInactiveProfiles(db, now)).toBe(1)
    expect(await count("organizer_profiles")).toBe(0)
    expect(
      await db.prepare("SELECT id FROM user WHERE id='other'").first()
    ).toBeNull()
    expect(
      await db.prepare("SELECT id FROM user WHERE id='buyer'").first()
    ).not.toBeNull()
  })
  it("removes a dormant suspended profile with its login credentials instead of lifting suspension", async () => {
    await db
      .prepare(
        "INSERT INTO profiles(user_id,suspended_at,updated_at) VALUES ('other',?,?)"
      )
      .bind(fixture.now, fixture.now)
      .run()
    await db
      .prepare(
        "INSERT INTO verification(id,identifier,value,expires_at,created_at,updated_at) VALUES ('reset-token','reset-password:private-token','other',?,?,?)"
      )
      .bind(now + 10000, now, now)
      .run()
    await db
      .prepare(
        "INSERT INTO development_mail(id,recipient,kind,subject,body,created_at) VALUES ('private-mail','other@example.test','reset-password','Reset','private link',?)"
      )
      .bind(now)
      .run()
    expect(await cleanupInactiveProfiles(db, now)).toBe(1)
    expect(
      await db.prepare("SELECT id FROM user WHERE id='other'").first()
    ).toBeNull()
    expect(await count("verification")).toBe(0)
    expect(await count("development_mail")).toBe(0)
  })
  it("retains server snapshot proofs until seven days after expiry for offline replay", async () => {
    await db
      .prepare(
        "INSERT INTO offline_devices(id,account_id,event_id,label,registered_at) VALUES ('device','scanner','event','Scanner',?)"
      )
      .bind(fixture.now)
      .run()
    await db
      .prepare(
        "INSERT INTO offline_snapshots(id,account_id,device_id,event_id,issued_at,expires_at,event_ends_at,ticket_count,key_id,manifest_json) VALUES ('snapshot','scanner','device','event',?,?,?,1,'key',NULL)"
      )
      .bind(fixture.now, fixture.now + 3600000, fixture.now + 7200000)
      .run()
    expect(
      await cleanupExpiredSnapshots(db, fixture.now + 3600000 + 7 * DAY - 1)
    ).toBe(0)
    expect(
      await cleanupExpiredSnapshots(db, fixture.now + 3600000 + 7 * DAY)
    ).toBe(1)
    expect(await count("offline_snapshots")).toBe(0)
    expect(await count("offline_devices")).toBe(1)
  })
  it("keeps unresolved scan incidents until a current lead records resolution", async () => {
    await db
      .prepare(
        "INSERT INTO offline_devices(id,account_id,event_id,label,registered_at) VALUES ('incident-device','scanner','event','Scanner',?)"
      )
      .bind(fixture.now)
      .run()
    await db
      .prepare(`INSERT INTO offline_operations(operation_id,account_id,device_id,event_id,snapshot_id,kind,device_sequence,captured_at,reported_at,input_hash,unit_hash,result,ticket_id,order_id)
     VALUES ('incident','scanner','incident-device','event','expired-proof','scan',1,?,?,?,?,'already_used',?,?)`)
      .bind(
        fixture.now,
        fixture.now,
        "a".repeat(64),
        "b".repeat(64),
        fixture.ticketId,
        fixture.orderId
      )
      .run()
    await db
      .prepare(
        "INSERT INTO offline_admission_reports(operation_id,order_id,ticket_id) VALUES ('incident',?,?)"
      )
      .bind(fixture.orderId, fixture.ticketId)
      .run()
    expect(await retireEvent(db, "event", { now: clock })).toBe(false)
    expect((await getRetentionBacklog(db, now)).events).toBe(0)
    await db
      .prepare(
        `UPDATE offline_admission_reports SET review_state='resolved',revision=1,resolution='no_admission',reviewed_at=?,reviewed_by='owner',reason='Reviewed gate records' WHERE operation_id='incident'`
      )
      .bind(now)
      .run()
    await db
      .prepare(
        `INSERT INTO offline_admission_reviews(id,operation_id,actor_id,resolution,reason,created_at) VALUES ('review','incident','owner','no_admission','Reviewed gate records',?)`
      )
      .bind(now)
      .run()
    expect(await retireEvent(db, "event", { now: clock })).toBe(true)
    for (const table of [
      "offline_operations",
      "offline_admission_reports",
      "offline_admission_reviews",
      "offline_devices",
    ])
      expect(await count(table)).toBe(0)
  })
  it("expires unopened drafts after the last edit even if their planned date is distant", async () => {
    await db
      .prepare(`INSERT INTO events(id,organizer_id,title,description,category,venue_name,venue_address,starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,calendar_uid,reporting_id,created_at,updated_at)
     VALUES ('draft','owner','Draft','Draft text','Education','Campus','Almaty',?,?,?,?,10,'draft-calendar','draft-report',?,?)`)
      .bind(now + DAY, now + 2 * DAY, now, now + DAY, fixture.now, fixture.now)
      .run()
    expect(
      await retireEvent(db, "draft", {
        now: () => fixture.now + HISTORY_MS - 1,
      })
    ).toBe(false)
    expect(
      await retireEvent(db, "draft", { now: () => fixture.now + HISTORY_MS })
    ).toBe(true)
    expect(await count("tickets")).toBe(1)
  })
  it("expires standalone completed email payloads and ciphertext without delaying an inactive account forever", async () => {
    await db
      .prepare(`INSERT INTO email_deliveries(id,source_id,kind,entity_id,recipient_id,metadata_json,email_state,next_attempt_at,created_at,updated_at,completed_at)
     VALUES ('auth-done','auth-source','auth.verify','other','other','{}','suppressed',?,?,?,?)`)
      .bind(fixture.now, fixture.now, fixture.now, fixture.now)
      .run()
    await db
      .prepare(
        `INSERT INTO auth_email_intents(delivery_id,encrypted_payload,expires_at,created_at) VALUES ('auth-done','private-ciphertext',?,?)`
      )
      .bind(fixture.now + 3600000, fixture.now)
      .run()
    expect(await cleanupInactiveProfiles(db, now)).toBe(0)
    await cleanupCompletedPayloads(db, fixture.now + 30 * DAY - 1)
    expect(await count("auth_email_intents")).toBe(1)
    expect((await getRetentionBacklog(db, now)).expiredAuthIntents).toBe(1)
    await cleanupCompletedPayloads(db, fixture.now + 30 * DAY)
    expect(await count("auth_email_intents")).toBe(0)
    expect((await getRetentionBacklog(db, now)).expiredAuthIntents).toBe(0)
    expect(await count("email_deliveries")).toBe(0)
    expect(await cleanupInactiveProfiles(db, now)).toBe(1)
  })
  it("drains a paginated PDF prefix and attests failed/backoff object work as pending", async () => {
    const prefix = `private/ticket-pdfs/${fixture.ticketId}/`
    for (let start = 0; start < 205; start += 20)
      await Promise.all(
        Array.from({ length: Math.min(20, 205 - start) }, (_, i) =>
          fixture.files.put(
            `${prefix}en/${String(start + i).padStart(3, "0")}.pdf`,
            "pdf"
          )
        )
      )
    await retireEvent(db, "event", { now: clock })
    expect((await getRetentionBacklog(db, now)).objects).toBe(1)
    await cleanupRetentionObjects(fixture.env, { now: clock })
    expect((await getRetentionBacklog(db, now)).objects).toBe(1)
    await cleanupRetentionObjects(fixture.env, { now: clock })
    await cleanupRetentionObjects(fixture.env, { now: clock })
    expect((await fixture.files.list({ prefix })).objects).toHaveLength(0)
    expect((await getRetentionBacklog(db, now)).objects).toBe(0)
    await db
      .prepare(
        "UPDATE retention_object_jobs SET completed_at=NULL,next_attempt_at=?"
      )
      .bind(now + DAY)
      .run()
    expect((await getRetentionBacklog(db, now)).objects).toBe(1)
  })
  it("retires canonical check-ins and simulated payout children with the event", async () => {
    await scanOnline(
      db,
      "scanner",
      {
        eventId: "event",
        operationId: "admission",
        credential: fixture.credential,
      },
      { now: () => fixture.now + 3600001 }
    )
    await simulateEventPayout(db, "event", {
      now: () => fixture.now + 10 * DAY,
    })
    expect(await count("checkins")).toBe(1)
    expect(await count("simulated_payouts")).toBe(1)
    expect(await count("simulated_payout_items")).toBe(1)
    expect(await retireEvent(db, "event", { now: clock })).toBe(true)
    for (const table of [
      "checkins",
      "simulated_payouts",
      "simulated_payout_items",
    ])
      expect(await count(table)).toBe(0)
  })
  const eventReport = (id: string, reporter: string, state = "open") =>
    db
      .prepare(`INSERT INTO event_reports(id,event_id,reporter_id,category,details,state,revision,resolved_by,resolution_reason,resolved_at,created_at,updated_at)
   VALUES (?,'event',?,'misleading','Synthetic report',?,1,?,?,?,?,?)`)
      .bind(
        id,
        reporter,
        state,
        state === "open" ? null : "other",
        state === "open" ? null : "Reviewed",
        state === "open" ? null : fixture.now,
        fixture.now,
        fixture.now
      )
      .run()
  it("retires open and resolved event reports with the event", async () => {
    await eventReport("open-report", "buyer")
    await eventReport("resolved-report", "scanner", "dismissed")
    expect(await retireEvent(db, "event", { now: clock })).toBe(true)
    expect(await count("event_reports")).toBe(0)
  })
  it("keeps an inactive account while it filed or resolved a retained event report", async () => {
    await eventReport("retained-report", "buyer", "dismissed")
    expect(await cleanupInactiveProfiles(db, now)).toBe(0)
    expect(
      await db.prepare("SELECT id FROM user WHERE id='other'").first()
    ).not.toBeNull()
  })
})
