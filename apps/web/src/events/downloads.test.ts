import { describe, expect, it } from "vite-plus/test"
import {
  calendarExportResponseSchema,
  type CalendarExportResponse,
} from "@elc/shared"
import {
  calendarCreateLinks,
  calendarDownloadPath,
  loadDownload,
  ticketPdfPath,
} from "./downloads"

describe("private downloads", () => {
  it("sends same-origin credentials without caching or following redirects", async () => {
    const signal = new AbortController().signal
    let observed: RequestInit | undefined
    const request: typeof fetch = async (_path, options) => {
      observed = options
      return new Response("%PDF-1.7\nfixture", {
        headers: { "Content-Type": "application/pdf" },
      })
    }
    const blob = await loadDownload(
      "/api/tickets/ticket/pdf?locale=kk",
      "pdf",
      signal,
      request
    )
    expect(blob.type).toBe("application/pdf")
    expect(observed).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal,
    })
  })
  it("does not turn authorization errors, conflicts, HTML or mislabeled JSON into downloaded files", async () => {
    for (const response of [
      new Response('{"error":{"code":"UNAUTHENTICATED"}}', {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
      new Response("Forbidden", { status: 403 }),
      new Response("Changed", { status: 409 }),
      new Response("<html>Sign in</html>", {
        headers: { "Content-Type": "text/html" },
      }),
      new Response('{"error":"wrong content"}', {
        headers: { "Content-Type": "application/pdf" },
      }),
    ]) {
      await expect(
        loadDownload(
          "/api/tickets/ticket/pdf",
          "pdf",
          new AbortController().signal,
          async () => response
        )
      ).rejects.toThrow()
    }
  })
  it("discards a successful response after its account or page lifetime has ended", async () => {
    const controller = new AbortController()
    const request: typeof fetch = async () => {
      controller.abort()
      return new Response("%PDF-1.7\nfixture", {
        headers: { "Content-Type": "application/pdf" },
      })
    }
    await expect(
      loadDownload("/api/tickets/ticket/pdf", "pdf", controller.signal, request)
    ).rejects.toMatchObject({ name: "AbortError" })
  })
  it("validates calendar content and rejects cross-origin or wrong-event download URLs", async () => {
    const path = "/api/events/event%2Fid/calendar.ics?locale=ru"
    expect(
      calendarDownloadPath(
        `https://elc.test${path}`,
        "event/id",
        "ru",
        "https://elc.test"
      )
    ).toBe(path)
    for (const url of [
      `https://external.test${path}`,
      `https://user:secret@elc.test${path}`,
      "https://elc.test/api/events/other/calendar.ics?locale=ru",
      `https://elc.test${path}#credential`,
      `https://elc.test${path}&token=secret`,
    ])
      expect(
        calendarDownloadPath(url, "event/id", "ru", "https://elc.test")
      ).toBeNull()
    const blob = await loadDownload(
      path,
      "ics",
      new AbortController().signal,
      async () =>
        new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", {
          headers: { "Content-Type": "text/calendar; charset=utf-8" },
        })
    )
    expect(await blob.text()).toContain("BEGIN:VCALENDAR")
    expect(ticketPdfPath("ticket/id", "kk")).toBe(
      "/api/tickets/ticket%2Fid/pdf?locale=kk"
    )
  })
})

describe("calendar creation actions", () => {
  const value: CalendarExportResponse = {
    calendar: {
      uid: "event@elc",
      sequence: 2,
      status: "CONFIRMED",
      timeZone: "Asia/Almaty",
      updatedAt: "2026-09-13T00:00:00.000Z",
    },
    downloadUrl: "https://elc.test/api/events/event/calendar.ics?locale=en",
    replacementNote: "Replace the previous calendar entry manually.",
    createLinks: {
      google: "https://calendar.google.com/calendar/render?action=TEMPLATE",
      outlook:
        "https://outlook.live.com/calendar/0/deeplink/compose?rru=addevent",
    },
  }
  it("removes creation actions for a cancelled snapshot and rejects a contradictory API response", () => {
    expect(calendarCreateLinks(value)).not.toBeNull()
    const cancelled = {
      ...value,
      calendar: { ...value.calendar, status: "CANCELLED" as const },
    }
    expect(calendarCreateLinks(cancelled)).toBeNull()
    expect(calendarExportResponseSchema.safeParse(cancelled).success).toBe(
      false
    )
    expect(
      calendarExportResponseSchema.safeParse({
        ...cancelled,
        createLinks: null,
      }).success
    ).toBe(true)
  })
  it("allows only the exact HTTPS calendar creation endpoints", () => {
    for (const google of [
      "javascript:alert(1)",
      "https://calendar.google.com.attacker.test/calendar/render",
      "http://calendar.google.com/calendar/render",
      "https://calendar.google.com/redirect",
      "https://user:secret@calendar.google.com/calendar/render",
    ])
      expect(
        calendarCreateLinks({
          ...value,
          createLinks: { ...value.createLinks!, google },
        })
      ).toBeNull()
  })
})
