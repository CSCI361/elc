import { readFile } from "node:fs/promises"
import { Buffer } from "node:buffer"
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { PDFDocument } from "pdf-lib"
import { createExportFixture } from "../exports/test-fixture"
import { consumeNotificationOutbox } from "./fanout"
import { consumeEmailDelivery, type DeliveryRow } from "./jobs"
import { createDeliverySources } from "./sources"
import type { EmailAdapter } from "./email"

const fontBytes = new Uint8Array(
  await readFile(
    new URL("../exports/assets/NotoSans-Regular.bin", import.meta.url)
  )
)
describe("completed order through fanout, canonical PDF and local delivery", () => {
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
    ENVIRONMENT: "local" as const,
  })
  async function expand() {
    const source = await fixture.db
      .prepare(
        "SELECT id FROM outbox WHERE kind='order.completed' AND entity_id=?"
      )
      .bind(fixture.orderId)
      .first<string>("id")
    expect(source).toBeTruthy()
    await Promise.all([
      consumeNotificationOutbox(environment(), source!),
      consumeNotificationOutbox(environment(), source!),
    ])
    const rows = (
      await fixture.db
        .prepare("SELECT * FROM email_deliveries WHERE source_id=?")
        .bind(source)
        .all<DeliveryRow>()
    ).results
    expect(rows).toHaveLength(1)
    return rows[0]!
  }
  const noNetwork: EmailAdapter = {
    send: async () => {
      throw new Error("Local delivery must not call the external adapter")
    },
    lookup: async () => {
      throw new Error("Local delivery must not call the external adapter")
    },
  }
  it("delivers the purchaser's saved language and existing PDF once across duplicate queue deliveries", async () => {
    await fixture.db
      .prepare(
        "INSERT INTO profiles(user_id,locale,updated_at) VALUES ('buyer','ru',?)"
      )
      .bind(Date.now())
      .run()
    const job = await expand()
    const env = environment()
    const dependencies = {
      ...createDeliverySources(env, { fontBytes }),
      adapter: noNetwork,
      available: false,
    }
    await Promise.all([
      consumeEmailDelivery(env, `email:${job.id}`, dependencies),
      consumeEmailDelivery(env, `email:${job.id}`, dependencies),
    ])
    await consumeEmailDelivery(env, `email:${job.id}`, dependencies)
    const saved = await fixture.db
      .prepare("SELECT * FROM email_deliveries WHERE id=?")
      .bind(job.id)
      .first<DeliveryRow>()
    expect(saved).toMatchObject({
      pdf_state: "ready",
      email_state: "delivered",
      attempts: 1,
    })
    const payload = await (await fixture.files.get(saved!.payload_key!))!.json<{
      request: {
        text: string
        subject: string
        to: string
        attachments: { filename: string; content: string }[]
      }
    }>()
    expect(payload.request.to).toBe("buyer@example.test")
    expect(payload.request.attachments).toHaveLength(1)
    expect(payload.request.attachments[0]!.filename).toMatch(/-ru\.pdf$/)
    expect(
      (
        await PDFDocument.load(
          Buffer.from(payload.request.attachments[0]!.content, "base64")
        )
      ).getPageCount()
    ).toBe(1)
    expect(payload.request.text).toContain(`/orders/${fixture.orderId}`)
    expect(
      await fixture.db
        .prepare(
          "SELECT recipient,subject,body FROM development_mail WHERE id=?"
        )
        .bind(`email:${job.id}`)
        .first()
    ).toEqual({
      recipient: payload.request.to,
      subject: payload.request.subject,
      body: payload.request.text,
    })
    expect(
      (
        await fixture.db
          .prepare("SELECT count(*) count FROM development_mail WHERE id=?")
          .bind(`email:${job.id}`)
          .first()
      )?.count
    ).toBe(1)
    expect(
      (
        await fixture.db
          .prepare("SELECT count(*) count FROM tickets WHERE order_id=?")
          .bind(fixture.orderId)
          .first()
      )?.count
    ).toBe(1)
    expect(
      (
        await fixture.db
          .prepare("SELECT state FROM orders WHERE id=?")
          .bind(fixture.orderId)
          .first()
      )?.state
    ).toBe("completed")
  })
  it("suppresses a queued recipient whose account was revoked without undoing the completed order", async () => {
    const job = await expand()
    await fixture.db
      .prepare("UPDATE user SET email_verified=0 WHERE id='buyer'")
      .run()
    const env = environment()
    await consumeEmailDelivery(env, `email:${job.id}`, {
      ...createDeliverySources(env, { fontBytes }),
      adapter: noNetwork,
      available: false,
    })
    expect(
      await fixture.db
        .prepare(
          "SELECT email_state,first_attempt_at FROM email_deliveries WHERE id=?"
        )
        .bind(job.id)
        .first()
    ).toEqual({ email_state: "suppressed", first_attempt_at: null })
    expect(
      (
        await fixture.db
          .prepare("SELECT count(*) count FROM development_mail WHERE id=?")
          .bind(`email:${job.id}`)
          .first()
      )?.count
    ).toBe(0)
    expect(
      (
        await fixture.db
          .prepare("SELECT state FROM orders WHERE id=?")
          .bind(fixture.orderId)
          .first()
      )?.state
    ).toBe("completed")
  })
})
