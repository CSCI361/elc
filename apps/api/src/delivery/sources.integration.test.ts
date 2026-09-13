import { readFile } from "node:fs/promises"
import { PDFDocument } from "pdf-lib"
import { DEMO_PAID_TERMS_VERSION } from "@elc/shared"
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { createExportFixture } from "../exports/test-fixture"
import { downloadTicketPdf } from "../exports/ticket-pdf"
import { cancelEvent } from "../events/cancellation"
import { commitMutation } from "../events/store"
import { startCheckout } from "../orders/checkout"
import { startOrderPayment } from "../payments/checkout"
import { processPayment } from "../payments/reconcile"
import { recordPaymentStatus } from "../payments/reconcile"
import { loadPayment, paymentBinding } from "../payments/store"
import { cancelFreeRegistration } from "../payments/voluntary"
import { completeZeroTotalOrder } from "../tickets/issue"
import { updateActivation } from "../activation/mutations"
import { prepareActivationPayment } from "../activation/payment"
import { completeActivation } from "../activation/complete"
import {
  ensureEventCancellationRefund,
  processRefund,
} from "../payments/refunds"
import { simulateEventPayout } from "../payments/payouts"
import { RecordedProvider } from "../payments/test-fixture"
import {
  addSupportMessage,
  assignSupportCase,
  changeSupportStatus,
  createSupportCase,
} from "../support/service"
import type { DeliveryRow } from "./jobs"
import { createDeliverySources } from "./sources"

