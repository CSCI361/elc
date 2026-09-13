import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { DEMO_PAID_TERMS_VERSION } from "@elc/shared"
import { updateActivation } from "../activation/mutations"
import { startActivationPayment } from "../activation/payment"
import { readActivation } from "../activation/store"
import { createExportFixture } from "../exports/test-fixture"
import { readAccountOrders } from "../orders/account"
import { startCheckout } from "../orders/checkout"
import { loadOrder } from "../orders/read"
import { startOrderPayment } from "../payments/checkout"
import { processPayment } from "../payments/reconcile"
import { readPayment } from "../payments/store"
import { RecordedProvider } from "../payments/test-fixture"
import { readOrderTickets, readTicket } from "../tickets/read"
import { scanOnline } from "../tickets/scan"

describe("protected reads use current D1 authority at return", () => {
  let f: Awaited<ReturnType<typeof createExportFixture>>
  beforeEach(async () => {
    f = await createExportFixture()
  })
  afterEach(async () => {
    await f?.dispose()
  })
  const execute = async (sql: string, ...values: unknown[]) => {
    await f.db
      .prepare(sql)
      .bind(...values)
      .run()
  }
  const suspend = (actor: string) =>
    execute(
      "INSERT INTO profiles (user_id,suspended_at,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET suspended_at=excluded.suspended_at",
      actor,
      f.now,
      f.now
    )
  const unverify = (actor: string) =>
    execute("UPDATE user SET email_verified=0 WHERE id=?", actor)
  const revokeManager = () =>
    execute(
      "UPDATE event_permissions SET revoked_at=? WHERE user_id='manager' AND event_id='event'",
      f.now
    )
  const transferOwner = () =>
    execute("UPDATE events SET organizer_id='other' WHERE id='event'")
  const moderator = () =>
    execute(
      "INSERT INTO platform_grants (user_id,permission,granted_at) VALUES ('other','platform:moderate',?)",
      f.now
    )
  async function pendingOrder() {
    const checkout = await startCheckout(
      f.db,
      "other",
      {
        requestId: crypto.randomUUID(),
        eventId: "event",
        items: [
          {
            ticketTypeId: "type",
            quantity: 1,
            seatIds: ["seat-2"],
            attendeeNames: ["Other attendee"],
          },
        ],
      },
      { now: () => f.now }
    )
    const provider = new RecordedProvider()
    const response = await startOrderPayment(
      f.env,
      provider,
      "other",
      checkout.order.id,
      { requestId: crypto.randomUUID(), expectedRevision: checkout.revision },
      { now: () => f.now }
    )
    expect(response.payment.checkoutUrl).toContain("sandbox.example.test")
    return { checkout, provider, paymentId: response.payment.id }
  }
  async function pendingActivation() {
    await execute(
      `INSERT INTO events (id,organizer_id,title,description,category,venue_name,venue_address,
      starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,max_tickets_per_order,
      calendar_uid,reporting_id,created_at,updated_at) VALUES ('activation-event','owner','Demo','Description','Music','Hall','Address',?,?,?,?,4,4,'activation-calendar','activation-report',?,?)`,
      f.now + 3600000,
      f.now + 7200000,
      f.now - 3600000,
      f.now + 3600000,
      f.now,
      f.now
    )
    await execute(
      "INSERT INTO ticket_types (id,event_id,name,kind,price_minor,quantity,sales_start_at,sales_end_at,updated_at) VALUES ('activation-type','activation-event','Paid','paid',300000,4,?,?,?)",
      f.now - 3600000,
      f.now + 3600000,
      f.now
    )
    const saved = await updateActivation(
      f.db,
      "owner",
      "activation-event",
      {
        requestId: crypto.randomUUID(),
        expectedRevision: 0,
        profile: {
          displayName: "Organizer",
          legalName: "Demo Organizer",
          contact: "demo@example.test",
          dummyPayoutReference: "DEMO-CAMPUS",
        },
        identityCheck: "passed",
        payoutCheck: "passed",
        acceptedTermsVersion: DEMO_PAID_TERMS_VERSION,
      },
      { now: () => f.now }
    )
    const provider = new RecordedProvider()
    const response = await startActivationPayment(
      f.env,
      provider,
      "owner",
      "activation-event",
      {
        requestId: crypto.randomUUID(),
        expectedRevision: saved.activation.revision,
      },
      { now: () => f.now }
    )
    expect(response.payment.checkoutUrl).toContain("sandbox.example.test")
    return response.payment.id
  }

  it("preserves ticket purchaser/owner/manage access without inheriting scan, history, or platform access", async () => {
    await moderator()
    await execute(
      "INSERT INTO event_permissions (user_id,event_id,permission,granted_at) VALUES ('other','event','history:read',?)",
      f.now
    )
    for (const actor of ["buyer", "owner", "manager"]) {
      expect(await readTicket(f.env, actor, f.ticketId, true)).toMatchObject({
        ticket: { id: f.ticketId },
        credential: f.credential,
      })
      expect(
        (await readOrderTickets(f.env, actor, f.orderId)).items
      ).toHaveLength(1)
    }
    for (const actor of ["scanner", "other"]) {
      await expect(
        readTicket(f.env, actor, f.ticketId, true)
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        readOrderTickets(f.env, actor, f.orderId)
      ).rejects.toMatchObject({ status: 403 })
    }
  })
  it.each([
    "manager-revoked",
    "buyer-suspended",
    "buyer-unverified",
    "owner-transferred",
    "manager-deleted",
  ])("withholds decrypted admission credentials after %s", async (change) => {
    const actor = change.startsWith("manager")
      ? "manager"
      : change.startsWith("owner")
        ? "owner"
        : "buyer"
    await expect(
      readTicket(f.env, actor, f.ticketId, true, {
        beforeReturn: async () => {
          if (change === "manager-revoked") await revokeManager()
          if (change === "buyer-suspended") await suspend("buyer")
          if (change === "buyer-unverified") await unverify("buyer")
          if (change === "owner-transferred") await transferOwner()
          if (change === "manager-deleted") {
            await execute(
              "DELETE FROM event_permissions WHERE user_id='manager'"
            )
            await execute("DELETE FROM user WHERE id='manager'")
          }
        },
      })
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" })
  })
  it("returns current canonical check-in state after credential recovery", async () => {
    const result = await readTicket(f.env, "buyer", f.ticketId, true, {
      beforeReturn: async () => {
        const scanned = await scanOnline(
          f.db,
          "scanner",
          {
            eventId: "event",
            operationId: crypto.randomUUID(),
            credential: f.credential,
          },
          { now: () => f.now }
        )
        expect(scanned).toMatchObject({ result: "checked_in" })
      },
    })
    expect(result).toMatchObject({
      ticket: { state: "checked_in" },
      credential: f.credential,
    })
  })
  it.each([false, true])(
    "rechecks ticket-list authority even with an empty page: %s",
    async (empty) => {
      await expect(
        readOrderTickets(
          f.env,
          "manager",
          f.orderId,
          empty ? "zzzz" : undefined,
          { beforeReturn: revokeManager }
        )
      ).rejects.toMatchObject({ status: 404 })
    }
  )
  it("returns current list rows and admission block state in the authorized batch", async () => {
    const result = await readOrderTickets(
      f.env,
      "buyer",
      f.orderId,
      undefined,
      {
        beforeReturn: async () => {
          await execute(
            "UPDATE orders SET admission_blocked_at=? WHERE id=?",
            f.now,
            f.orderId
          )
        },
      }
    )
    expect(result.items[0]).toMatchObject({
      id: f.ticketId,
      admissionBlocked: true,
    })
    expect(JSON.stringify(result)).not.toContain(f.credential.token)
  })
  it.each(["suspended", "unverified"])(
    "denies an order snapshot when its purchaser becomes %s",
    async (state) => {
      await expect(
        loadOrder(f.db, "buyer", f.orderId, {
          beforeRead: () =>
            state === "suspended" ? suspend("buyer") : unverify("buyer"),
        })
      ).rejects.toMatchObject({ status: 404 })
    }
  )
  it("keeps order and payment reads purchaser-only despite event or platform authority", async () => {
    await moderator()
    const paymentId = await f.db
      .prepare("SELECT id FROM payment_attempts WHERE actor_id='buyer'")
      .first<string>("id")
    expect(paymentId).toBeTruthy()
    for (const actor of ["owner", "manager", "other"]) {
      await expect(loadOrder(f.db, actor, f.orderId)).rejects.toMatchObject({
        status: 404,
      })
      await expect(readPayment(f.db, actor, paymentId!)).rejects.toMatchObject({
        status: 404,
      })
    }
    expect((await loadOrder(f.db, "buyer", f.orderId)).order.id).toBe(f.orderId)
  })
  it.each(["suspended", "unverified"])(
    "withholds a pending checkout URL after its purchaser becomes %s",
    async (state) => {
      const pending = await pendingOrder()
      await expect(
        readPayment(f.db, "other", pending.paymentId, {
          beforeRead: () =>
            state === "suspended" ? suspend("other") : unverify("other"),
        })
      ).rejects.toMatchObject({ status: 404 })
    }
  )
  it("returns the reconciled payment state without a stale checkout URL", async () => {
    const pending = await pendingOrder()
    const result = await readPayment(f.db, "other", pending.paymentId, {
      beforeRead: async () => {
        pending.provider.state = "failed"
        await processPayment(f.env, pending.provider, pending.paymentId, {
          now: () => f.now,
        })
      },
    })
    expect(result.payment).toMatchObject({ state: "failed", checkoutUrl: null })
  })
  it.each(["suspended", "unverified", "deleted"])(
    "denies account lists after current account is %s, including empty lists",
    async (state) => {
      const actor = state === "deleted" ? "other" : "buyer"
      await expect(
        readAccountOrders(
          f.db,
          actor,
          {},
          {
            beforeRead: async () => {
              if (state === "suspended") await suspend(actor)
              if (state === "unverified") await unverify(actor)
              if (state === "deleted")
                await execute("DELETE FROM user WHERE id=?", actor)
            },
          }
        )
      ).rejects.toMatchObject({ status: 403 })
    }
  )
  it("lists only the current purchaser's orders without admission credentials", async () => {
    const buyer = await readAccountOrders(f.db, "buyer", { limit: "1" })
    expect(buyer.items.map((row) => row.id)).toEqual([f.orderId])
    expect((await readAccountOrders(f.db, "owner", {})).items).toEqual([])
    expect(JSON.stringify(buyer)).not.toContain(f.credential.token)
  })
  it("withholds activation details after ownership changes", async () => {
    await expect(
      readActivation(f.db, "event", "owner", f.now, false, {
        beforeReturn: transferOwner,
      })
    ).rejects.toMatchObject({ status: 403 })
  })
  it.each(["suspended", "unverified"])(
    "preserves owner diagnostics but suppresses pending activation URLs when %s",
    async (state) => {
      await pendingActivation()
      const read = () =>
        readActivation(f.db, "activation-event", "owner", f.now)
      expect((await read()).activation.latestPayment?.checkoutUrl).toContain(
        "sandbox.example.test"
      )
      const result = await readActivation(
        f.db,
        "activation-event",
        "owner",
        f.now,
        false,
        {
          beforeReturn: () =>
            state === "suspended" ? suspend("owner") : unverify("owner"),
        }
      )
      expect(result.activation.profile?.contact).toBe("demo@example.test")
      expect(result.activation.blockers).toContain(
        state === "suspended" ? "account_suspended" : "email_unverified"
      )
      expect(result.activation.latestPayment?.checkoutUrl).toBeNull()
      expect((await read()).activation).toEqual(result.activation)
    }
  )
  it.each(["revoked", "suspended", "unverified", "deleted"])(
    "denies platform activation diagnostics when moderation access becomes %s",
    async (state) => {
      await moderator()
      await expect(
        readActivation(f.db, "event", "other", f.now, true, {
          beforeReturn: async () => {
            if (state === "suspended") await suspend("other")
            if (state === "unverified") await unverify("other")
            if (state === "revoked" || state === "deleted")
              await execute("DELETE FROM platform_grants WHERE user_id='other'")
            if (state === "deleted")
              await execute("DELETE FROM user WHERE id='other'")
          },
        })
      ).rejects.toMatchObject({ status: 403 })
    }
  )
  it("keeps owner-only diagnostics separate from event management and hides URLs from moderators", async () => {
    await pendingActivation()
    await moderator()
    await expect(
      readActivation(f.db, "event", "manager", f.now)
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      readActivation(f.db, "event", "other", f.now)
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      readActivation(f.db, "event", "owner", f.now, true)
    ).rejects.toMatchObject({ status: 403 })
    const result = await readActivation(
      f.db,
      "activation-event",
      "other",
      f.now,
      true,
      { beforeReturn: () => suspend("owner") }
    )
    expect(result.activation.blockers).toContain("account_suspended")
    expect(result.activation.latestPayment?.checkoutUrl).toBeNull()
    expect(result.activation.profile?.contact).toBe("demo@example.test")
  })
})
