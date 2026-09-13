import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import type {
  OfflineSnapshotManifest,
  OfflineSyncUnit,
} from "../../packages/shared/src"
import type { Miniflare } from "miniflare"
import { activateTestEvent } from "../../apps/api/src/activation/test-fixture"
import { startCheckout } from "../../apps/api/src/orders/checkout"
import { sweepExpiredReservations } from "../../apps/api/src/orders/expiry"
import { startOrderPayment } from "../../apps/api/src/payments/checkout"
import { processPayment } from "../../apps/api/src/payments/reconcile"
import { processRefund } from "../../apps/api/src/payments/refunds"
import { consumePaymentOutbox } from "../../apps/api/src/payments/outbox"
import { approveOrderRefund } from "../../apps/api/src/payments/voluntary"
import { RecordedProvider } from "../../apps/api/src/payments/test-fixture"
import { createSupportCase } from "../../apps/api/src/support/service"
import { consumeNotificationOutbox } from "../../apps/api/src/delivery/fanout"
import {
  consumeEmailDelivery,
  type DeliveryRow,
} from "../../apps/api/src/delivery/jobs"
import { createDeliverySources } from "../../apps/api/src/delivery/sources"
import type { EmailAdapter } from "../../apps/api/src/delivery/email"
import { registerOfflineDevice } from "../../apps/api/src/offline/devices"
import {
  issueOfflineSnapshot,
  getOfflineManifest,
} from "../../apps/api/src/offline/snapshots"
import { syncOfflineScans } from "../../apps/api/src/offline/sync"
import { reviewOfflineAdmission } from "../../apps/api/src/offline/review"

const { PDFDocument } = createRequire(
  new URL("../../apps/api/package.json", import.meta.url)
)("pdf-lib")

const eventId = "retained-event"
type D1Database = Awaited<ReturnType<Miniflare["getD1Database"]>>
type R2Bucket = Awaited<ReturnType<Miniflare["getR2Bucket"]>>
const owner = "rehearsal-owner"
const id = () => crypto.randomUUID()
const count = async (db: D1Database, table: string, where = "1") =>
  (await db
    .prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)
    .first<number>("n")) ?? 0
const noNetwork: EmailAdapter = {
  send: async () => {
    throw new Error("External email is forbidden in the restore rehearsal")
  },
  lookup: async () => {
    throw new Error(
      "External email lookup is forbidden in the restore rehearsal"
    )
  },
}
type DomainOrder = {
  buyer: string
  orderId: string
  paymentId: string
  provider: RecordedProvider
  ticketId?: string
}

