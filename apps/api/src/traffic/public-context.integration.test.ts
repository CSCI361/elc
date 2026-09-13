import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { createAuthTestDatabase } from "../auth/test-database"
import { readPublicTrafficContext } from "./public-context"

describe("public-only reporting context", () => {
  let f: Awaited<ReturnType<typeof createAuthTestDatabase>>
  const now = Date.parse("2026-09-13T00:00:00Z")
  beforeEach(async () => {
    f = await createAuthTestDatabase()
    await f.DB.prepare(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES('owner','Owner','owner@example.test',1,?,?)"
    )
      .bind(now, now)
      .run()
    for (const id of ["event", "other"])
      await f.DB.prepare(`INSERT INTO events(id,organizer_id,title,description,category,venue_name,venue_address,starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,publication_state,calendar_uid,reporting_id,created_at,updated_at)
      VALUES(?,'owner','Private person name','Description','Music','Hall','Address',?,?,?,?,10,'published',?,?,?,?)`)
        .bind(
          id,
          now + 3600000,
          now + 7200000,
          now - 3600000,
          now + 3600000,
          `calendar-${id}`,
          `rpt_${id}_000001`,
          now,
          now
        )
        .run()
    for (const id of ["event", "other"])
      await f.DB.prepare(`INSERT INTO campaigns(id,event_id,name,code,token_hash,reporting_id,discount_kind,discount_value,starts_at,ends_at,max_redemptions,enabled,updated_at)
      VALUES(?,?,'Private campaign name',?,?,?,'percentage',1000,?,?,100,1,?)`)
        .bind(
          `campaign-${id}`,
          id,
          id === "event" ? "REDEEMABLE" : "REDEEMABLE-OTHER",
          `hash-${id}`,
          `rpt_campaign_${id}`,
          now - 1000,
          now + 1000,
          now
        )
        .run()
  })
  afterEach(async () => {
    await f?.runtime.dispose()
  })
  const read = (raw: unknown = {}) =>
    readPublicTrafficContext(f.DB, "event", raw, now)
  it("returns only current event and campaign reporting IDs for a public event", async () => {
    expect(await read({ campaignCode: "REDEEMABLE" })).toEqual({
      eventReportingId: "rpt_event_000001",
      campaignReportingId: "rpt_campaign_event",
    })
    expect(await read()).toEqual({
      eventReportingId: "rpt_event_000001",
      campaignReportingId: null,
    })
    expect(
      JSON.stringify(await read({ campaignCode: "REDEEMABLE" }))
    ).not.toContain("REDEEMABLE")
  })
  it.each([
    ["visibility", "'private'"],
    ["visibility", "'unlisted'"],
    ["publication_state", "'draft'"],
    ["publication_state", "'unpublished'"],
    ["suspended_at", String(now)],
  ])(
    "rejects current %s=%s even when an owner could read the event",
    async (column, value) => {
      await f.DB.prepare(
        `UPDATE events SET ${column}=${value} WHERE id='event'`
      ).run()
      await expect(read({ campaignCode: "REDEEMABLE" })).rejects.toMatchObject({
        status: 404,
      })
    }
  )
  it("does not resolve foreign, disabled, expired or not-yet-active campaigns", async () => {
    expect(
      (await read({ campaignCode: "REDEEMABLE-OTHER" })).campaignReportingId
    ).toBeNull()
    expect(
      (await read({ campaignCode: "UNKNOWN" })).campaignReportingId
    ).toBeNull()
    await f.DB.prepare(
      "UPDATE campaigns SET enabled=0 WHERE event_id='event'"
    ).run()
    expect(
      (await read({ campaignCode: "REDEEMABLE" })).campaignReportingId
    ).toBeNull()
    await f.DB.prepare(
      "UPDATE campaigns SET enabled=1,starts_at=?,ends_at=? WHERE event_id='event'"
    )
      .bind(now - 2000, now)
      .run()
    expect(
      (await read({ campaignCode: "REDEEMABLE" })).campaignReportingId
    ).toBeNull()
    await f.DB.prepare(
      "UPDATE campaigns SET starts_at=?,ends_at=? WHERE event_id='event'"
    )
      .bind(now + 1, now + 1000)
      .run()
    expect(
      (await read({ campaignCode: "REDEEMABLE" })).campaignReportingId
    ).toBeNull()
  })
  it("rejects arbitrary payload fields and excessive campaign values", async () => {
    await expect(read({ campaignCode: "x".repeat(65) })).rejects.toMatchObject({
      status: 400,
    })
    await expect(read({ email: "user@example.test" })).rejects.toMatchObject({
      status: 400,
    })
  })
})
