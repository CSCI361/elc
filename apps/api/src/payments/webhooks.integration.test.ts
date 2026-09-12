import {
  type VerifiedPaymentEvent,
  type VerifiedProviderEvent,
  type VerifiedRefundEvent,
} from "@elc/shared"
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { readCheckout } from "../orders/lifecycle"
import { consumePaymentOutbox, dispatchPaymentOutbox } from "./outbox"
import { loadPayment } from "./store"
import { createPaymentFixture } from "./test-fixture"
import { acceptProviderWebhook } from "./webhooks"

const headers = { "fixture-signature": "verified" }

describe("D1 provider webhook ingestion and payment outbox", () => {
  let fixture: Awaited<ReturnType<typeof createPaymentFixture>>
  beforeEach(async () => {
    fixture = await createPaymentFixture()
  })
  afterEach(async () => {
    await fixture?.runtime.dispose()
  })

  const paymentEvent = (id = "event-paid"): VerifiedPaymentEvent => ({
    ...fixture.provider.status(fixture.binding),
    kind: "payment",
    providerEventId: id,
  })
  const accept = (event: VerifiedProviderEvent) =>
    acceptProviderWebhook(
      fixture.db,
      fixture.provider,
      JSON.stringify(event),
      headers
    )
  const eventOutboxId = async (providerEventId: string) => {
    const id = await fixture.db
      .prepare(
        "SELECT o.id FROM outbox o JOIN provider_events p ON p.id = o.entity_id WHERE o.kind = 'provider.event' AND p.provider_event_id = ?"
      )
      .bind(providerEventId)
      .first<string>("id")
    if (!id) throw new Error("Missing provider event outbox fixture")
    return id
  }
  const job = (id: string) =>
    fixture.db
      .prepare(
        "SELECT completed_at, attempts, dispatched_at, next_attempt_at FROM outbox WHERE id = ?"
      )
      .bind(id)
      .first<{
        completed_at: number | null
        attempts: number
        dispatched_at: number | null
        next_attempt_at: number
      }>()

  it("durably acknowledges duplicate verified events without lookup or ticket issuance", async () => {
    const { provider, db, scalar, paymentId } = fixture
    provider.state = "succeeded"
    const body = JSON.stringify(paymentEvent())
    const lookupsBefore = provider.lookups.length
    expect(
      await Promise.all(
        [1, 2, 3].map(() => acceptProviderWebhook(db, provider, body, headers))
      )
    ).toEqual([{ accepted: true }, { accepted: true }, { accepted: true }])
    expect(await scalar("SELECT count(*) AS n FROM provider_events")).toBe(1)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM outbox WHERE kind = 'provider.event'"
      )
    ).toBe(1)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM provider_events WHERE processed_at IS NOT NULL"
      )
    ).toBe(0)
    expect(await scalar("SELECT count(*) AS n FROM tickets")).toBe(0)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM audit_entries WHERE action = 'payment.succeeded'"
      )
    ).toBe(0)
    expect((await loadPayment(db, paymentId)).state).toBe("pending")
    expect(provider.lookups).toHaveLength(lookupsBefore)
    expect(provider.creates).toHaveLength(1)
  })

  it("rejects a failed signature and mismatched frozen binding without durable event writes", async () => {
    const { provider, db, scalar, paymentId } = fixture
    provider.state = "succeeded"
    await expect(
      acceptProviderWebhook(db, provider, JSON.stringify(paymentEvent()), {})
    ).rejects.toMatchObject({ code: "INVALID_WEBHOOK" })
    for (const change of [
      { amountMinor: fixture.binding.amountMinor + 1 },
      { accountId: "different-account" },
      { subjectId: "different-order" },
      { requestHash: "f".repeat(64) },
      { providerPaymentId: "different-checkout" },
    ])
      await expect(
        accept({ ...paymentEvent(), ...change })
      ).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" })
    expect(await scalar("SELECT count(*) AS n FROM provider_events")).toBe(0)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM outbox WHERE kind = 'provider.event'"
      )
    ).toBe(0)
    expect(await scalar("SELECT count(*) AS n FROM tickets")).toBe(0)
    expect((await loadPayment(db, paymentId)).state).toBe("pending")
  })

  it("rejects a reused provider event identifier with changed contents and preserves the first event", async () => {
    fixture.provider.state = "succeeded"
    const event = paymentEvent()
    await accept(event)
    await expect(accept({ ...event, state: "failed" })).rejects.toMatchObject({
      code: "CONFLICT",
    })
    const stored = await fixture.db
      .prepare("SELECT payload_json FROM provider_events")
      .first<string>("payload_json")
    expect(JSON.parse(stored!)).toEqual(event)
    expect(
      await fixture.scalar("SELECT count(*) AS n FROM provider_events")
    ).toBe(1)
    expect(
      await fixture.scalar(
        "SELECT count(*) AS n FROM outbox WHERE kind = 'provider.event'"
      )
    ).toBe(1)
    expect(await fixture.scalar("SELECT count(*) AS n FROM tickets")).toBe(0)
  })

  it("ignores an unsupported verified event without creating work", async () => {
    expect(
      await acceptProviderWebhook(
        fixture.db,
        fixture.provider,
        "ignored",
        headers
      )
    ).toEqual({ accepted: true })
    expect(
      await fixture.scalar("SELECT count(*) AS n FROM provider_events")
    ).toBe(0)
    expect(
      await fixture.scalar(
        "SELECT count(*) AS n FROM outbox WHERE kind = 'provider.event'"
      )
    ).toBe(0)
  })

  it("rolls the received event back if its durable outbox insertion fails", async () => {
    await fixture.db
      .prepare(`CREATE TRIGGER reject_fixture_event_outbox BEFORE INSERT ON outbox
      WHEN NEW.kind = 'provider.event' BEGIN SELECT RAISE(ABORT, 'Synthetic outbox write failure'); END`)
      .run()
    await expect(accept(paymentEvent())).rejects.toThrow(
      "Synthetic outbox write failure"
    )
    expect(
      await fixture.scalar("SELECT count(*) AS n FROM provider_events")
    ).toBe(0)
    expect(
      await fixture.scalar(
        "SELECT count(*) AS n FROM outbox WHERE kind = 'provider.event'"
      )
    ).toBe(0)
    await fixture.db.prepare("DROP TRIGGER reject_fixture_event_outbox").run()
    expect(await accept(paymentEvent())).toEqual({ accepted: true })
    expect(
      await fixture.scalar("SELECT count(*) AS n FROM provider_events")
    ).toBe(1)
    expect(
      await fixture.scalar(
        "SELECT count(*) AS n FROM outbox WHERE kind = 'provider.event'"
      )
    ).toBe(1)
  })

  it("uses authoritative lookup instead of a payment webhook's success claim", async () => {
    const event = {
      ...paymentEvent(),
      state: "succeeded" as const,
      providerOrderId: `order-${fixture.paymentId}`,
    }
    await accept(event)
    const id = await eventOutboxId(event.providerEventId)
    expect(await consumePaymentOutbox(fixture.env, fixture.provider, id)).toBe(
      true
    )
    expect((await job(id))?.completed_at).toBeNull()
    expect((await job(id))?.attempts).toBe(1)
    expect((await loadPayment(fixture.db, fixture.paymentId)).state).toBe(
      "pending"
    )
    expect(await fixture.scalar("SELECT count(*) AS n FROM tickets")).toBe(0)
    fixture.provider.state = "succeeded"
    expect(await consumePaymentOutbox(fixture.env, fixture.provider, id)).toBe(
      true
    )
    expect((await job(id))?.completed_at).not.toBeNull()
    expect(await fixture.scalar("SELECT count(*) AS n FROM tickets")).toBe(1)
  })

  it("retains outbox work after queue failure and replays duplicate delivery without another financial POST", async () => {
    const { db, env, provider, scalar, paymentOutboxId, now } = fixture
    const delivered: { id: string }[] = []
    let fail = true
    const queue = {
      send: async (body: { id: string }) => {
        if (fail) throw new Error("Synthetic queue failure")
        delivered.push(body)
      },
    } as unknown as Queue
    await dispatchPaymentOutbox({ DB: db, DELIVERY: queue }, now + 1)
    expect(delivered).toHaveLength(0)
    expect((await job(paymentOutboxId))?.dispatched_at).toBeNull()
    expect((await job(paymentOutboxId))?.completed_at).toBeNull()
    fail = false
    await dispatchPaymentOutbox({ DB: db, DELIVERY: queue }, now + 2)
    expect(delivered).toEqual([{ id: paymentOutboxId }])
    expect((await job(paymentOutboxId))?.dispatched_at).toBe(now + 2)
    provider.state = "succeeded"
    expect(
      await Promise.all(
        [1, 2, 3].map(() =>
          consumePaymentOutbox(env, provider, paymentOutboxId)
        )
      )
    ).toEqual([true, true, true])
    expect((await job(paymentOutboxId))?.completed_at).not.toBeNull()
    expect(provider.creates).toHaveLength(1)
    expect(await scalar("SELECT count(*) AS n FROM tickets")).toBe(1)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM outbox WHERE kind = 'order.completed'"
      )
    ).toBe(1)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM audit_entries WHERE action = 'payment.succeeded'"
      )
    ).toBe(1)
    const lookupCount = provider.lookups.length
    await consumePaymentOutbox(env, provider, paymentOutboxId)
    expect(provider.lookups).toHaveLength(lookupCount)
    await dispatchPaymentOutbox({ DB: db, DELIVERY: queue }, now + 120000)
    expect(delivered).toHaveLength(1)
  })

  it("rearms completed reconciliation for a late checkout event with no order ID", async () => {
    const { provider, env, paymentOutboxId, db, paymentId, scalar } = fixture
    provider.state = "succeeded"
    await consumePaymentOutbox(env, provider, paymentOutboxId)
    const orderId = (await loadPayment(db, paymentId)).provider_order_id
    expect((await job(paymentOutboxId))?.completed_at).not.toBeNull()
    await expect(
      accept({
        ...paymentEvent("wrong-order"),
        providerOrderId: "different-order",
      })
    ).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" })
    expect((await job(paymentOutboxId))?.completed_at).not.toBeNull()
    const late = {
      ...paymentEvent("late-checkout"),
      providerOrderId: null,
      state: "pending" as const,
    }
    expect(await accept(late)).toEqual({ accepted: true })
    expect((await job(paymentOutboxId))?.completed_at).toBeNull()
    await Promise.all([
      consumePaymentOutbox(env, provider, paymentOutboxId),
      consumePaymentOutbox(
        env,
        provider,
        await eventOutboxId(late.providerEventId)
      ),
    ])
    expect((await loadPayment(db, paymentId)).provider_order_id).toBe(orderId)
    expect((await loadPayment(db, paymentId)).state).toBe("succeeded")
    expect(await scalar("SELECT count(*) AS n FROM tickets")).toBe(1)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM outbox WHERE kind = 'order.completed'"
      )
    ).toBe(1)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM provider_events WHERE processed_at IS NOT NULL"
      )
    ).toBe(1)
  })

  it("persists worker failures for a later sweep and completes after the failed dependency recovers", async () => {
    const { provider, env, paymentOutboxId, db, paymentId } = fixture
    provider.overrideStatus = { amountMinor: fixture.binding.amountMinor + 1 }
    expect(await consumePaymentOutbox(env, provider, paymentOutboxId)).toBe(
      true
    )
    const pending = await job(paymentOutboxId)
    expect(pending?.completed_at).toBeNull()
    expect(pending?.attempts).toBe(1)
    expect(pending?.next_attempt_at).toBeGreaterThan(fixture.now)
    expect((await loadPayment(db, paymentId)).state).toBe("pending")
    provider.overrideStatus = {}
    provider.state = "succeeded"
    await consumePaymentOutbox(env, provider, paymentOutboxId)
    expect((await job(paymentOutboxId))?.completed_at).not.toBeNull()
    expect(await fixture.scalar("SELECT count(*) AS n FROM tickets")).toBe(1)
  })

  it("keeps a succeeded refund closed when pending refund and old payment events arrive later", async () => {
    const {
      provider,
      db,
      env,
      scalar,
      paymentId,
      paymentOutboxId,
      binding,
      now,
      checkout,
    } = fixture
    provider.state = "succeeded"
    await consumePaymentOutbox(env, provider, paymentOutboxId)
    const refundId = crypto.randomUUID()
    const refundRequest = {
      refundId,
      providerPaymentId: `checkout-${paymentId}`,
      providerOrderId: `order-${paymentId}`,
      idempotencyKey: refundId,
      expected: binding,
      amountMinor: binding.amountMinor,
      currency: "KZT",
      reason: "event_cancelled",
    }
    await db
      .prepare(
        "INSERT INTO refunds (id, payment_attempt_id, reason, amount_minor, request_json, created_at) VALUES (?, ?, 'event_cancelled', ?, ?, ?)"
      )
      .bind(
        refundId,
        paymentId,
        binding.amountMinor,
        JSON.stringify(refundRequest),
        now
      )
      .run()
    const event: VerifiedRefundEvent = {
      ...binding,
      kind: "refund",
      providerEventId: "refund-succeeded",
      providerPaymentId: `checkout-${paymentId}`,
      providerOrderId: `order-${paymentId}`,
      providerRefundId: `refund-${refundId}`,
      refundId,
      state: "succeeded",
    }
    await accept(event)
    // Acknowledging the event has not yet changed canonical admission.
    expect(
      await scalar("SELECT count(*) AS n FROM tickets WHERE state = 'valid'")
    ).toBe(1)
    provider.refundedAmount = binding.amountMinor
    await consumePaymentOutbox(
      env,
      provider,
      await eventOutboxId(event.providerEventId)
    )
    const pending = {
      ...event,
      providerEventId: "refund-pending-late",
      state: "pending" as const,
    }
    await accept(pending)
    await consumePaymentOutbox(
      env,
      provider,
      await eventOutboxId(pending.providerEventId)
    )
    await accept(paymentEvent("old-payment"))
    await consumePaymentOutbox(
      env,
      provider,
      await eventOutboxId("old-payment")
    )
    await consumePaymentOutbox(env, provider, paymentOutboxId)
    expect(
      (await readCheckout(db, "buyer", checkout.order.id)).order.state
    ).toBe("refunded")
    expect(
      await scalar("SELECT count(*) AS n FROM tickets WHERE state = 'valid'")
    ).toBe(0)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM refunds WHERE state = 'succeeded'"
      )
    ).toBe(1)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM audit_entries WHERE action = 'refund.succeeded'"
      )
    ).toBe(1)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM outbox WHERE kind = 'refund.changed'"
      )
    ).toBe(1)
    expect(
      await scalar(
        "SELECT count(*) AS n FROM outbox WHERE kind = 'order.completed'"
      )
    ).toBe(1)
    expect(provider.refunds).toHaveLength(0)
    expect(provider.creates).toHaveLength(1)
  })
})