/** Each invocation owns fresh in-memory provider state. It never opens another database. */
export function createBackupDomains({ resolveAdmissions = true } = {}) {
  const orders = new Map<string, DomainOrder>()
  let refundId: string
  let completedMail: DeliveryRow
  let originalPdf: string
  let signedManifest: OfflineSnapshotManifest
  let manifestJson: string
  let offlineInput: {
    requestId: string
    accountId: string
    deviceId: string
    units: OfflineSyncUnit[]
  }
  let conflictId: string
  let originalCheckin: string
  let privateJwk: string
  let fontBytes: Uint8Array
  const environment = (DB: D1Database, FILES: R2Bucket) => ({
    DB,
    FILES,
    APP_ORIGIN: "https://restore.example.invalid",
    EMAIL_FROM: "elc <tickets@example.test>",
    ENVIRONMENT: "local" as const,
    TICKET_ENCRYPTION_KEY: "A".repeat(43),
    OFFLINE_SIGNING_PRIVATE_JWK: privateJwk,
    OFFLINE_SIGNING_KEY_ID: "disposable-recovery-key",
  })
  const requireOrder = (name: string) => {
    const value = orders.get(name)
    assert.ok(value)
    return value
  }
  async function orderMail(db: D1Database, orderId: string, now: number) {
    const sourceId = await db
      .prepare(
        "SELECT id FROM outbox WHERE kind='order.completed' AND entity_id=?"
      )
      .bind(orderId)
      .first<string>("id")
    assert.ok(sourceId)
    await consumeNotificationOutbox({ DB: db }, sourceId, { now: () => now })
    const row = await db
      .prepare("SELECT * FROM email_deliveries WHERE source_id=?")
      .bind(sourceId)
      .first<DeliveryRow>()
    assert.ok(row)
    return row
  }
  async function deliver(
    db: D1Database,
    files: R2Bucket,
    row: DeliveryRow,
    now: number
  ) {
    const env = environment(db, files)
    const dependencies = {
      ...createDeliverySources(env, { fontBytes }),
      adapter: noNetwork,
      available: false,
      now: () => now,
    }
    await Promise.all(
      [0, 1].map(() =>
        consumeEmailDelivery(env, `email:${row.id}`, dependencies)
      )
    )
    await consumeEmailDelivery(env, `email:${row.id}`, dependencies)
    const result = await db
      .prepare("SELECT * FROM email_deliveries WHERE id=?")
      .bind(row.id)
      .first<DeliveryRow>()
    assert.ok(result)
    return result
  }
  async function pdfPayload(files: R2Bucket, row: DeliveryRow) {
    assert.ok(row.payload_key)
    const object = await files.get(row.payload_key)
    assert.ok(object)
    const payload = (await object.json()) as {
      request: { attachments: { content: string }[] }
    }
    const bytes = payload.request.attachments[0]?.content
    assert.ok(bytes)
    assert.equal(
      (await PDFDocument.load(Buffer.from(bytes, "base64"))).getPageCount(),
      1
    )
    return bytes
  }
  async function drainNotifications(
    db: D1Database,
    files: R2Bucket,
    now: number
  ) {
    let pendingSources = 0
    let sourceCount = 0
    let originalJobs: unknown
    let originalMailbox: unknown
    // The fixture is intentionally smaller than one fanout page. A second pass
    // replays every source and email job after all sends have become terminal.
    for (let replay = 0; replay < 2; replay++) {
      const sources = (
        await db
          .prepare("SELECT id,completed_at FROM outbox ORDER BY id LIMIT 101")
          .all<{ id: string; completed_at: number | null }>()
      ).results
      assert.ok(
        sources.length <= 100,
        "Notification fixture exceeded its bound"
      )
      let supported = 0
      for (const source of sources) {
        if (
          !(await consumeNotificationOutbox({ DB: db }, source.id, {
            now: () => now,
          }))
        )
          continue
        supported++
        if (replay === 0 && source.completed_at === null) pendingSources++
        assert.notEqual(
          await db
            .prepare("SELECT completed_at FROM outbox WHERE id=?")
            .bind(source.id)
            .first<number>("completed_at"),
          null,
          "Notification source did not finish fanout"
        )
      }
      if (replay === 0) sourceCount = supported
      else assert.equal(supported, sourceCount)
      const jobs = (
        await db
          .prepare("SELECT * FROM email_deliveries ORDER BY id LIMIT 51")
          .all<DeliveryRow>()
      ).results
      assert.ok(
        jobs.length > 3 && jobs.length <= 50,
        "Expected bounded non-ticket notifications"
      )
      for (const job of jobs) {
        const result = await deliver(db, files, job, now)
        assert.ok(
          ["delivered", "suppressed"].includes(result.email_state),
          "Notification delivery must finish or be canonically suppressed"
        )
        if (result.email_state === "delivered") {
          assert.equal(result.attempts, 1)
          assert.equal(
            await count(db, "development_mail", `id='email:${job.id}'`),
            1
          )
        } else
          assert.equal(
            await count(db, "development_mail", `id='email:${job.id}'`),
            0
          )
      }
      assert.equal(
        await count(db, "outbox", "kind='email.send' AND completed_at IS NULL"),
        0
      )
      const currentJobs = (
        await db
          .prepare(
            "SELECT id,email_state,attempts,provider_id,payload_hash FROM email_deliveries ORDER BY id"
          )
          .all()
      ).results
      const mailbox = (
        await db.prepare("SELECT id FROM development_mail ORDER BY id").all()
      ).results
      if (replay === 0) {
        originalJobs = currentJobs
        originalMailbox = mailbox
      } else {
        assert.deepEqual(currentJobs, originalJobs)
        assert.deepEqual(mailbox, originalMailbox)
      }
    }
    assert.ok(
      pendingSources > 0,
      "Expected unmaterialized notifications at recovery"
    )
    return {
      notificationSources: sourceCount,
      pendingSourcesReconciled: pendingSources,
      notificationJobs: await count(db, "email_deliveries"),
      localMail: await count(db, "development_mail"),
      unfinishedNotifications: 0,
    }
  }
  return {
    async seed({
      source: db,
      files,
      now,
    }: {
      source: D1Database
      files: R2Bucket
      now: number
    }) {
      fontBytes = new Uint8Array(
        await readFile(
          new URL(
            "../../apps/api/src/exports/assets/NotoSans-Regular.bin",
            import.meta.url
          )
        )
      )
      const keys = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"]
      )
      privateJwk = JSON.stringify(
        await crypto.subtle.exportKey("jwk", keys.privateKey)
      )
      await db
        .prepare(
          "UPDATE events SET publication_state='published',registration_opens_at=? WHERE id=?"
        )
        .bind(now - 3600000, eventId)
        .run()
      await db
        .prepare(
          "INSERT INTO ticket_types(id,event_id,name,kind,price_minor,quantity,sales_start_at,sales_end_at,updated_at) VALUES('restore-type',?,'Recovery admission','paid',10000,10,?,?,?)"
        )
        .bind(eventId, now - 3600000, now + 86400000, now)
        .run()
      await db
        .prepare(
          "INSERT INTO inventory(id,event_id,ticket_type_id) SELECT 'restore-slot-' || value,?,'restore-type' FROM json_each(?)"
        )
        .bind(eventId, JSON.stringify(Array.from({ length: 10 }, (_, i) => i)))
        .run()
      await activateTestEvent(db, eventId, owner, now - 900000)
      for (const name of [
        "delivered",
        "refunded",
        "pending-delivery",
        "pending-payment",
        "late-payment",
      ]) {
        const buyer = `restore-${name}`
        await db
          .prepare(
            "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)"
          )
          .bind(buyer, buyer, `${buyer}@example.test`, now, now)
          .run()
        const at = name === "late-payment" ? now - 600001 : now
        const checkout = await startCheckout(
          db,
          buyer,
          {
            eventId,
            requestId: id(),
            items: [
              {
                ticketTypeId: "restore-type",
                quantity: 1,
                attendeeNames: [`Synthetic ${name}`],
              },
            ],
          },
          { now: () => at }
        )
        const provider = new RecordedProvider()
        const payment = await startOrderPayment(
          environment(db, files),
          provider,
          buyer,
          checkout.order.id,
          { requestId: id(), expectedRevision: checkout.revision },
          { now: () => at }
        )
        const record: DomainOrder = {
          buyer,
          orderId: checkout.order.id,
          paymentId: payment.payment.id,
          provider,
        }
        if (!["pending-payment", "late-payment"].includes(name)) {
          provider.state = "succeeded"
          assert.equal(
            await processPayment(
              environment(db, files),
              provider,
              record.paymentId,
              { now: () => now }
            ),
            true
          )
          record.ticketId =
            (await db
              .prepare("SELECT id FROM tickets WHERE order_id=?")
              .bind(record.orderId)
              .first<string>("id")) ?? undefined
          assert.ok(record.ticketId)
        }
        orders.set(name, record)
      }
      // An actual completed PDF/email and another pending canonical-ticket delivery cross the backup boundary.
      const delivered = requireOrder("delivered")
      completedMail = await deliver(
        db,
        files,
        await orderMail(db, delivered.orderId, now),
        now
      )
      assert.equal(completedMail.email_state, "delivered")
      originalPdf = await pdfPayload(files, completedMail)
      const pending = await orderMail(
        db,
        requireOrder("pending-delivery").orderId,
        now
      )
      assert.equal(pending.email_state, "pending")

      const refunded = requireOrder("refunded")
      const support = await createSupportCase(
        db,
        refunded.buyer,
        {
          requestId: id(),
          audience: "attendee",
          category: "refund",
          subject: "Synthetic refund review",
          eventId,
          orderId: refunded.orderId,
          body: "Request a full demonstration refund.",
        },
        { now: () => now }
      )
      const revision = await db
        .prepare("SELECT revision FROM orders WHERE id=?")
        .bind(refunded.orderId)
        .first<number>("revision")
      const approval = await approveOrderRefund(
        db,
        owner,
        refunded.orderId,
        {
          requestId: id(),
          expectedRevision: revision,
          caseId: support.case.id,
          reason: "Approved synthetic recovery fixture",
        },
        { now: () => now }
      )
      refundId = approval.refundId
      refunded.provider.refundOutcome = "uncertain"
      await processRefund(db, refunded.provider, refundId, now)
      assert.equal(refunded.provider.refunds.length, 1)
      assert.equal(
        (
          await db
            .prepare("SELECT state FROM refunds WHERE id=?")
            .bind(refundId)
            .first<{ state: string }>()
        )?.state,
        "pending"
      )

      const devices = []
      for (const label of ["Recovery phone one", "Recovery phone two"]) {
        const device = await registerOfflineDevice(
          db,
          owner,
          eventId,
          { requestId: id(), label },
          { now: () => now }
        )
        const manifest = await issueOfflineSnapshot(
          environment(db, files),
          owner,
          eventId,
          { requestId: id(), deviceId: device.id },
          { now: () => now }
        )
        devices.push({ device, manifest })
      }
      const tokenHash = await db
        .prepare("SELECT token_hash FROM tickets WHERE id=?")
        .bind(delivered.ticketId)
        .first<string>("token_hash")
      assert.ok(tokenHash)
      for (const { device, manifest } of devices) {
        const input = {
          requestId: id(),
          accountId: owner,
          deviceId: device.id,
          units: [
            {
              scan: {
                kind: "scan" as const,
                operationId: id(),
                snapshotId: manifest.snapshotId,
                snapshotVersion: 1 as const,
                deviceTimestamp: new Date(now + 1).toISOString(),
                deviceSequence: 1,
                ticketId: delivered.ticketId!,
                tokenHash,
              },
            },
          ],
        }
        const response = await syncOfflineScans(db, owner, eventId, input, {
          now: () => now + 1,
        })
        if (response.results[0]?.result === "already_used") {
          offlineInput = input
          conflictId = input.units[0]!.scan.operationId
          signedManifest = manifest
        }
      }
      assert.ok(conflictId)
      assert.equal(
        await count(
          db,
          "offline_admission_reports",
          "review_state='unresolved'"
        ),
        1
      )
      originalCheckin = (await db
        .prepare(
          "SELECT id FROM checkins WHERE ticket_id=? AND reversed_at IS NULL"
        )
        .bind(delivered.ticketId)
        .first<string>("id"))!
      manifestJson = (await db
        .prepare("SELECT manifest_json FROM offline_snapshots WHERE id=?")
        .bind(signedManifest.snapshotId)
        .first<string>("manifest_json"))!
      assert.equal(await count(db, "orders"), 5)
      assert.equal(await count(db, "tickets"), 3)
      assert.equal(await count(db, "refunds"), 1)
      assert.equal(await count(db, "email_deliveries"), 2)
    },
    async afterExport() {
      // These provider successes have never issued tickets or email after the selected backup.
      requireOrder("pending-payment").provider.state = "succeeded"
      requireOrder("late-payment").provider.state = "succeeded"
    },
    async reconcile({
      restored: db,
      files,
      now,
    }: {
      restored: D1Database
      files: R2Bucket
      now: number
    }) {
      const env = environment(db, files)
      const at = now + 10000
      const ticketIdsBefore = (
        await db
          .prepare("SELECT id FROM tickets ORDER BY id")
          .all<{ id: string }>()
      ).results.map((row) => row.id)
      assert.equal(ticketIdsBefore.length, 3)
      assert.equal(await sweepExpiredReservations(env, { now: () => at }), 1)
      for (const record of orders.values()) {
        await processPayment(env, record.provider, record.paymentId, {
          now: () => at,
        })
        await processPayment(env, record.provider, record.paymentId, {
          now: () => at,
        })
        await consumePaymentOutbox(
          env,
          record.provider,
          `payment-reconcile:${record.paymentId}`
        )
      }
      const refunded = requireOrder("refunded")
      await processRefund(db, refunded.provider, refundId, at, {
        lookupOnly: true,
      })
      await processRefund(db, refunded.provider, refundId, at, {
        lookupOnly: true,
      })
      await consumePaymentOutbox(
        env,
        refunded.provider,
        `refund-reconcile:${refundId}`
      )
      assert.equal(
        refunded.provider.refunds.length,
        1,
        "Restore must look up the original uncertain refund, never resend it"
      )
      assert.ok(refunded.provider.refundLookups.length > 0)
      assert.equal(
        (
          await db
            .prepare("SELECT state FROM orders WHERE id=?")
            .bind(refunded.orderId)
            .first<{ state: string }>()
        )?.state,
        "refunded"
      )
      assert.equal(
        (
          await db
            .prepare("SELECT state FROM tickets WHERE id=?")
            .bind(refunded.ticketId)
            .first<{ state: string }>()
        )?.state,
        "refunded"
      )
      const late = requireOrder("late-payment")
      const lateRefund = await db
        .prepare("SELECT id FROM refunds WHERE payment_attempt_id=?")
        .bind(late.paymentId)
        .first<string>("id")
      assert.ok(lateRefund)
      await consumePaymentOutbox(
        env,
        late.provider,
        `refund-reconcile:${lateRefund}`
      )
      assert.equal(late.provider.refunds.length, 1)
      assert.equal(await count(db, "tickets", `order_id='${late.orderId}'`), 0)
      assert.equal(
        await count(db, "inventory", "reservation_id IS NOT NULL"),
        0
      )
      const currentTicketIds = (
        await db
          .prepare("SELECT id FROM tickets ORDER BY id")
          .all<{ id: string }>()
      ).results.map((row) => row.id)
      assert.equal(currentTicketIds.length, 4)
      for (const ticketId of ticketIdsBefore)
        assert.ok(currentTicketIds.includes(ticketId))

      assert.equal(await pdfPayload(files, completedMail), originalPdf)
      for (const name of ["delivered", "pending-delivery", "pending-payment"]) {
        const record = requireOrder(name)
        const job = await orderMail(db, record.orderId, at)
        const result = await deliver(db, files, job, at)
        assert.equal(result.email_state, "delivered")
        assert.equal(result.pdf_state, "ready")
        assert.equal(result.attempts, 1)
        assert.equal(
          await count(db, "development_mail", `id='email:${job.id}'`),
          1
        )
        await pdfPayload(files, result)
      }
      assert.equal(
        await count(db, "tickets"),
        4,
        "Delivery replay must never issue tickets"
      )
      assert.equal(await count(db, "email_deliveries"), 3)
      assert.equal(await count(db, "development_mail"), 3)
      const snapshot = await db
        .prepare(
          "SELECT manifest_json,invalidated_at FROM offline_snapshots WHERE id=?"
        )
        .bind(signedManifest.snapshotId)
        .first<{ manifest_json: string; invalidated_at: number }>()
      assert.equal(snapshot?.manifest_json, manifestJson)
      assert.equal(snapshot?.invalidated_at, now)
      await assert.rejects(
        getOfflineManifest(
          env,
          owner,
          eventId,
          signedManifest.snapshotId,
          () => at
        )
      )
      const replay = await syncOfflineScans(db, owner, eventId, offlineInput, {
        now: () => at,
      })
      assert.equal(replay.results[0]?.reviewState, "unresolved")
      assert.equal(await count(db, "offline_operations"), 2)
      if (resolveAdmissions) {
        const review = {
          requestId: id(),
          expectedRevision: 0,
          resolution: "admission_confirmed",
          reason:
            "Recovery review confirms the original canonical admission; duplicate device report adds no admission.",
        }
        const one = await reviewOfflineAdmission(
          db,
          owner,
          eventId,
          conflictId,
          review,
          { now: () => at }
        )
        const two = await reviewOfflineAdmission(
          db,
          owner,
          eventId,
          conflictId,
          review,
          { now: () => at }
        )
        assert.deepEqual(one, two)
        assert.equal(one.reviewState, "resolved")
      }
      assert.equal(await count(db, "checkins", "reversed_at IS NULL"), 1)
      assert.equal(
        (
          await db
            .prepare("SELECT id FROM checkins WHERE reversed_at IS NULL")
            .first<{ id: string }>()
        )?.id,
        originalCheckin
      )
      const notificationEvidence = await drainNotifications(db, files, at)
      const unresolved = await count(
        db,
        "offline_admission_reports",
        "review_state='unresolved'"
      )
      const payments = await count(db, "payment_attempts", "state='pending'")
      const refunds = await count(db, "refunds", "state<>'succeeded'")
      const deliveries = await count(
        db,
        "email_deliveries",
        "email_state IN ('pending','accepted','review_needed')"
      )
      assert.equal(payments, 0)
      assert.equal(refunds, 0)
      assert.equal(deliveries, 0)
      return {
        payments: { complete: true, unresolved: payments },
        refunds: { complete: true, unresolved: refunds },
        deliveries: { complete: true, unresolved: deliveries },
        admissions: { complete: unresolved === 0, unresolved },
        files: { complete: true, unresolved: 0 },
        dataLossReport:
          "The synthetic title edit after the backup was lost and preserved in the pre-restore export. Existing ticket IDs and one canonical admission were preserved. Later synthetic provider success had never issued tickets; provider status alone cannot recover ticket identities, delivered messages, or unsynced physical admissions lost after a real backup.",
        evidence: {
          orders: 5,
          preservedTicketIds: ticketIdsBefore.length,
          ticketsAfterReconciliation: currentTicketIds.length,
          confirmedRefunds: 2,
          originalRefundDispatches: refunded.provider.refunds.length,
          lateCompensationDispatches: late.provider.refunds.length,
          ...notificationEvidence,
          validPdfs: 3,
          offlineOperations: 2,
          canonicalAdmissions: 1,
          unresolvedAdmissions: unresolved,
          snapshotsRejected: true,
          retriesPreservedIdentity: true,
        },
      }
    },
  }
}
