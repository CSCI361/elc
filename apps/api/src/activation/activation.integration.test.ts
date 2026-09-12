import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"
import {
  activationResponseSchema,
  DEMO_PAID_TERMS_VERSION,
  updateActivationSchema,
  type PaymentAdapter,
} from "@elc/shared"
import { createAuthTestDatabase } from "../auth/test-database"
import { ApiFailure } from "../db/transitions"
import type { Bindings } from "../env"
import { recordPaymentStatus, processPayment } from "../payments/reconcile"
import { ensureCompensation } from "../payments/refunds"
import {
  checkoutRequest,
  claimPaymentDispatch,
  loadPayment,
  paymentBinding,
} from "../payments/store"
import { completeActivation } from "./complete"
import { activationEligibilitySql, paidSalesEligibilitySql } from "./guards"
import { createActivationRoutes } from "./index"
import {
  moderateActivation,
  updateActivation,
  updateActivationSettings,
} from "./mutations"
import { prepareActivationPayment, startActivationPayment } from "./payment"
import { loadActivation, readActivation, readActivationSettings } from "./store"

describe("paid-sales activation transitions on D1", () => {
  let fixture: Awaited<ReturnType<typeof createAuthTestDatabase>>
  let db: D1Database
  let now: number
  const clock = () => now
  const environment = () => ({
    DB: db,
    APP_ORIGIN: "https://app.example.test",
    TICKET_ENCRYPTION_KEY: "A".repeat(43),
  })
  const change = (expectedRevision: number) => ({
    requestId: crypto.randomUUID(),
    expectedRevision,
  })
  const checklist = (
    expectedRevision = 0,
    overrides: Record<string, unknown> = {}
  ) => ({
    ...change(expectedRevision),
    profile: {
      displayName: "Campus organizer",
      legalName: "Demo Organizer",
      contact: "demo@example.test",
      dummyPayoutReference: "DEMO-CAMPUS",
    },
    identityCheck: "passed",
    payoutCheck: "passed",
    acceptedTermsVersion: DEMO_PAID_TERMS_VERSION,
    ...overrides,
  })
  const count = (table: string) =>
    db.prepare(`SELECT count(*) AS n FROM ${table}`).first<number>("n")
  const completedCount = () =>
    db
      .prepare(
        "SELECT count(*) AS n FROM audit_entries WHERE action = 'activation.completed'"
      )
      .first<number>("n")
  async function ready(eventId = "event") {
    return updateActivation(db, "owner", eventId, checklist(), { now: clock })
  }
  async function prepared(eventId = "event") {
    const saved = await ready(eventId)
    return prepareActivationPayment(
      environment(),
      "owner",
      eventId,
      change(saved.activation.revision),
      { now: clock }
    )
  }
  async function paid(eventId = "event") {
    const result = await prepared(eventId)
    await succeed(result.payment.id)
    return result.payment.id
  }
  async function succeed(id: string) {
    const row = await loadPayment(db, id)
    await recordPaymentStatus(
      db,
      {
        ...paymentBinding(row),
        providerPaymentId: `checkout-${id}`,
        providerOrderId: `order-${id}`,
        state: "succeeded",
        refundedAmountMinor: 0,
      },
      now
    )
  }
  function adapter() {
    return {
      createCheckout: vi.fn(async (request) => ({
        providerPaymentId: `checkout-${request.paymentAttemptId}`,
        checkoutUrl: "https://sandbox.polar.sh/checkout/test",
      })),
      recoverCheckout: vi.fn(async () => null),
      lookupPayment: vi.fn(async (request) => ({
        ...request.expected,
        providerPaymentId: request.providerPaymentId,
        providerOrderId: `order-${request.expected.paymentAttemptId}`,
        state: "succeeded",
        refundedAmountMinor: 0,
      })),
      refund: vi.fn(async (request) => ({
        ...request.expected,
        refundId: request.refundId,
        providerPaymentId: request.providerPaymentId,
        providerOrderId: request.providerOrderId,
        providerRefundId: `provider-${request.refundId}`,
        state: "succeeded",
      })),
      lookupRefund: vi.fn(async () => null),
      verifyWebhook: vi.fn(async () => null),
    } satisfies PaymentAdapter
  }

  beforeEach(async () => {
    fixture = await createAuthTestDatabase()
    db = fixture.DB
    now = Date.now()
    for (const id of ["owner", "other", "staff", "admin"])
      await db
        .prepare(
          "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
        )
        .bind(id, id, `${id}@example.test`, now, now)
        .run()
    await db
      .prepare(
        "INSERT INTO platform_grants (user_id, permission, granted_at) VALUES ('admin', 'platform:configure', ?), ('admin', 'platform:moderate', ?)"
      )
      .bind(now, now)
      .run()
    for (const id of ["event", "event-two"]) {
      await db
        .prepare(`INSERT INTO events (id, organizer_id, title, description, category, venue_name, venue_address,
        starts_at, ends_at, registration_opens_at, registration_closes_at, capacity, max_tickets_per_order,
        calendar_uid, reporting_id, created_at, updated_at) VALUES (?, 'owner', 'Demo', 'Demo event', 'Music', 'Hall', 'Address', ?, ?, ?, ?, 4, 4, ?, ?, ?, ?)`)
        .bind(
          id,
          now + 3_600_000,
          now + 7_200_000,
          now - 3_600_000,
          now + 3_600_000,
          `${id}-calendar`,
          `${id}-report`,
          now,
          now
        )
        .run()
      await db
        .prepare(
          "INSERT INTO ticket_types (id, event_id, name, kind, price_minor, quantity, sales_start_at, sales_end_at, updated_at) VALUES (?, ?, 'Paid admission', 'paid', 300000, 4, ?, ?, ?)"
        )
        .bind(`${id}-type`, id, now - 3_600_000, now + 3_600_000, now)
        .run()
    }
    await db
      .prepare(
        "INSERT INTO event_permissions (event_id, user_id, permission, granted_at) VALUES ('event', 'staff', 'event:manage', ?)"
      )
      .bind(now)
      .run()
  })
  afterEach(async () => {
    await fixture?.runtime.dispose()
  })

  it("reads the seeded fee and incomplete checklist without creating activation records", async () => {
    expect(await readActivationSettings(db)).toEqual({
      feeMinor: 500_000,
      currency: "KZT",
      revision: 0,
    })
    const result = await readActivation(db, "event", "owner", now)
    expect(result.activation).toMatchObject({
      revision: 0,
      eligibility: "pending",
      profile: null,
      terms: { version: DEMO_PAID_TERMS_VERSION, acceptedAt: null },
      fee: { configuredMinor: 500_000, successfulPaymentAttemptId: null },
    })
    expect(result.activation.blockers).toContain("fee_required")
    expect(await count("event_activations")).toBe(0)
  })

  it("records every simulated result and versioned terms timestamp once under duplicate updates", async () => {
    const input = checklist()
    const results = await Promise.all(
      [1, 2].map(() =>
        updateActivation(db, "owner", "event", input, { now: clock })
      )
    )
    expect(results[0]).toEqual(results[1])
    expect(results[0]?.activation).toMatchObject({
      revision: 1,
      identityCheck: {
        state: "passed",
        checkedAt: new Date(now).toISOString(),
      },
      terms: {
        acceptedVersion: DEMO_PAID_TERMS_VERSION,
        acceptedAt: new Date(now).toISOString(),
      },
    })
    now += 1000
    await updateActivation(
      db,
      "owner",
      "event",
      checklist(1, { identityCheck: "failed", acceptedTermsVersion: null }),
      { now: clock }
    )
    expect(await count("activation_checklist_history")).toBe(2)
    const saved = await readActivation(db, "event", "owner", now)
    expect(saved.activation.blockers).toEqual(
      expect.arrayContaining([
        "identity_check",
        "terms_required",
        "fee_required",
      ])
    )
    expect(saved.activation.terms.acceptedAt).toBeNull()
    await expect(
      db
        .prepare(
          "UPDATE activation_checklist_history SET checklist_json = '{}' WHERE event_id = 'event'"
        )
        .run()
    ).rejects.toThrow("immutable_activation_history")
    await expect(
      updateActivation(
        db,
        "owner",
        "event",
        { ...input, identityCheck: "failed" },
        { now: clock }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })

  it.each(["other", "staff", "admin"])(
    "does not grant owner activation writes to %s",
    async (actorId) => {
      await expect(
        updateActivation(db, actorId, "event", checklist(), { now: clock })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
      await expect(
        prepareActivationPayment(environment(), actorId, "event", change(0), {
          now: clock,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
      expect(await count("event_activations")).toBe(0)
    }
  )

  it("rejects real-looking payout references and unsupported terms before writing", async () => {
    expect(
      updateActivationSchema.safeParse(
        checklist(0, { acceptedTermsVersion: "future-terms" })
      ).success
    ).toBe(false)
    await expect(
      updateActivation(
        db,
        "owner",
        "event",
        checklist(0, {
          profile: {
            ...checklist().profile,
            dummyPayoutReference: "KZ123456789012345678",
          },
        }),
        { now: clock }
      )
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
    expect(await count("activation_checklist_history")).toBe(0)
  })

  it.each([
    "identity",
    "payout",
    "terms",
    "no_paid_type",
    "event_cancelled",
    "owner_unverified",
  ])("does not prepare a fee while %s is incomplete", async (condition) => {
    await updateActivation(
      db,
      "owner",
      "event",
      checklist(
        0,
        condition === "identity"
          ? { identityCheck: "failed" }
          : condition === "payout"
            ? { payoutCheck: "failed" }
            : condition === "terms"
              ? { acceptedTermsVersion: null }
              : {}
      ),
      { now: clock }
    )
    if (condition === "no_paid_type")
      await db
        .prepare(
          "UPDATE ticket_types SET kind = 'free', price_minor = 0 WHERE event_id = 'event'"
        )
        .run()
    if (condition === "event_cancelled")
      await db
        .prepare("UPDATE events SET cancelled_at = ? WHERE id = 'event'")
        .bind(now)
        .run()
    if (condition === "owner_unverified")
      await db
        .prepare("UPDATE user SET email_verified = 0 WHERE id = 'owner'")
        .run()
    await expect(
      prepareActivationPayment(environment(), "owner", "event", change(1), {
        now: clock,
      })
    ).rejects.toBeInstanceOf(HTTPException)
    expect(await count("payment_attempts")).toBe(0)
  })

  it("freezes the fee, checklist and request identity atomically under concurrent preparation", async () => {
    await ready()
    const input = change(1)
    const results = await Promise.all(
      [1, 2].map(() =>
        prepareActivationPayment(environment(), "owner", "event", input, {
          now: clock,
        })
      )
    )
    expect(results[0]).toEqual(results[1])
    expect(await count("payment_attempts")).toBe(1)
    expect(await count("activation_attempts")).toBe(1)
    const paymentId = results[0]!.payment.id
    const row = await loadPayment(db, paymentId)
    expect(checkoutRequest(row)).toMatchObject({
      purpose: "event_activation",
      subjectId: "event",
      accountId: "owner",
      amountMinor: 500_000,
      currency: "KZT",
      customerEmail: "owner@example.test",
    })
    const snapshot = await db
      .prepare("SELECT * FROM activation_attempts WHERE payment_attempt_id = ?")
      .bind(paymentId)
      .first<{
        checklist_revision: number
        fee_minor: number
        checklist_snapshot_json: string
      }>()
    expect(snapshot?.checklist_revision).toBe(1)
    expect(JSON.parse(snapshot!.checklist_snapshot_json).terms_version).toBe(
      DEMO_PAID_TERMS_VERSION
    )
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM outbox WHERE kind = 'payment.reconcile'"
        )
        .first("n")
    ).toBe(1)
    await expect(
      db
        .prepare(
          "UPDATE activation_attempts SET fee_minor = 400000 WHERE payment_attempt_id = ?"
        )
        .bind(paymentId)
        .run()
    ).rejects.toThrow("immutable_activation_attempt")
  })

  it("rechecks owner verification and fee configuration inside payment preparation", async () => {
    await ready()
    await expect(
      prepareActivationPayment(environment(), "owner", "event", change(1), {
        now: clock,
        beforeCommit: async () => {
          await updateActivationSettings(
            db,
            "admin",
            { ...change(0), feeMinor: 600_000 },
            { now: clock }
          )
        },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(await count("payment_attempts")).toBe(0)
    await expect(
      prepareActivationPayment(environment(), "owner", "event", change(1), {
        now: clock,
        beforeCommit: async () => {
          await db
            .prepare("UPDATE user SET email_verified = 0 WHERE id = 'owner'")
            .run()
        },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(await count("activation_attempts")).toBe(0)
  })

  it("retains the fee snapshot when an administrator changes the price after preparation", async () => {
    const paymentId = await paid()
    await updateActivationSettings(
      db,
      "admin",
      { ...change(0), feeMinor: 650_000 },
      { now: clock }
    )
    await completeActivation(db, paymentId, { now: clock })
    const current = await readActivation(db, "event", "owner", now)
    expect(current.activation.fee).toMatchObject({
      configuredMinor: 650_000,
      paidMinor: 500_000,
      successfulPaymentAttemptId: paymentId,
      refundable: false,
    })
    const other = await prepared("event-two")
    expect(other.payment.amountMinor).toBe(650_000)
  })

  it("completes once and replays the retained fee after suspension or cancellation", async () => {
    const paymentId = await paid()
    const results = await Promise.all(
      [1, 2].map(() => completeActivation(db, paymentId, { now: clock }))
    )
    expect(results[0]).toEqual(results[1])
    expect(await completedCount()).toBe(1)
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM outbox WHERE kind = 'activation.completed'"
        )
        .first("n")
    ).toBe(1)
    const completed = results[0]
    await moderateActivation(
      db,
      "admin",
      "event",
      { ...change(2), suspended: true, reason: "Controlled demo suspension" },
      { now: clock }
    )
    await db
      .prepare("UPDATE events SET cancelled_at = ? WHERE id = 'event'")
      .bind(now)
      .run()
    expect(await completeActivation(db, paymentId, { now: clock })).toEqual(
      completed
    )
    const retry = await prepareActivationPayment(
      environment(),
      "owner",
      "event",
      change(3),
      { now: clock }
    )
    expect(retry.payment.id).toBe(paymentId)
    expect(await count("payment_attempts")).toBe(1)
    await expect(
      ensureCompensation(db, await loadPayment(db, paymentId), now)
    ).rejects.toBeInstanceOf(HTTPException)
    expect(await count("refunds")).toBe(0)
  })

  it.each(["pending", "failed", "cancelled"])(
    "does not activate a %s payment",
    async (state) => {
      const result = await prepared()
      if (state !== "pending")
        await db
          .prepare(
            "UPDATE payment_attempts SET state = ?, dispatch_state = 'reconciled' WHERE id = ?"
          )
          .bind(state, result.payment.id)
          .run()
      await expect(
        completeActivation(db, result.payment.id, { now: clock })
      ).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" })
      expect(await completedCount()).toBe(0)
    }
  )

  it.each([
    "checklist_changed",
    "event_cancelled",
    "event_suspended",
    "owner_suspended",
    "owner_unverified",
    "no_paid_type",
    "ended",
    "paid_sales_suspended",
  ])(
    "does not activate when %s changes before commit and permits compensation",
    async (condition) => {
      const paymentId = await paid()
      await expect(
        completeActivation(db, paymentId, {
          now: clock,
          beforeCommit: async () => {
            if (condition === "checklist_changed")
              await updateActivation(db, "owner", "event", checklist(1), {
                now: clock,
              })
            if (condition === "event_cancelled")
              await db
                .prepare(
                  "UPDATE events SET cancelled_at = ? WHERE id = 'event'"
                )
                .bind(now)
                .run()
            if (condition === "event_suspended")
              await db
                .prepare(
                  "UPDATE events SET suspended_at = ? WHERE id = 'event'"
                )
                .bind(now)
                .run()
            if (condition === "owner_suspended")
              await db
                .prepare(
                  "INSERT INTO profiles (user_id, suspended_at, updated_at) VALUES ('owner', ?, ?)"
                )
                .bind(now, now)
                .run()
            if (condition === "owner_unverified")
              await db
                .prepare(
                  "UPDATE user SET email_verified = 0 WHERE id = 'owner'"
                )
                .run()
            if (condition === "no_paid_type")
              await db
                .prepare(
                  "UPDATE ticket_types SET kind = 'free', price_minor = 0 WHERE event_id = 'event'"
                )
                .run()
            if (condition === "ended") now += 7_200_001
            if (condition === "paid_sales_suspended")
              await moderateActivation(
                db,
                "admin",
                "event",
                {
                  ...change(1),
                  suspended: true,
                  reason: "Controlled demo suspension",
                },
                { now: clock }
              )
          },
        })
      ).rejects.toMatchObject({ code: "CONFLICT" })
      expect(await completedCount()).toBe(0)
      const refundId = await ensureCompensation(
        db,
        await loadPayment(db, paymentId),
        now
      )
      expect(
        await db
          .prepare("SELECT reason FROM refunds WHERE id = ?")
          .bind(refundId)
          .first("reason")
      ).toBe("activation_failed")
      expect((await loadPayment(db, paymentId)).state).toBe("succeeded")
    }
  )

  it("allows only one winner when activation and compensation race", async () => {
    const paymentId = await paid()
    const payment = await loadPayment(db, paymentId)
    const results = await Promise.allSettled([
      completeActivation(db, paymentId, { now: clock }),
      ensureCompensation(db, payment, now),
    ])
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1)
    expect(
      Number(await completedCount()) + Number(await count("refunds"))
    ).toBe(1)
    expect((await loadPayment(db, paymentId)).state).toBe("succeeded")
  })

  it("reuses unresolved attempts and permits a new attempt only after definite failure or confirmed full compensation", async () => {
    const result = await prepared()
    expect(
      (
        await prepareActivationPayment(
          environment(),
          "owner",
          "event",
          change(1),
          { now: clock }
        )
      ).payment.id
    ).toBe(result.payment.id)
    await db
      .prepare(
        "UPDATE payment_attempts SET state = 'failed', dispatch_state = 'reconciled' WHERE id = ?"
      )
      .bind(result.payment.id)
      .run()
    const next = await prepareActivationPayment(
      environment(),
      "owner",
      "event",
      change(1),
      { now: clock }
    )
    expect(next.payment.id).not.toBe(result.payment.id)
    await succeed(next.payment.id)
    const refundId = await ensureCompensation(
      db,
      await loadPayment(db, next.payment.id),
      now
    )
    expect(
      (
        await prepareActivationPayment(
          environment(),
          "owner",
          "event",
          change(1),
          { now: clock }
        )
      ).payment.id
    ).toBe(next.payment.id)
    await db
      .prepare(
        "UPDATE refunds SET state = 'succeeded', confirmed_at = ? WHERE id = ?"
      )
      .bind(now, refundId)
      .run()
    const replacement = await prepareActivationPayment(
      environment(),
      "owner",
      "event",
      change(1),
      { now: clock }
    )
    expect(replacement.payment.id).not.toBe(next.payment.id)
    expect(await count("activation_attempts")).toBe(3)
  })

  it("retains a successful fee when the owner fixes a failed checklist and an administrator resumes paid sales", async () => {
    const paymentId = await paid()
    await completeActivation(db, paymentId, { now: clock })
    await updateActivation(
      db,
      "owner",
      "event",
      checklist(2, { payoutCheck: "failed" }),
      { now: clock }
    )
    expect(
      (await readActivation(db, "event", "owner", now)).activation.eligibility
    ).toBe("suspended")
    const fixed = await updateActivation(db, "owner", "event", checklist(3), {
      now: clock,
    })
    expect(fixed.activation.eligibility).toBe("active")
    await moderateActivation(
      db,
      "admin",
      "event",
      { ...change(4), suspended: true, reason: "Demo suspension" },
      { now: clock }
    )
    const saved = await updateActivation(db, "owner", "event", checklist(5), {
      now: clock,
    })
    expect(saved.activation.eligibility).toBe("suspended")
    const resumed = await moderateActivation(
      db,
      "admin",
      "event",
      { ...change(6), suspended: false, reason: "Demo issue resolved" },
      { now: clock }
    )
    expect(resumed.activation.eligibility).toBe("active")
    expect(resumed.activation.fee.successfulPaymentAttemptId).toBe(paymentId)
    expect(await count("payment_attempts")).toBe(1)
  })

  it("rechecks administrator grants at commit and guards against owner moderation", async () => {
    await ready()
    await expect(
      moderateActivation(
        db,
        "owner",
        "event",
        { ...change(1), suspended: true, reason: "Self moderation" },
        { now: clock }
      )
    ).rejects.toBeInstanceOf(HTTPException)
    await expect(
      updateActivationSettings(
        db,
        "admin",
        { ...change(0), feeMinor: 600_000 },
        {
          now: clock,
          beforeCommit: async () => {
            await db
              .prepare(
                "DELETE FROM platform_grants WHERE user_id = 'admin' AND permission = 'platform:configure'"
              )
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect((await readActivationSettings(db)).feeMinor).toBe(500_000)
  })

  it("exposes current paid eligibility and blocks dispatch after checklist changes", async () => {
    const preparedPayment = await prepared()
    const payment = await loadPayment(db, preparedPayment.payment.id)
    const before = activationEligibilitySql(payment, now, true)
    expect(
      await db
        .prepare(`SELECT (${before.predicate}) AS valid`)
        .bind(...before.bindings)
        .first("valid")
    ).toBe(1)
    await updateActivation(
      db,
      "owner",
      "event",
      checklist(1, { identityCheck: "failed" }),
      { now: clock }
    )
    expect(await claimPaymentDispatch(db, payment, now, true)).toBe(false)
    expect((await loadPayment(db, payment.id)).state).toBe("cancelled")
    const paidPredicate = paidSalesEligibilitySql("event", now, true)
    expect(
      await db
        .prepare(`SELECT (${paidPredicate.predicate}) AS valid`)
        .bind(...paidPredicate.bindings)
        .first("valid")
    ).toBe(0)
  })

  it("uses the shared payment dispatcher and compensates a changed checklist without activation", async () => {
    await ready()
    const provider = adapter()
    const completed = await startActivationPayment(
      environment(),
      provider,
      "owner",
      "event",
      change(1),
      { now: clock }
    )
    expect(completed.payment.state).toBe("succeeded")
    expect(provider.createCheckout).toHaveBeenCalledTimes(1)
    expect(await completedCount()).toBe(1)
    await startActivationPayment(
      environment(),
      provider,
      "owner",
      "event",
      change(2),
      { now: clock }
    )
    expect(provider.createCheckout).toHaveBeenCalledTimes(1)
    const other = await prepared("event-two")
    await succeed(other.payment.id)
    await updateActivation(
      db,
      "owner",
      "event-two",
      checklist(1, { identityCheck: "failed" }),
      { now: clock }
    )
    expect(
      await processPayment(environment(), provider, other.payment.id, {
        now: clock,
      })
    ).toBe(true)
    expect(provider.refund).toHaveBeenCalledTimes(1)
    expect(
      (await loadActivation(db, "event-two"))?.successful_payment_attempt_id
    ).toBeNull()
  })

  it("serves the owner and platform routes with runtime-validated contracts", async () => {
    const app = new Hono<{ Bindings: Bindings }>()
    app.onError((error, c) =>
      c.json(
        { error: { code: error instanceof ApiFailure ? error.code : "ERROR" } },
        error instanceof HTTPException ? error.status : 500
      )
    )
    app.route(
      "/api",
      createActivationRoutes({
        now: clock,
        adapter: adapter(),
        identify: async (c) => c.req.header("x-test-actor") ?? "other",
      })
    )
    const env = environment() as Bindings
    const get = await app.request(
      "https://api.example.test/api/events/event/activation",
      { headers: { "x-test-actor": "owner" } },
      env
    )
    expect(get.status).toBe(200)
    expect(activationResponseSchema.safeParse(await get.json()).success).toBe(
      true
    )
    const patch = await app.request(
      "https://api.example.test/api/events/event/activation",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-test-actor": "owner",
        },
        body: JSON.stringify(checklist()),
      },
      env
    )
    expect(patch.status).toBe(200)
    expect(
      (
        await app.request(
          "https://api.example.test/api/events/event/activation",
          {},
          env
        )
      ).status
    ).toBe(403)
    const settings = await app.request(
      "https://api.example.test/api/platform/activation-settings",
      { headers: { "x-test-actor": "admin" } },
      env
    )
    expect(await settings.json()).toEqual({
      feeMinor: 500_000,
      currency: "KZT",
      revision: 0,
    })
    const inspect = await app.request(
      "https://api.example.test/api/platform/events/event/activation",
      { headers: { "x-test-actor": "admin" } },
      env
    )
    expect(inspect.status).toBe(200)
  })
})
