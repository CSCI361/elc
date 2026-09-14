import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import {
  eventReportQueueResponseSchema,
  eventReportReceiptSchema,
} from "@elc/shared"
import { createAuthTestDatabase } from "../auth/test-database"
import { setSuspension } from "../administration/service"
import {
  listEventReports,
  resolveEventReport,
  submitEventReport,
} from "./service"

describe("event reports and platform review", () => {
  let f: Awaited<ReturnType<typeof createAuthTestDatabase>>
  const now = Date.parse("2026-09-14T10:00:00Z")
  const clock = { now: () => now }

  async function user(id: string, verified = true) {
    await f.DB.prepare(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,?,?,?)"
    )
      .bind(id, id, `${id}@example.test`, verified ? 1 : 0, now, now)
      .run()
  }
  async function event(id: string, visibility = "public") {
    await f.DB.prepare(`INSERT INTO events(id,organizer_id,title,description,category,venue_name,venue_address,starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,visibility,publication_state,calendar_uid,reporting_id,created_at,updated_at)
     VALUES(?,'owner',?,'Description','Music','Hall','Address',?,?,?,?,10,?,'published',?,?,?,?)`)
      .bind(
        id,
        `Event ${id}`,
        now + 3600000,
        now + 7200000,
        now - 3600000,
        now + 3600000,
        visibility,
        `calendar-${id}`,
        `rpt_${id.padEnd(8, "0")}`,
        now,
        now
      )
      .run()
  }
  const report = (
    actor: string,
    input: Record<string, unknown> = {},
    eventId = "event"
  ) =>
    submitEventReport(
      f.DB,
      actor,
      eventId,
      {
        requestId: `${actor}-request`,
        category: "misleading",
        details: "The venue listed does not exist.",
        ...input,
      },
      clock
    )
  const resolve = (
    reportId: string,
    input: Record<string, unknown> = {},
    beforeCommit?: () => Promise<void>
  ) =>
    resolveEventReport(
      f.DB,
      "admin",
      reportId,
      {
        requestId: `resolve-${reportId}`,
        expectedRevision: 1,
        resolution: "dismissed",
        reason: "Checked the venue listing.",
        ...input,
      },
      { ...clock, beforeCommit }
    )
  const count = async (sql: string, ...bindings: unknown[]) =>
    (
      await f.DB.prepare(sql)
        .bind(...bindings)
        .first<{ n: number }>()
    )?.n

  beforeEach(async () => {
    f = await createAuthTestDatabase()
    for (const id of ["admin", "owner", "reporter", "second", "suspended"])
      await user(id)
    await user("unverified", false)
    await f.DB.prepare(
      "INSERT INTO platform_grants(user_id,permission,granted_at) VALUES('admin','platform:moderate',?)"
    )
      .bind(now)
      .run()
    await f.DB.prepare(
      "INSERT INTO profiles(user_id,suspended_at,updated_at) VALUES('suspended',?,?)"
    )
      .bind(now, now)
      .run()
    await event("event")
    await event("hidden", "private")
  })
  afterEach(async () => {
    await f?.runtime.dispose()
  })

  it("records one open report per verified account and updates it on resubmission", async () => {
    const first = eventReportReceiptSchema.parse(await report("reporter"))
    expect(first).toMatchObject({
      eventId: "event",
      category: "misleading",
      state: "open",
      revision: 1,
    })
    const second = await report("reporter", {
      requestId: "reporter-second",
      category: "fraud",
      details: "Tickets are resold elsewhere.",
    })
    expect(second).toMatchObject({
      reportId: first.reportId,
      category: "fraud",
      revision: 2,
    })
    expect(
      await count(
        "SELECT count(*) AS n FROM event_reports WHERE event_id='event'"
      )
    ).toBe(1)
  })

  it("replays an exact retry and rejects a reused request identifier with changed input", async () => {
    const first = await report("reporter")
    expect(await report("reporter")).toEqual(first)
    await expect(
      report("reporter", { details: "A different description." })
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })

  it("rejects unverified, suspended and owner reporters", async () => {
    for (const actor of ["unverified", "suspended", "owner"])
      await expect(report(actor)).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(await count("SELECT count(*) AS n FROM event_reports")).toBe(0)
  })

  it("does not reveal events the reporter cannot read", async () => {
    await expect(report("reporter", {}, "hidden")).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
    await expect(report("reporter", {}, "missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
  })

  it("validates the category and bounded details", async () => {
    await expect(
      report("reporter", { category: "spam-ish" })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
    await expect(
      report("reporter", { details: "x".repeat(1001) })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
  })

  it("lists open reports only to current moderators with event context and counts", async () => {
    await report("reporter")
    await report("second", { category: "safety" })
    await expect(
      listEventReports(f.DB, "reporter", {}, clock)
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    const queue = eventReportQueueResponseSchema.parse(
      await listEventReports(f.DB, "admin", {}, clock)
    )
    expect(queue.items).toHaveLength(2)
    expect(queue.items[0]).toMatchObject({
      eventId: "event",
      eventTitle: "Event event",
      eventSuspended: false,
      eventRevision: 0,
      state: "open",
      openReportsForEvent: 2,
    })
    expect(JSON.stringify(queue)).not.toContain("@example.test")
  })

  it("dismisses a report with a reason and an immutable audit entry", async () => {
    const { reportId } = await report("reporter")
    expect(await resolve(reportId)).toMatchObject({
      reportId,
      state: "dismissed",
      revision: 2,
    })
    expect(
      await count(
        "SELECT count(*) AS n FROM audit_entries WHERE action='event_report.dismissed' AND entity_id=? AND event_id='event' AND actor_id='admin'",
        reportId
      )
    ).toBe(1)
    expect(
      (await listEventReports(f.DB, "admin", {}, clock)).items
    ).toHaveLength(0)
    expect(
      (await listEventReports(f.DB, "admin", { state: "all" }, clock)).items[0]
    ).toMatchObject({
      state: "dismissed",
      resolutionReason: "Checked the venue listing.",
    })
  })

  it("records action taken only after the event is suspended", async () => {
    const { reportId } = await report("reporter")
    await expect(
      resolve(reportId, { resolution: "actioned" })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    await setSuspension(
      f.DB,
      "admin",
      "event",
      "event",
      {
        requestId: "suspend",
        expectedRevision: 0,
        suspended: true,
        reason: "Confirmed misleading venue.",
      },
      clock
    )
    expect(
      await resolve(reportId, {
        requestId: "resolve-after-suspension",
        resolution: "actioned",
      })
    ).toMatchObject({ state: "actioned" })
    expect(
      await count(
        "SELECT count(*) AS n FROM audit_entries WHERE action='event_report.actioned' AND entity_id=?",
        reportId
      )
    ).toBe(1)
  })

  it("rejects stale revisions and rolls back when moderation access is revoked before commit", async () => {
    const { reportId } = await report("reporter")
    await expect(
      resolve(reportId, { expectedRevision: 5 })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    await expect(
      resolve(reportId, { requestId: "revoked" }, async () => {
        await f.DB.prepare(
          "DELETE FROM platform_grants WHERE user_id='admin'"
        ).run()
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(
      await count("SELECT count(*) AS n FROM event_reports WHERE state='open'")
    ).toBe(1)
    expect(
      await count(
        "SELECT count(*) AS n FROM audit_entries WHERE action LIKE 'event_report.%'"
      )
    ).toBe(0)
  })

  it("opens a new report after an earlier report was resolved", async () => {
    const { reportId } = await report("reporter")
    await resolve(reportId)
    const next = await report("reporter", { requestId: "reporter-again" })
    expect(next.reportId).not.toBe(reportId)
    expect(next).toMatchObject({ state: "open", revision: 1 })
  })

  it("paginates the queue with cursors bound to the moderator and filters", async () => {
    await user("third")
    for (const actor of ["reporter", "second", "third"]) await report(actor)
    await f.DB.prepare(
      "INSERT INTO platform_grants(user_id,permission,granted_at) VALUES('owner','platform:moderate',?)"
    )
      .bind(now)
      .run()
    const page = await listEventReports(f.DB, "admin", { limit: 2 }, clock)
    expect(page.items).toHaveLength(2)
    expect(page.nextCursor).not.toBeNull()
    const rest = await listEventReports(
      f.DB,
      "admin",
      { limit: 2, cursor: page.nextCursor },
      clock
    )
    expect(rest.items).toHaveLength(1)
    await expect(
      listEventReports(
        f.DB,
        "owner",
        { limit: 2, cursor: page.nextCursor },
        clock
      )
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
  })

  it("rejects a resubmission that loses a race with another resubmission", async () => {
    await report("reporter")
    await expect(
      submitEventReport(
        f.DB,
        "reporter",
        "event",
        {
          requestId: "slow-edit",
          category: "safety",
          details: "Slow edit that read revision one.",
        },
        {
          ...clock,
          beforeCommit: async () => {
            await report("reporter", {
              requestId: "fast-edit",
              category: "fraud",
              details: "Fast edit committed first.",
            })
          },
        }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
    const row = await f.DB.prepare(
      "SELECT category, details, revision FROM event_reports WHERE event_id='event'"
    ).first()
    expect(row).toEqual({
      category: "fraud",
      details: "Fast edit committed first.",
      revision: 2,
    })
    expect(
      await count(
        "SELECT count(*) AS n FROM request_receipts WHERE request_id='slow-edit'"
      )
    ).toBe(0)
  })
})
