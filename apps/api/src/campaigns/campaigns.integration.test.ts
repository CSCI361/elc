import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import {
  createCampaignRequestSchema,
  resolveCampaignResponseSchema,
  scanTicketSchema,
} from "@elc/shared"
import { createExportFixture } from "../exports/test-fixture"
import {
  createCampaign,
  setCampaignEnabled,
  hashCampaignToken,
} from "../events/mutations"
import type { EventContext } from "../events/store"
import { ApiFailure } from "../db/transitions"
import type { Bindings } from "../env"
import {
  createEventInvitation,
  acceptEventInvitation,
} from "../access/invitations"
import { recoverInvitationToken } from "../access/tokens"
import { startCheckout } from "../orders/checkout"
import { startOrderPayment } from "../payments/checkout"
import { processPayment } from "../payments/reconcile"
import { RecordedProvider } from "../payments/test-fixture"
import { readEventAnalytics } from "../reporting/read"
import { prepareOnlineScan } from "../../../mobile/src/model"
import { resolveCampaign } from "./resolve"
import { createCampaignRoutes } from "./index"

describe("attendee campaign resolution on migrated D1", () => {
  let fixture: Awaited<ReturnType<typeof createExportFixture>>,
    db: D1Database,
    now: number,
    campaignId: string,
    code: string
  const clock = () => now
  const context = (): EventContext => ({
    db,
    actorId: "owner",
    now,
    appOrigin: fixture.env.APP_ORIGIN,
    correlationId: crypto.randomUUID(),
  })
  const revision = async () =>
    Number(
      await db
        .prepare("SELECT revision FROM events WHERE id='event'")
        .first("revision")
    )
  const enable = async (enabled = true, id = campaignId) =>
    setCampaignEnabled(
      context(),
      "event",
      id,
      { requestId: crypto.randomUUID(), expectedRevision: await revision() },
      enabled
    )
  const resolve = (actorId?: string, raw: unknown = { code }, changes = {}) =>
    resolveCampaign(db, "event", raw, actorId, { now: clock, ...changes })
  beforeEach(async () => {
    fixture = await createExportFixture()
    db = fixture.db
    now = fixture.now
    const result = await createCampaign(
      context(),
      "event",
      createCampaignRequestSchema.parse({
        requestId: "campaign-create",
        expectedRevision: await revision(),
        eventId: "event",
        name: "Campus offer",
        discount: { kind: "percentage", basisPoints: 2500 },
        startsAt: new Date(now - 1000).toISOString(),
        endsAt: new Date(now + 3600000).toISOString(),
        maxRedemptions: 1,
        applicableTicketTypeIds: ["type"],
      })
    )
    campaignId = result.resourceId
    code = (await db
      .prepare("SELECT code FROM campaigns WHERE id=?")
      .bind(campaignId)
      .first<string>("code"))!
  })
  afterEach(async () => {
    await fixture?.dispose()
  })
  const invite = async () => {
    await db
      .prepare("UPDATE events SET visibility='private' WHERE id='event'")
      .run()
    const issued = await createEventInvitation(
      fixture.env,
      "owner",
      "event",
      {
        requestId: "invite",
        expectedRevision: await revision(),
        email: "other@example.test",
      },
      { now: clock }
    )
    const payload = JSON.parse(
      (await db
        .prepare(
          "SELECT payload_json FROM outbox WHERE kind='invitation.deliver' AND entity_id=?"
        )
        .bind(issued.invitation.id)
        .first<string>("payload_json"))!
    ) as { encryptedToken: string }
    const token = await recoverInvitationToken(
      issued.invitation.id,
      payload.encryptedToken,
      fixture.env.TICKET_ENCRYPTION_KEY
    )
    await acceptEventInvitation(
      db,
      "other",
      { requestId: "accept", token },
      { now: clock }
    )
    return issued.invitation.id
  }
  it.each(["public", "unlisted"])(
    "returns current terms anonymously for a published %s event",
    async (visibility) => {
      await enable()
      await db
        .prepare("UPDATE events SET visibility=? WHERE id='event'")
        .bind(visibility)
        .run()
      const result = await resolve(undefined, { code: ` ${code} ` })
      expect(result).toEqual({
        eventId: "event",
        campaign: {
          id: campaignId,
          name: "Campus offer",
          discount: { kind: "percentage", basisPoints: 2500 },
          startsAt: new Date(now - 1000).toISOString(),
          endsAt: new Date(now + 3600000).toISOString(),
          applicableTicketTypeIds: ["type"],
        },
        serverNow: new Date(now).toISOString(),
      })
      expect(resolveCampaignResponseSchema.safeParse(result).success).toBe(true)
      const text = JSON.stringify(result)
      for (const secret of [
        code,
        await hashCampaignToken(code),
        "code",
        "token_hash",
        "reportingId",
        "maxRedemptions",
        "redemptionsAvailable",
        "checkoutUrl",
        "credential",
      ])
        expect(text).not.toContain(secret)
    }
  )
  it("returns fixed discounts as server-defined integer minor units", async () => {
    const fixed = await createCampaign(
      context(),
      "event",
      createCampaignRequestSchema.parse({
        requestId: "fixed",
        expectedRevision: await revision(),
        eventId: "event",
        name: "Fixed offer",
        discount: { kind: "fixed", amountMinor: 50000 },
        maxRedemptions: 3,
        applicableTicketTypeIds: ["type"],
      })
    )
    await enable(true, fixed.resourceId)
    const fixedCode = await db
      .prepare("SELECT code FROM campaigns WHERE id=?")
      .bind(fixed.resourceId)
      .first("code")
    expect(
      (await resolve(undefined, { code: fixedCode })).campaign.discount
    ).toEqual({ kind: "fixed", amountMinor: 50000 })
  })
  it("does not resolve a new disabled campaign, a disabled campaign or an unknown code", async () => {
    for (const raw of [{ code }, { code: "unknown" }])
      await expect(resolve(undefined, raw)).rejects.toMatchObject({
        code: "PROMO_INVALID",
        status: 400,
      })
    await enable()
    await enable(false)
    await expect(resolve()).rejects.toMatchObject({
      code: "PROMO_INVALID",
      status: 400,
    })
  })
  it("uses an inclusive start and exclusive end, with a fresh time after asynchronous work", async () => {
    await enable()
    now = fixture.now - 1001
    await expect(resolve()).rejects.toMatchObject({ code: "PROMO_INVALID" })
    now++
    expect((await resolve()).campaign.id).toBe(campaignId)
    now = fixture.now + 3600000 - 1
    expect((await resolve()).campaign.id).toBe(campaignId)
    await expect(
      resolve(
        undefined,
        { code },
        {
          beforeReturn: async () => {
            now++
          },
        }
      )
    ).rejects.toMatchObject({ code: "PROMO_INVALID" })
  })
  it.each([
    null,
    {},
    { code: "" },
    { code: "   " },
    { code: 3 },
    { code: "a".repeat(65) },
    { code: "offer", discount: { kind: "fixed", amountMinor: 1 } },
  ])(
    "rejects malformed input without interpreting client discount terms: %j",
    async (raw) => {
      await expect(resolve(undefined, raw)).rejects.toMatchObject({
        code: "INVALID_INPUT",
        status: 400,
      })
    }
  )
  it("scopes opaque token hashes to the event and does not look up the plaintext code column", async () => {
    await enable()
    const lookup = "OPAQUE-HASH-LOOKUP"
    await db
      .prepare(`INSERT INTO campaigns(id,event_id,name,code,token_hash,reporting_id,discount_kind,discount_value,starts_at,ends_at,max_redemptions,enabled,updated_at)
   VALUES ('hash-only','event','Hash lookup','STORED-DISPLAY-VALUE',?,'report-hash-only','fixed',50000,?,?,1,1,?)`)
      .bind(await hashCampaignToken(lookup), now - 1000, now + 1000, now)
      .run()
    await db
      .prepare(
        "INSERT INTO campaign_ticket_types(campaign_id,ticket_type_id) VALUES ('hash-only','type')"
      )
      .run()
    expect((await resolve(undefined, { code: lookup })).campaign.id).toBe(
      "hash-only"
    )
    await expect(
      resolve(undefined, { code: "STORED-DISPLAY-VALUE" })
    ).rejects.toMatchObject({ code: "PROMO_INVALID" })
    await expect(
      resolve(undefined, { code: await hashCampaignToken(code) })
    ).rejects.toMatchObject({ code: "PROMO_INVALID" })
    await db
      .prepare(`INSERT INTO events(id,organizer_id,title,description,category,venue_name,venue_address,starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,publication_state,calendar_uid,reporting_id,created_at,updated_at)
   VALUES ('other-event','owner','Other','Text','Education','Hall','Almaty',?,?,?,?,10,'published','other-calendar','other-report',?,?)`)
      .bind(now + 3600000, now + 7200000, now - 1000, now + 3600000, now, now)
      .run()
    await expect(
      resolveCampaign(db, "other-event", { code }, undefined, { now: clock })
    ).rejects.toMatchObject({ code: "PROMO_INVALID" })
    await expect(
      resolveCampaign(db, "missing", { code }, undefined, { now: clock })
    ).rejects.toMatchObject({ status: 404 })
  })
  it("requires accepted invitation, event staff, owner or moderator for a private published event", async () => {
    await enable()
    await invite()
    await expect(resolve()).rejects.toMatchObject({ status: 404 })
    await expect(resolve("buyer")).rejects.toMatchObject({ status: 404 })
    for (const actor of ["other", "scanner", "manager", "owner"])
      expect((await resolve(actor)).campaign.id).toBe(campaignId)
    await db
      .prepare(
        "INSERT INTO platform_grants(user_id,permission,granted_at) VALUES ('buyer','platform:moderate',?)"
      )
      .bind(now)
      .run()
    expect((await resolve("buyer")).campaign.id).toBe(campaignId)
  })
  it.each(["draft", "unpublished"])(
    "does not reveal campaigns for %s events even to the owner",
    async (state) => {
      await enable()
      await db
        .prepare("UPDATE events SET publication_state=? WHERE id='event'")
        .bind(state)
        .run()
      await expect(resolve("owner")).rejects.toMatchObject({ status: 404 })
    }
  )
  it.each([
    "disabled",
    "expired",
    "event-suspended",
    "cancelled",
    "unpublished",
    "visibility",
  ])("rechecks %s after hashing and before returning", async (change) => {
    await enable()
    await expect(
      resolve(
        undefined,
        { code },
        {
          beforeReturn: async () => {
            if (change === "disabled") await enable(false)
            else if (change === "expired") now += 3600000
            else if (change === "event-suspended")
              await db
                .prepare("UPDATE events SET suspended_at=? WHERE id='event'")
                .bind(now)
                .run()
            else if (change === "cancelled")
              await db
                .prepare("UPDATE events SET cancelled_at=? WHERE id='event'")
                .bind(now)
                .run()
            else if (change === "unpublished")
              await db
                .prepare(
                  "UPDATE events SET publication_state='unpublished' WHERE id='event'"
                )
                .run()
            else
              await db
                .prepare(
                  "UPDATE events SET visibility='private' WHERE id='event'"
                )
                .run()
          },
        }
      )
    ).rejects.toMatchObject({
      status: change === "disabled" || change === "expired" ? 400 : 404,
    })
  })
  it.each(["invitation", "email", "account", "staff"])(
    "rechecks private %s authority in the final terms query",
    async (change) => {
      await enable()
      const invitationId = await invite()
      const actor = change === "staff" ? "scanner" : "other"
      await expect(
        resolve(
          actor,
          { code },
          {
            beforeReturn: async () => {
              if (change === "invitation")
                await db
                  .prepare("UPDATE invitations SET revoked_at=? WHERE id=?")
                  .bind(now, invitationId)
                  .run()
              else if (change === "email")
                await db
                  .prepare(
                    "UPDATE user SET email='changed@example.test' WHERE id='other'"
                  )
                  .run()
              else if (change === "account")
                await db
                  .prepare(
                    "INSERT INTO profiles(user_id,suspended_at,updated_at) VALUES ('other',?,?)"
                  )
                  .bind(now, now)
                  .run()
              else
                await db
                  .prepare(
                    "UPDATE event_permissions SET revoked_at=? WHERE user_id='scanner'"
                  )
                  .bind(now)
                  .run()
            },
          }
        )
      ).rejects.toMatchObject({ status: 404 })
    }
  )
  it("completes disabled→enabled→resolved→discounted checkout with attribution, while rejecting its campaign QR as admission", async () => {
    await expect(resolve()).rejects.toMatchObject({ code: "PROMO_INVALID" })
    await enable()
    const terms = await resolve()
    const checkout = await startCheckout(
      db,
      "other",
      {
        requestId: "promo-checkout",
        eventId: "event",
        promoCode: code,
        items: [
          {
            ticketTypeId: terms.campaign.applicableTicketTypeIds[0],
            quantity: 1,
            seatIds: ["seat-2"],
            attendeeNames: ["Campaign attendee"],
          },
        ],
      },
      { now: clock }
    )
    expect(checkout.order).toMatchObject({
      subtotalMinor: 1234500,
      discountMinor: 308625,
      totalMinor: 925875,
    })
    const provider = new RecordedProvider()
    const payment = await startOrderPayment(
      fixture.env,
      provider,
      "other",
      checkout.order.id,
      { requestId: "promo-payment", expectedRevision: 0 },
      { now: clock }
    )
    provider.state = "succeeded"
    await processPayment(fixture.env, provider, payment.payment.id, {
      now: clock,
    })
    const order = await db
      .prepare("SELECT state,campaign_id FROM orders WHERE id=?")
      .bind(checkout.order.id)
      .first()
    expect(order).toEqual({ state: "completed", campaign_id: campaignId })
    expect(
      await db
        .prepare("SELECT count(*) AS count FROM tickets WHERE order_id=?")
        .bind(checkout.order.id)
        .first("count")
    ).toBe(1)
    const report = await readEventAnalytics(
      db,
      "owner",
      "event",
      {},
      { now: clock }
    )
    expect(
      report.campaigns.find((campaign) => campaign.id === campaignId)
    ).toMatchObject({
      completedOrders: 1,
      ticketsIssued: 1,
      discountMinor: 308625,
      netTicketRevenueMinor: 925875,
      committedRedemptions: 1,
    })
    // A displayed offer is not a redemption reservation; the next checkout still enforces the cap.
    expect((await resolve()).campaign.id).toBe(campaignId)
    await expect(
      startCheckout(
        db,
        "buyer",
        {
          requestId: "promo-exhausted",
          eventId: "event",
          promoCode: code,
          items: [
            {
              ticketTypeId: "type",
              quantity: 1,
              seatIds: ["seat-3"],
              attendeeNames: ["Second attendee"],
            },
          ],
        },
        { now: clock }
      )
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 })
    expect(
      await db
        .prepare(
          "SELECT count(*) AS count FROM promo_allocations WHERE campaign_id=?"
        )
        .bind(campaignId)
        .first("count")
    ).toBe(1)
    expect(
      await db
        .prepare("SELECT count(*) AS count FROM orders WHERE campaign_id=?")
        .bind(campaignId)
        .first("count")
    ).toBe(1)
    const campaignUrl = `${fixture.env.APP_ORIGIN}/events/event?campaign=${encodeURIComponent(code)}`
    expect(
      prepareOnlineScan("event", campaignUrl, "reject-campaign-scan")
    ).toBeNull()
    expect(
      scanTicketSchema.safeParse({
        eventId: "event",
        operationId: "reject-campaign-scan",
        credential: campaignUrl,
      }).success
    ).toBe(false)
    expect(
      await db.prepare("SELECT count(*) AS count FROM checkins").first("count")
    ).toBe(0)
  })
  it("accepts JSON POST only and returns no cacheable or credential-bearing response URL", async () => {
    await enable()
    const app = new Hono<{
      Bindings: Bindings
      Variables: { requestId: string }
    }>()
      .route(
        "/api",
        createCampaignRoutes({ identify: async () => undefined, now: clock })
      )
      .onError((error, c) =>
        c.json(
          { code: error instanceof ApiFailure ? error.code : "ERROR" },
          error instanceof HTTPException ? error.status : 500
        )
      )
    const url = "http://elc.test/api/events/event/campaigns/resolve"
    const response = await app.request(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      },
      fixture.env as Bindings
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(response.headers.get("Location")).toBeNull()
    expect(JSON.stringify(await response.json())).not.toContain(code)
    expect(
      (await app.request(url, { method: "GET" }, fixture.env as Bindings))
        .status
    ).toBe(404)
    expect(
      (
        await app.request(
          url,
          { method: "POST", body: "{" },
          fixture.env as Bindings
        )
      ).status
    ).toBe(400)
  })
  it("rejects oversized request bodies before identity or campaign lookup", async () => {
    let identified = false,
      lookedUp = false
    const app = new Hono<{
      Bindings: Bindings
      Variables: { requestId: string }
    }>()
      .route(
        "/api",
        createCampaignRoutes({
          identify: async () => {
            identified = true
            return undefined
          },
          now: clock,
          beforeReturn: async () => {
            lookedUp = true
          },
        })
      )
      .onError((error, c) =>
        c.json(
          { code: error instanceof ApiFailure ? error.code : "ERROR" },
          error instanceof HTTPException ? error.status : 500
        )
      )
    const response = await app.request(
      "http://elc.test/api/events/event/campaigns/resolve",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "x".repeat(4096) }),
      },
      fixture.env as Bindings
    )
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ code: "INVALID_INPUT" })
    expect(identified).toBe(false)
    expect(lookedUp).toBe(false)
  })
})