const fontBytes = new Uint8Array(
  await readFile(
    new URL("../exports/assets/NotoSans-Regular.bin", import.meta.url)
  )
)
describe("canonical notification sources with real D1 and R2", () => {
  let fixture: Awaited<ReturnType<typeof createExportFixture>>
  beforeEach(async () => {
    fixture = await createExportFixture()
  })
  afterEach(async () => {
    await fixture?.dispose()
  })
  const environment = () => ({
    ...fixture.env,
    EMAIL_FROM: "elc <tickets@example.test>",
  })
  const sources = () => createDeliverySources(environment(), { fontBytes })
  const context = () => ({
    db: fixture.db,
    actorId: "owner",
    correlationId: crypto.randomUUID(),
    appOrigin: fixture.env.APP_ORIGIN,
    now: Date.now(),
  })
  const revision = () =>
    fixture.db
      .prepare("SELECT revision FROM events WHERE id='event'")
      .first<number>("revision")
  async function sourceId(kind: string, entityId: string) {
    const row = await fixture.db
      .prepare(
        "SELECT id FROM outbox WHERE kind=? AND entity_id=? ORDER BY created_at DESC,id DESC LIMIT 1"
      )
      .bind(kind, entityId)
      .first<string>("id")
    if (!row) throw new Error(`Missing canonical ${kind} fixture`)
    return row
  }
  async function delivery(
    kind: string,
    entityId: string,
    source: string,
    recipient = "buyer",
    metadata: unknown = {},
    eventId: string | null = "event"
  ) {
    const id = crypto.randomUUID()
    await fixture.db
      .prepare(`INSERT INTO email_deliveries(id,source_id,kind,entity_id,event_id,recipient_id,part_key,metadata_json,pdf_state,next_attempt_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        id,
        source,
        kind,
        entityId,
        eventId,
        recipient,
        id,
        JSON.stringify(metadata),
        kind === "order.tickets" ? "pending" : "not_required",
        fixture.now,
        fixture.now,
        fixture.now
      )
      .run()
    return (await fixture.db
      .prepare("SELECT * FROM email_deliveries WHERE id=?")
      .bind(id)
      .first<DeliveryRow>())!
  }
  async function ticketDelivery(
    recipient = "buyer",
    metadata: unknown = { ticketIds: [fixture.ticketId], part: 1, parts: 1 }
  ) {
    return delivery(
      "order.tickets",
      fixture.orderId,
      await sourceId("order.completed", fixture.orderId),
      recipient,
      metadata
    )
  }
  async function prepared(row: DeliveryRow) {
    const loader = sources(),
      current = await loader.readCurrent(row)
    expect(current).not.toBeNull()
    return loader.prepare(row, current!)
  }
  async function grant(actor: string, permission: string) {
    await fixture.db
      .prepare(
        "INSERT INTO event_permissions(event_id,user_id,permission,granted_at) VALUES('event',?,?,?)"
      )
      .bind(actor, permission, fixture.now)
      .run()
  }
  async function supportCase(
    audience: "attendee" | "organizer_platform" = "attendee"
  ) {
    return createSupportCase(
      fixture.db,
      audience === "attendee" ? "buyer" : "owner",
      {
        requestId: crypto.randomUUID(),
        audience,
        category: audience === "attendee" ? "technical" : "account",
        eventId: "event",
        subject: "Private subject that must never be emailed",
        body: "Private support message with sensitive details",
      }
    )
  }
  async function updateTitle(title: string) {
    return commitMutation(context(), {
      eventId: "event",
      expectedRevision: (await revision())!,
      requestId: crypto.randomUUID(),
      inputHash: "a".repeat(64),
      action: "event.updated",
      description: "Event details updated",
      resourceId: "event",
      statements: [
        fixture.db
          .prepare("UPDATE events SET title=? WHERE id='event'")
          .bind(title),
      ],
    })
  }
  async function cancelAndRefund() {
    await cancelEvent(context(), "event", {
      requestId: crypto.randomUUID(),
      expectedRevision: (await revision())!,
      reason: "Synthetic cancellation",
    })
    const id = await fixture.db
      .prepare(
        "SELECT id FROM payment_attempts WHERE purpose='ticket_order' AND subject_id=?"
      )
      .bind(fixture.orderId)
      .first<string>("id")
    const refund = await ensureEventCancellationRefund(
      fixture.db,
      await loadPayment(fixture.db, id!)
    )
    await processRefund(fixture.db, new RecordedProvider(), refund)
    return { paymentId: id!, refundId: refund }
  }
  async function seedEvent(id: string, paid = false) {
    await fixture.db
      .prepare(`INSERT INTO events(id,organizer_id,title,description,category,venue_name,venue_address,starts_at,ends_at,
      registration_opens_at,registration_closes_at,capacity,max_tickets_per_order,publication_state,calendar_uid,reporting_id,created_at,updated_at)
      VALUES(?,'owner','Delivery fixture','Synthetic event','Test','Hall','Almaty',?,?,?,?,7,7,'published',?,?,?,?)`)
      .bind(
        id,
        fixture.now + 3600000,
        fixture.now + 7200000,
        fixture.now - 3600000,
        fixture.now + 3600000,
        id + "@calendar",
        id + "-report",
        fixture.now,
        fixture.now
      )
      .run()
    await fixture.db
      .prepare(`INSERT INTO ticket_types(id,event_id,name,kind,price_minor,quantity,sales_start_at,sales_end_at,updated_at)
      VALUES(?,?,'Fixture type',?,?,7,?,?,?)`)
      .bind(
        id + "-type",
        id,
        paid ? "paid" : "free",
        paid ? 100000 : 0,
        fixture.now - 3600000,
        fixture.now + 3600000,
        fixture.now
      )
      .run()
    for (let i = 0; i < 7; i++)
      await fixture.db
        .prepare(
          "INSERT INTO inventory(id,event_id,ticket_type_id) VALUES(?,?,?)"
        )
        .bind(id + "-slot-" + i, id, id + "-type")
        .run()
  }
  async function activationPayment(eventId: string) {
    const saved = await updateActivation(fixture.db, "owner", eventId, {
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
      profile: {
        displayName: "Owner",
        legalName: "Test Owner",
        contact: "owner@example.test",
        dummyPayoutReference: "DEMO-TEST",
      },
      identityCheck: "passed",
      payoutCheck: "passed",
      acceptedTermsVersion: DEMO_PAID_TERMS_VERSION,
    })
    return prepareActivationPayment(fixture.env, "owner", eventId, {
      requestId: crypto.randomUUID(),
      expectedRevision: saved.activation.revision,
    })
  }

  it("partitions a seven-ticket order into six and one existing PDFs, then suppresses both after free cancellation", async () => {
    await seedEvent("free")
    const checkout = await startCheckout(fixture.db, "buyer", {
      requestId: crypto.randomUUID(),
      eventId: "free",
      items: [
        {
          ticketTypeId: "free-type",
          quantity: 7,
          attendeeNames: Array.from(
            { length: 7 },
            (_, i) => `Attendee ${i + 1}`
          ),
        },
      ],
    })
    await completeZeroTotalOrder(fixture.env, "buyer", checkout.order.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
    })
    const tickets = (
      await fixture.db
        .prepare("SELECT id FROM tickets WHERE order_id=? ORDER BY id")
        .bind(checkout.order.id)
        .all<{ id: string }>()
    ).results.map((row) => row.id)
    const source = await sourceId("order.completed", checkout.order.id)
    const rows = []
    for (const part of [1, 2]) {
      const row = await delivery(
        "order.tickets",
        checkout.order.id,
        source,
        "buyer",
        { ticketIds: tickets.slice((part - 1) * 6, part * 6), part, parts: 2 },
        "free"
      )
      rows.push(row)
      expect((await prepared(row)).attachments).toHaveLength(part === 1 ? 6 : 1)
    }
    await cancelFreeRegistration(fixture.db, "owner", checkout.order.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: (await fixture.db
        .prepare("SELECT revision FROM orders WHERE id=?")
        .bind(checkout.order.id)
        .first<number>("revision"))!,
      reason: "Synthetic free cancellation",
    })
    for (const row of rows) expect(await sources().readCurrent(row)).toBeNull()
    const cancelled = await delivery(
      "order.cancelled",
      checkout.order.id,
      await sourceId("registration.cancelled", checkout.order.id),
      "buyer",
      {},
      "free"
    )
    expect((await prepared(cancelled)).text).toContain(checkout.order.id)
    expect(
      await sources().readCurrent(
        await delivery(
          "order.cancelled",
          checkout.order.id,
          cancelled.source_id,
          "manager",
          {},
          "free"
        )
      )
    ).toBeNull()
    expect(
      await fixture.db
        .prepare("SELECT count(*) AS n FROM tickets WHERE order_id=?")
        .bind(checkout.order.id)
        .first<number>("n")
    ).toBe(7)
  }, 20000)

  it("binds activation confirmation to its successful fee and current organizer", async () => {
    await seedEvent("activation", true)
    const result = await activationPayment("activation"),
      payment = await loadPayment(fixture.db, result.payment.id)
    await recordPaymentStatus(fixture.db, {
      ...paymentBinding(payment),
      providerPaymentId: "checkout-" + payment.id,
      providerOrderId: "order-" + payment.id,
      state: "succeeded",
      refundedAmountMinor: 0,
    })
    await completeActivation(fixture.db, payment.id)
    const row = await delivery(
        "activation.completed",
        payment.id,
        await sourceId("activation.completed", "activation"),
        "owner",
        {},
        "activation"
      ),
      loader = sources()
    expect((await prepared(row)).text).toContain("activation")
    expect(
      await loader.readCurrent(
        await delivery(
          "activation.completed",
          payment.id,
          row.source_id,
          "manager",
          {},
          "activation"
        )
      )
    ).toBeNull()
    await fixture.db
      .prepare(
        "UPDATE payment_attempts SET last_error_code='RECONCILIATION_REQUIRED' WHERE id=?"
      )
      .bind(payment.id)
      .run()
    expect(await loader.readCurrent(row)).toBeNull()
    await fixture.db
      .prepare("UPDATE payment_attempts SET last_error_code=NULL WHERE id=?")
      .bind(payment.id)
      .run()
    await fixture.db
      .prepare("UPDATE events SET suspended_at=? WHERE id='activation'")
      .bind(fixture.now)
      .run()
    expect(await loader.readCurrent(row)).toBeNull()
  })

  it("delivers activation compensation to its owner without claiming a completed activation", async () => {
    await seedEvent("late-activation", true)
    const result = await activationPayment("late-activation"),
      adapter = new RecordedProvider()
    await processPayment(fixture.env, adapter, result.payment.id)
    const revision = await fixture.db
      .prepare("SELECT revision FROM events WHERE id='late-activation'")
      .first<number>("revision")
    await cancelEvent(context(), "late-activation", {
      requestId: crypto.randomUUID(),
      expectedRevision: revision,
      reason: "Synthetic cancellation before sandbox success",
    })
    adapter.state = "succeeded"
    await processPayment(fixture.env, adapter, result.payment.id)
    const refund = await fixture.db
      .prepare(
        "SELECT id FROM refunds WHERE payment_attempt_id=? AND state='succeeded'"
      )
      .bind(result.payment.id)
      .first<string>("id")
    expect(refund).not.toBeNull()
    const row = await delivery(
      "refund.completed",
      refund!,
      await sourceId("refund.changed", refund!),
      "owner",
      {},
      "late-activation"
    )
    expect((await prepared(row)).text).toContain(result.payment.id)
    expect(
      await fixture.db
        .prepare(
          "SELECT activated_at FROM event_activations WHERE event_id='late-activation'"
        )
        .first<number>("activated_at")
    ).toBeNull()
  })

  it("delivers a late-payment compensation even though the order never completed", async () => {
    const checkout = await startCheckout(fixture.db, "buyer", {
      requestId: crypto.randomUUID(),
      eventId: "event",
      items: [
        {
          ticketTypeId: "type",
          quantity: 1,
          seatIds: ["seat-2"],
          attendeeNames: ["Late attendee"],
        },
      ],
    })
    const adapter = new RecordedProvider(),
      result = await startOrderPayment(
        fixture.env,
        adapter,
        "buyer",
        checkout.order.id,
        { requestId: crypto.randomUUID(), expectedRevision: 0 }
      )
    adapter.state = "succeeded"
    await processPayment(fixture.env, adapter, result.payment.id, {
      now: () => fixture.now + 11 * 60000,
    })
    const refund = await fixture.db
      .prepare(
        "SELECT id FROM refunds WHERE payment_attempt_id=? AND state='succeeded'"
      )
      .bind(result.payment.id)
      .first<string>("id")
    expect(refund).not.toBeNull()
    const row = await delivery(
      "refund.completed",
      refund!,
      await sourceId("refund.changed", refund!)
    )
    expect((await prepared(row)).text).toContain(result.payment.id)
    expect(
      await fixture.db
        .prepare("SELECT completed_at FROM orders WHERE id=?")
        .bind(checkout.order.id)
        .first<number>("completed_at")
    ).toBeNull()
    expect(
      await fixture.db
        .prepare("SELECT count(*) AS n FROM tickets WHERE order_id=?")
        .bind(checkout.order.id)
        .first<number>("n")
    ).toBe(0)
  })

  it("renders all saved locales from canonical PDFs without issuing another ticket", async () => {
    const row = await ticketDelivery(),
      versions = new Set<string>()
    for (const locale of ["kk", "ru", "en"]) {
      await fixture.db
        .prepare(
          "INSERT INTO profiles(user_id,locale,updated_at) VALUES('buyer',?,0) ON CONFLICT(user_id) DO UPDATE SET locale=excluded.locale"
        )
        .bind(locale)
        .run()
      const loader = sources(),
        current = await loader.readCurrent(row)
      versions.add(current!.version)
      expect(await loader.readCurrent(row)).toEqual(current)
      const email = await loader.prepare(row, current!)
      expect(email).toMatchObject({
        to: "buyer@example.test",
        idempotencyKey: `elc-email/${row.id}`,
        deliveryId: row.id,
      })
      expect(email.attachments).toHaveLength(1)
      expect(email.text).not.toContain(fixture.credential)
      const bytes = Uint8Array.from(
        atob(email.attachments![0]!.content),
        (character) => character.charCodeAt(0)
      )
      const pdf = await PDFDocument.load(bytes)
      expect(pdf.getPageCount()).toBe(1)
      expect(pdf.getPages()[0]!.getWidth()).toBeCloseTo(595.28, 1)
      const canonical = await downloadTicketPdf(
        fixture.env,
        "buyer",
        fixture.ticketId,
        locale as "kk" | "ru" | "en",
        fontBytes
      )
      expect(bytes).toEqual(new Uint8Array(await canonical.arrayBuffer()))
      expect(email.attachments![0]!.filename).toBe(`elc-ticket-1-${locale}.pdf`)
    }
    expect(versions.size).toBe(3)
    expect(
      await fixture.db
        .prepare("SELECT count(*) AS n FROM tickets")
        .first<number>("n")
    ).toBe(1)
    expect(
      (await fixture.files.list({ prefix: "private/ticket-pdfs/" })).objects
    ).toHaveLength(3)
  })

  it("rejects changed recipients, wrong resource bindings, forged partitions and missing sources", async () => {
    const row = await ticketDelivery(),
      loader = sources()
    for (const altered of [
      { recipient_id: "manager" },
      { entity_id: "different" },
      { event_id: null },
      { source_id: "missing" },
      { metadata_json: "{}" },
    ])
      expect(await loader.readCurrent({ ...row, ...altered })).toBeNull()
    for (const recipient of ["owner", "manager", "scanner", "other"])
      expect(
        await loader.readCurrent(await ticketDelivery(recipient))
      ).toBeNull()
    for (const metadata of [
      { ticketIds: [fixture.ticketId, fixture.ticketId], part: 1, parts: 1 },
      { ticketIds: [fixture.ticketId], part: 2, parts: 2 },
      { ticketIds: ["different"], part: 1, parts: 1 },
    ])
      expect(
        await loader.readCurrent(await ticketDelivery("buyer", metadata))
      ).toBeNull()
    await fixture.db
      .prepare("UPDATE outbox SET payload_json=? WHERE id=?")
      .bind(JSON.stringify({ orderId: "different" }), row.source_id)
      .run()
    expect(await loader.readCurrent(row)).toBeNull()
    expect((await fixture.files.list()).objects).toHaveLength(0)
  })

  it("hashes current destination, saved locale and PDF content and refuses an old version", async () => {
    const row = await ticketDelivery(),
      loader = sources(),
      initial = (await loader.readCurrent(row))!
    await fixture.db
      .prepare("UPDATE user SET email='changed@example.test' WHERE id='buyer'")
      .run()
    const changed = (await loader.readCurrent(row))!
    expect(changed.recipient).toBe("changed@example.test")
    expect(changed.version).not.toBe(initial.version)
    await expect(loader.prepare(row, initial)).rejects.toMatchObject({
      disposition: "retryable",
    })
    await fixture.db
      .prepare(
        "UPDATE events SET venue_name='Updated canonical hall' WHERE id='event'"
      )
      .run()
    expect((await loader.readCurrent(row))!.version).not.toBe(changed.version)
    await fixture.db
      .prepare("UPDATE user SET email_verified=0 WHERE id='buyer'")
      .run()
    expect(await loader.readCurrent(row)).toBeNull()
    await fixture.db
      .prepare("UPDATE user SET email_verified=1 WHERE id='buyer'")
      .run()
    await fixture.db
      .prepare(
        "INSERT INTO profiles(user_id,suspended_at,updated_at) VALUES('buyer',?,0)"
      )
      .bind(fixture.now)
      .run()
    expect(await loader.readCurrent(row)).toBeNull()
  })

  it("does not release a prepared PDF when account access is revoked during R2 storage", async () => {
    const row = await ticketDelivery(),
      original = fixture.files
    const files = {
      get: original.get.bind(original),
      put: async (...args: Parameters<R2Bucket["put"]>) => {
        const stored = await original.put(...args)
        await fixture.db
          .prepare("UPDATE user SET email_verified=0 WHERE id='buyer'")
          .run()
        return stored
      },
    } as unknown as R2Bucket
    const loader = createDeliverySources(
        { ...environment(), FILES: files },
        { fontBytes }
      ),
      current = (await loader.readCurrent(row))!
    await expect(loader.prepare(row, current)).rejects.toBeDefined()
    expect(await loader.readCurrent(row)).toBeNull()
    expect(
      await fixture.db
        .prepare("SELECT count(*) AS n FROM tickets")
        .first<number>("n")
    ).toBe(1)
  })

  it("returns no current delivery when verification is revoked between the envelope and PDF source read", async () => {
    const row = await ticketDelivery(),
      original = fixture.db
    let revoke = true
    const db = new Proxy(original, {
      get(target, key) {
        if (key !== "prepare") {
          const value = Reflect.get(target, key)
          return typeof value === "function" ? value.bind(target) : value
        }
        return (sql: string) => {
          const statement = target.prepare(sql)
          if (!sql.includes("FROM email_deliveries")) return statement
          return {
            bind: (...bindings: unknown[]) => ({
              first: async () => {
                const result = await statement.bind(...bindings).first()
                if (revoke) {
                  revoke = false
                  await original
                    .prepare(
                      "UPDATE user SET email_verified=0 WHERE id='buyer'"
                    )
                    .run()
                }
                return result
              },
            }),
          }
        }
      },
    })
    const loader = createDeliverySources(
      { ...environment(), DB: db },
      { fontBytes }
    )
    expect(await loader.readCurrent(row)).toBeNull()
    expect((await fixture.files.list()).objects).toHaveLength(0)
  })

  it("suppresses ticket delivery after cancellation/refund while preserving refund and cancellation notices", async () => {
    const tickets = await ticketDelivery(),
      result = await cancelAndRefund(),
      loader = sources()
    expect(await loader.readCurrent(tickets)).toBeNull()
    const refund = await delivery(
      "refund.completed",
      result.refundId,
      await sourceId("refund.changed", result.refundId)
    )
    expect((await prepared(refund)).text).toContain(result.paymentId)
    expect(
      await loader.readCurrent(
        await delivery(
          "refund.completed",
          result.refundId,
          refund.source_id,
          "owner"
        )
      )
    ).toBeNull()
    const cancelled = await delivery(
      "event.cancelled",
      "event",
      await sourceId("event.changed", "event")
    )
    expect((await prepared(cancelled)).text).toContain("calendar.ics")
    expect(
      await loader.readCurrent(
        await delivery("event.cancelled", "event", cancelled.source_id, "other")
      )
    ).toBeNull()
    expect(
      await fixture.db
        .prepare("SELECT state FROM orders WHERE id=?")
        .bind(fixture.orderId)
        .first<string>("state")
    ).toBe("refunded")
  })

  it("binds update notices to current completed purchasers and suppresses superseded updates", async () => {
    await updateTitle("Updated canonical event")
    const first = await delivery(
        "event.updated",
        "event",
        await sourceId("event.changed", "event")
      ),
      loader = sources()
    expect((await prepared(first)).text).toContain("Updated canonical event")
    expect(
      await loader.readCurrent(
        await delivery("event.updated", "event", first.source_id, "manager")
      )
    ).toBeNull()
    await updateTitle("Latest canonical event")
    expect(await loader.readCurrent(first)).toBeNull()
    const latest = await delivery(
      "event.updated",
      "event",
      await sourceId("event.changed", "event")
    )
    expect((await prepared(latest)).text).toContain("Latest canonical event")
    await cancelAndRefund()
    expect(await loader.readCurrent(latest)).toBeNull()
  })

  it("routes support to current staff and falls back after an assigned permission is revoked without exposing body text", async () => {
    const opened = await supportCase(),
      source = await sourceId("support.notify", opened.case.id)
    const metadata = { changeId: opened.change.id },
      owner = await delivery(
        "support.changed",
        opened.case.id,
        source,
        "owner",
        metadata
      ),
      loader = sources()
    const notice = await prepared(owner)
    expect(notice.text).not.toContain("Private")
    expect(notice.subject).not.toContain("Private")
    expect(notice.attachments).toEqual([])
    expect(
      await loader.readCurrent(
        await delivery(
          "support.changed",
          opened.case.id,
          source,
          "buyer",
          metadata
        )
      )
    ).toBeNull()
    await grant("manager", "support:manage")
    await assignSupportCase(fixture.db, "owner", opened.case.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: opened.case.revision,
      assigneeId: "manager",
    })
    expect(await loader.readCurrent(owner)).toBeNull()
    const assigned = await delivery(
      "support.changed",
      opened.case.id,
      source,
      "manager",
      metadata
    )
    expect(await loader.readCurrent(assigned)).not.toBeNull()
    await fixture.db
      .prepare(
        "UPDATE event_permissions SET revoked_at=? WHERE event_id='event' AND user_id='manager' AND permission='support:manage'"
      )
      .bind(fixture.now)
      .run()
    expect(await loader.readCurrent(assigned)).toBeNull()
    expect(await loader.readCurrent(owner)).not.toBeNull()
    const reply = await addSupportMessage(fixture.db, "owner", opened.case.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: opened.case.revision + 1,
      body: "Another private body",
    })
    const recipient = await delivery(
      "support.changed",
      opened.case.id,
      await sourceId("support.notify", opened.case.id),
      "buyer",
      { changeId: reply.change.id }
    )
    expect((await prepared(recipient)).text).not.toContain(
      "Another private body"
    )
  })

  it("keeps organizer-platform conversations out of event staff notifications and suppresses stale status changes", async () => {
    await grant("manager", "support:manage")
    await fixture.db
      .prepare(
        "INSERT INTO platform_grants(user_id,permission,granted_at) VALUES('scanner','platform:support',?)"
      )
      .bind(fixture.now)
      .run()
    const opened = await supportCase("organizer_platform"),
      source = await sourceId("support.notify", opened.case.id),
      metadata = { changeId: opened.change.id },
      loader = sources()
    expect(
      await loader.readCurrent(
        await delivery(
          "support.changed",
          opened.case.id,
          source,
          "manager",
          metadata
        )
      )
    ).toBeNull()
    expect(
      await loader.readCurrent(
        await delivery(
          "support.changed",
          opened.case.id,
          source,
          "scanner",
          metadata
        )
      )
    ).not.toBeNull()
    const waiting = await changeSupportStatus(
      fixture.db,
      "scanner",
      opened.case.id,
      {
        requestId: crypto.randomUUID(),
        expectedRevision: opened.case.revision,
        status: "waiting_for_customer",
      }
    )
    const row = await delivery(
      "support.changed",
      opened.case.id,
      await sourceId("support.notify", opened.case.id),
      "owner",
      { changeId: waiting.change.id }
    )
    expect(await loader.readCurrent(row)).not.toBeNull()
    await changeSupportStatus(fixture.db, "scanner", opened.case.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: waiting.case.revision,
      status: "resolved",
    })
    expect(await loader.readCurrent(row)).toBeNull()
  })

  it("uses a canonical failure source and suppresses it after authoritative success", async () => {
    const checkout = await startCheckout(fixture.db, "buyer", {
      requestId: crypto.randomUUID(),
      eventId: "event",
      items: [
        {
          ticketTypeId: "type",
          quantity: 1,
          seatIds: ["seat-2"],
          attendeeNames: ["Second attendee"],
        },
      ],
    })
    const adapter = new RecordedProvider(),
      result = await startOrderPayment(
        fixture.env,
        adapter,
        "buyer",
        checkout.order.id,
        { requestId: crypto.randomUUID(), expectedRevision: 0 }
      )
    adapter.state = "failed"
    await processPayment(fixture.env, adapter, result.payment.id)
    const row = await delivery(
        "payment.failed",
        result.payment.id,
        await sourceId("payment.failed", result.payment.id)
      ),
      loader = sources()
    expect((await prepared(row)).text).toContain(result.payment.id)
    expect(
      await loader.readCurrent(
        await delivery(
          "payment.failed",
          result.payment.id,
          row.source_id,
          "owner"
        )
      )
    ).toBeNull()
    adapter.state = "succeeded"
    await processPayment(fixture.env, adapter, result.payment.id)
    expect(await loader.readCurrent(row)).toBeNull()
  })

  it("notifies only the payout owner and follows canonical refund adjustments", async () => {
    const payout = await simulateEventPayout(fixture.db, "event", {
      now: () => fixture.now + 10 * 86400000,
    })
    expect(payout).not.toBeNull()
    const row = await delivery(
        "payout.status",
        payout!.id,
        await sourceId("payout.simulated", payout!.id),
        "owner"
      ),
      loader = sources()
    expect((await prepared(row)).text).toContain("payout")
    expect(
      await loader.readCurrent(
        await delivery("payout.status", payout!.id, row.source_id, "manager")
      )
    ).toBeNull()
    const refund = await cancelAndRefund()
    const adjustment = await fixture.db
      .prepare("SELECT id FROM simulated_payout_adjustments WHERE refund_id=?")
      .bind(refund.refundId)
      .first<string>("id")
    const adjusted = await delivery(
      "payout.status",
      payout!.id,
      await sourceId("payout.adjusted", adjustment!),
      "owner",
      { adjustmentId: adjustment }
    )
    expect((await prepared(adjusted)).text).toContain("-")
    expect(
      await loader.readCurrent(
        await delivery(
          "payout.status",
          payout!.id,
          adjusted.source_id,
          "owner",
          { adjustmentId: "other" }
        )
      )
    ).toBeNull()
  })
})
