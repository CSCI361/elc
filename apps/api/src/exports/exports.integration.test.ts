import { mkdir, readFile, writeFile } from "node:fs/promises"
import process from "node:process"
import { PDFDocument } from "pdf-lib"
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { findEvent } from "../events/store"
import { readTicket } from "../tickets/read"
import { scanOnline } from "../tickets/scan"
import { credentialHash } from "../tickets/credentials"
import { readCalendarExport, renderCalendar } from "./calendar"
import { createExportRoutes } from "./routes"
import { createExportFixture } from "./test-fixture"
import { loadTicketPdfSource } from "./ticket-data"
import { downloadTicketPdf } from "./ticket-pdf"

const fontBytes = new Uint8Array(
  await readFile(new URL("./assets/NotoSans-Regular.bin", import.meta.url))
)

describe("canonical ticket PDF and calendar exports with D1 and R2", () => {
  let fixture: Awaited<ReturnType<typeof createExportFixture>>
  beforeEach(async () => {
    fixture = await createExportFixture()
  })
  afterEach(async () => {
    await fixture?.dispose()
  })
  const download = (actor = "buyer", locale: "kk" | "ru" | "en" = "kk") =>
    downloadTicketPdf(fixture.env, actor, fixture.ticketId, locale, fontBytes)
  const countTickets = () =>
    fixture.db.prepare("SELECT count(*) AS n FROM tickets").first<number>("n")

  it("renders localized A4 PDFs from one canonical assigned ticket and stores them privately", async () => {
    const source = await loadTicketPdfSource(
      fixture.db,
      fixture.env.APP_ORIGIN,
      "buyer",
      fixture.ticketId,
      "kk"
    )
    expect(source.data.seat).toMatchObject({
      section: "Ә",
      row: "Б",
      number: "1",
    })
    expect(source.data.unitPriceMinor).toBe(1234500)
    for (const locale of ["kk", "ru", "en"] as const) {
      const response = await download("buyer", locale)
      expect(response.headers.get("content-type")).toBe("application/pdf")
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      const bytes = new Uint8Array(await response.arrayBuffer())
      const pdf = await PDFDocument.load(bytes)
      expect(pdf.getPageCount()).toBe(1)
      expect(pdf.getPage(0).getWidth()).toBeCloseTo(595.28, 1)
      expect(pdf.getPage(0).getHeight()).toBeCloseTo(841.89, 1)
      if (process.env.ELC_WRITE_EXPORT_SAMPLES === "1") {
        await mkdir("test-results/ticket-exports", { recursive: true })
        await writeFile(
          `test-results/ticket-exports/elc-ticket-${locale}.pdf`,
          bytes
        )
        await writeFile(
          "test-results/ticket-exports/expected-token-hash.txt",
          await credentialHash(fixture.credential.token)
        )
      }
    }
    const objects = await fixture.files.list({ prefix: "private/ticket-pdfs/" })
    expect(objects.objects).toHaveLength(3)
    expect(
      objects.objects.every(
        (object) => !object.key.includes(fixture.credential.token)
      )
    ).toBe(true)
    expect(await countTickets()).toBe(1)
  })

  it("reuses R2 bytes and regenerates a missing PDF without changing the digital admission", async () => {
    const original = new Uint8Array(await (await download()).arrayBuffer())
    expect(new Uint8Array(await (await download()).arrayBuffer())).toEqual(
      original
    )
    const objects = await fixture.files.list({ prefix: "private/ticket-pdfs/" })
    await fixture.files.delete(objects.objects[0]!.key)
    expect((await download()).status).toBe(200)
    const current = await readTicket(
      fixture.env,
      "buyer",
      fixture.ticketId,
      true
    )
    expect("credential" in current && current.credential).toEqual(
      fixture.credential
    )
    expect(await countTickets()).toBe(1)
    const scanned = await scanOnline(fixture.db, "scanner", {
      operationId: crypto.randomUUID(),
      eventId: "event",
      credential: fixture.credential,
    })
    expect(scanned.result).toBe("checked_in")
  })

  it("allows the purchaser and event manager but denies scanner-only and unrelated accounts before R2 reads", async () => {
    await download()
    for (const actor of ["owner", "manager"])
      expect((await download(actor)).status).toBe(200)
    let reads = 0
    const tracked = {
      ...fixture.env,
      FILES: {
        get: async (key: string) => {
          reads++
          return fixture.files.get(key)
        },
      } as R2Bucket,
    }
    for (const actor of ["scanner", "other"])
      await expect(
        downloadTicketPdf(tracked, actor, fixture.ticketId, "kk", fontBytes)
      ).rejects.toMatchObject({ status: 403 })
    expect(reads).toBe(0)
  })

  it("rechecks manager authorization after asynchronous rendering and before storing or returning a PDF", async () => {
    await expect(
      downloadTicketPdf(
        fixture.env,
        "manager",
        fixture.ticketId,
        "en",
        fontBytes,
        {
          beforeReturn: async () => {
            await fixture.db
              .prepare(
                "UPDATE event_permissions SET revoked_at = ? WHERE user_id = 'manager'"
              )
              .bind(Date.now())
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ status: 403 })
    expect(
      (await fixture.files.list({ prefix: "private/ticket-pdfs/" })).objects
    ).toHaveLength(0)
  })

  it("invalidates cached output when event details or ticket admission state change", async () => {
    const original = new Uint8Array(await (await download()).arrayBuffer())
    await fixture.db
      .prepare(
        "UPDATE events SET venue_name = 'Жаңа зал', calendar_sequence = calendar_sequence + 1 WHERE id = 'event'"
      )
      .run()
    const updated = new Uint8Array(await (await download()).arrayBuffer())
    expect(updated).not.toEqual(original)
    await fixture.db
      .prepare("UPDATE tickets SET state = 'refunded' WHERE id = ?")
      .bind(fixture.ticketId)
      .run()
    expect(new Uint8Array(await (await download()).arrayBuffer())).not.toEqual(
      updated
    )
    expect(
      (await fixture.files.list({ prefix: "private/ticket-pdfs/" })).objects
    ).toHaveLength(3)
    const credential = await readTicket(
      fixture.env,
      "buyer",
      fixture.ticketId,
      true
    )
    expect("credential" in credential && credential.credential).toEqual(
      fixture.credential
    )
  })

  it("rebuilds after an event update during PDF generation and stores only the current version", async () => {
    const result = await downloadTicketPdf(
      fixture.env,
      "buyer",
      fixture.ticketId,
      "en",
      fontBytes,
      {
        beforeReturn: async () => {
          await fixture.db
            .prepare(
              "UPDATE events SET title = 'Updated before download' WHERE id = 'event'"
            )
            .run()
        },
      }
    )
    expect(result.status).toBe(200)
    expect(
      (await fixture.files.list({ prefix: "private/ticket-pdfs/" })).objects
    ).toHaveLength(1)
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(
      new Uint8Array(await (await download("buyer", "en")).arrayBuffer())
    )
  })

  it("protects PDF routes and accepts only supported locales", async () => {
    const anonymous = createExportRoutes({
      fontBytes,
      identify: async () => undefined,
    })
    expect(
      (
        await anonymous.request(
          `/tickets/${fixture.ticketId}/pdf`,
          {},
          fixture.env
        )
      ).status
    ).toBe(401)
    const purchaser = createExportRoutes({
      fontBytes,
      identify: async () => "buyer",
    })
    expect(
      (
        await purchaser.request(
          `/tickets/${fixture.ticketId}/pdf?locale=invalid`,
          {},
          fixture.env
        )
      ).status
    ).toBe(400)
    const response = await purchaser.request(
      `/tickets/${fixture.ticketId}/pdf?locale=ru`,
      {},
      fixture.env
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("content-disposition")).toContain("attachment")
  })

  it("exports stable UID, configured time zone and escaped event-only contents", async () => {
    const title = "Ә Ғ Қ Ң Ө Ұ Ү Һ І ".repeat(10)
    await fixture.db
      .prepare(
        "UPDATE events SET title = ?, description = ?, starts_at = ?, ends_at = ?, registration_closes_at = ? WHERE id = 'event'"
      )
      .bind(
        title,
        "Text, semicolon; slash\\\r\nATTENDEE:evil@example.test",
        Date.parse("2027-01-10T12:30:00Z"),
        Date.parse("2027-01-10T15:00:00Z"),
        Date.parse("2027-01-10T12:30:00Z")
      )
      .run()
    const first = await readCalendarExport(
      fixture.db,
      fixture.env.APP_ORIGIN,
      "event",
      undefined,
      "en"
    )
    expect(first.ics).toBe(
      (
        await readCalendarExport(
          fixture.db,
          fixture.env.APP_ORIGIN,
          "event",
          undefined,
          "en"
        )
      ).ics
    )
    expect(first.ics).toContain("UID:event@elc.example\r\n")
    expect(first.ics).toContain("DTSTART;TZID=Asia/Almaty:20270110T173000\r\n")
    expect(first.ics).toContain("DTEND;TZID=Asia/Almaty:20270110T200000\r\n")
    expect(first.ics).toContain("TZOFFSETTO:+0500")
    expect(first.ics).not.toContain("\r\nATTENDEE:")
    expect(first.ics).not.toContain(fixture.ticketId)
    expect(first.ics).not.toContain(fixture.orderId)
    expect(first.ics).not.toContain(fixture.credential.token)
    expect(
      first.ics
        .split("\r\n")
        .every((line) => new TextEncoder().encode(line).length <= 75)
    ).toBe(true)
    expect(first.ics.replaceAll("\r\n ", "")).toContain(`SUMMARY:${title}`)
    const google = new URL(first.createLinks!.google)
    expect(google.searchParams.get("ctz")).toBe("Asia/Almaty")
    expect(google.searchParams.get("dates")).toBe(
      "20270110T123000Z/20270110T150000Z"
    )
    expect(first.replacementNote).toContain("do not sync automatically")
  })

  it("retains the UID and sequence on cancellation and offers a revised file without creation links", async () => {
    const before = await readCalendarExport(
      fixture.db,
      fixture.env.APP_ORIGIN,
      "event",
      undefined,
      "en"
    )
    await fixture.db
      .prepare(
        "UPDATE events SET cancelled_at = ?, calendar_sequence = calendar_sequence + 1, updated_at = ? WHERE id = 'event'"
      )
      .bind(Date.now(), Date.now())
      .run()
    const after = await readCalendarExport(
      fixture.db,
      fixture.env.APP_ORIGIN,
      "event",
      undefined,
      "en"
    )
    expect(after.calendar.uid).toBe(before.calendar.uid)
    expect(after.calendar.sequence).toBe(before.calendar.sequence + 1)
    expect(after.ics).toContain("STATUS:CANCELLED\r\n")
    expect(after.createLinks).toBeNull()
    expect(after.downloadUrl).toContain("calendar.ics")
  })

  it("enforces private event invitation access before producing calendar files or links", async () => {
    await fixture.db
      .prepare("UPDATE events SET visibility = 'private' WHERE id = 'event'")
      .run()
    for (const actor of [undefined, "other", "buyer"])
      await expect(
        readCalendarExport(
          fixture.db,
          fixture.env.APP_ORIGIN,
          "event",
          actor,
          "en"
        )
      ).rejects.toMatchObject({ status: 404 })
    await fixture.db
      .prepare(`INSERT INTO invitations (id, event_id, email, token_hash, expires_at, accepted_by, accepted_at, created_at)
      VALUES ('invite', 'event', 'buyer@example.test', 'private-token-hash', ?, 'buyer', ?, ?)`)
      .bind(fixture.now + 1000, fixture.now, fixture.now)
      .run()
    expect(
      (
        await readCalendarExport(
          fixture.db,
          fixture.env.APP_ORIGIN,
          "event",
          "buyer",
          "en"
        )
      ).calendar.uid
    ).toBe("event@elc.example")
    await fixture.db
      .prepare("UPDATE invitations SET revoked_at = ? WHERE id = 'invite'")
      .bind(Date.now())
      .run()
    await expect(
      readCalendarExport(
        fixture.db,
        fixture.env.APP_ORIGIN,
        "event",
        "buyer",
        "en"
      )
    ).rejects.toMatchObject({ status: 404 })
    const routes = createExportRoutes({
      fontBytes,
      identify: async () => "other",
    })
    expect(
      (await routes.request("/events/event/calendar.ics", {}, fixture.env))
        .status
    ).toBe(404)
    expect(
      (await routes.request("/events/event/calendar", {}, fixture.env)).status
    ).toBe(404)
  })

  it("includes daylight-saving observances and preserves the second repeated-hour instant", async () => {
    const event = await findEvent(fixture.db, "event")
    const ics = renderCalendar(
      {
        ...event,
        time_zone: "America/New_York",
        starts_at: Date.parse("2027-11-07T06:30:00Z"),
        ends_at: Date.parse("2027-11-07T07:30:00Z"),
      },
      fixture.env.APP_ORIGIN
    )
    expect(ics).toContain("BEGIN:DAYLIGHT\r\n")
    expect(ics).toContain("TZOFFSETFROM:-0500\r\nTZOFFSETTO:-0400")
    expect(ics).toContain("DTSTART:20271107T063000Z\r\n")
    expect(ics).toContain("DTEND;TZID=America/New_York:20271107T023000\r\n")
    const longEvent = renderCalendar(
      {
        ...event,
        starts_at: Date.parse("2027-01-01T12:00:00Z"),
        ends_at: Date.parse("3027-01-01T12:00:00Z"),
      },
      fixture.env.APP_ORIGIN
    )
    expect(longEvent).toContain("DTEND;TZID=Asia/Almaty:30270101T170000\r\n")
    expect(longEvent.length).toBeLessThan(10000)
  })
})
