import { describe, expect, it } from "vite-plus/test"
import type { ScannerEvent } from "@elc/shared"
import {
  canReverse,
  checkInShare,
  confirmedScanResponse,
  eventCanScan,
  eventPhase,
  guestStatus,
  sortForStaff,
  parseAdmissionQr,
  prepareOnlineScan,
  selectDeviceLocale,
} from "./model"
import { requestJson, ServiceError, uncertainRequest } from "./transport"

const operationId = "scan-operation"
const credential = { kind: "elc_admission", version: 1, token: "A".repeat(43) }
const event: ScannerEvent = {
  id: "event",
  title: "Fixture event",
  venueName: "Hall",
  timeZone: "Asia/Almaty",
  startsAt: "2026-09-13T10:00:00.000Z",
  endsAt: "2026-09-13T12:00:00.000Z",
  cancelledAt: null,
  suspendedAt: null,
  permissions: ["ticket:scan"],
  counts: { registered: 1, checkedIn: 0, unresolvedOffline: 0 },
  coverImageUrl: null,
}

describe("native online admission boundaries", () => {
  it("chooses the first supported device locale with Kazakh fallback", () => {
    expect(selectDeviceLocale(["fr-FR", "RU-ru", "en-US"])).toBe("ru")
    expect(selectDeviceLocale(["en_US", "kk-KZ"])).toBe("en")
    expect(selectDeviceLocale(["de-DE"])).toBe("kk")
    expect(selectDeviceLocale([])).toBe("kk")
  })

  it("accepts only a bounded admission credential, never a campaign URL or extended payload", () => {
    expect(parseAdmissionQr(JSON.stringify(credential))).toEqual(credential)
    for (const input of [
      "https://demo.example.test/c/campaign",
      JSON.stringify({ kind: "elc_campaign", token: credential.token }),
      JSON.stringify({ ...credential, email: "private@example.test" }),
      "x".repeat(2049),
      credential.token,
    ]) {
      expect(parseAdmissionQr(input)).toBeNull()
    }
  })

  it("requires both a matching operation and canonical check-in evidence before success", () => {
    const response = { operationId, result: "checked_in", checkInId: "checkin" }
    expect(confirmedScanResponse(response, operationId)).toEqual(response)
    expect(confirmedScanResponse(response, "another-operation")).toBeNull()
    expect(
      confirmedScanResponse({ ...response, checkInId: null }, operationId)
    ).toBeNull()
    expect(
      confirmedScanResponse({ ...response, result: "paid" }, operationId)
    ).toBeNull()
    expect(
      confirmedScanResponse(
        { operationId, result: "already_used", checkInId: null },
        operationId
      )?.result
    ).toBe("already_used")
  })

  it("checks event expiry and current explicit permissions without owner or reversal escalation", () => {
    const now = Date.parse(event.startsAt)
    expect(eventCanScan(event, now)).toBe(true)
    expect(canReverse(event)).toBe(false)
    expect(
      eventCanScan(
        { ...event, permissions: ["event:manage", "checkin:reverse"] },
        now
      )
    ).toBe(false)
    expect(
      canReverse({ ...event, permissions: ["ticket:scan", "checkin:reverse"] })
    ).toBe(true)
    expect(eventCanScan(event, Date.parse(event.endsAt))).toBe(false)
    expect(eventCanScan({ ...event, cancelledAt: event.startsAt }, now)).toBe(
      false
    )
    expect(eventCanScan({ ...event, suspendedAt: event.startsAt }, now)).toBe(
      false
    )
  })

  it("does not retry a lost response automatically and preserves the exact scan for an explicit retry", async () => {
    const pending = prepareOnlineScan(
      event.id,
      JSON.stringify(credential),
      operationId
    )!
    const requests: RequestInit[] = []
    const fetcher: typeof fetch = async (_url, init) => {
      requests.push(init!)
      if (requests.length === 1)
        throw new TypeError("Network response lost after server commit")
      return Response.json({
        operationId,
        result: "checked_in",
        checkInId: "checkin",
      })
    }
    const options = { method: "POST" as const, body: pending }
    const attempt = () =>
      requestJson(
        "https://preview.example.test",
        async () => "elc.session_token=fixture",
        "/checkins",
        options,
        fetcher
      )
    const failed = await attempt().catch((error) => error)
    expect(uncertainRequest(failed)).toBe(true)
    expect(requests).toHaveLength(1)
    const response = await attempt()
    expect(confirmedScanResponse(response, operationId)?.result).toBe(
      "checked_in"
    )
    expect(requests).toHaveLength(2)
    expect(requests[1]!.body).toBe(requests[0]!.body)
    const body = requests[1]!.body
    if (typeof body !== "string")
      throw new Error("Expected a JSON request body")
    expect(JSON.parse(body).operationId).toBe(operationId)
    expect(requests[0]).toMatchObject({
      credentials: "omit",
      redirect: "error",
    })
    expect(new Headers(requests[0]!.headers).get("Cookie")).toBe(
      "elc.session_token=fixture"
    )
    expect(new Headers(requests[0]!.headers).get("Origin")).toBe("elc://")
  })

  it("waits for SecureStore cookies and aborts before sending when an account view closes", async () => {
    const controller = new AbortController()
    let calls = 0
    const fetcher: typeof fetch = async () => {
      calls++
      return Response.json({})
    }
    const result = requestJson(
      "https://preview.example.test",
      async () => {
        controller.abort()
        return "fixture"
      },
      "/checkins",
      { signal: controller.signal },
      fetcher
    )
    await expect(result).rejects.toMatchObject({ status: null })
    expect(calls).toBe(0)
  })

  it.each([408, 429, 500, 503])(
    "keeps an HTTP %s outcome uncertain without another admission request",
    async (status) => {
      let calls = 0
      const fetcher: typeof fetch = async () => {
        calls++
        return new Response("", { status })
      }
      const error = await requestJson(
        "https://preview.example.test",
        async () => null,
        "/checkins",
        {},
        fetcher
      ).catch((error) => error)
      expect(uncertainRequest(error)).toBe(true)
      expect(calls).toBe(1)
    }
  )

  it("treats an authorization denial as definite and malformed success JSON as uncertain", async () => {
    expect(uncertainRequest(new ServiceError(403))).toBe(false)
    const error = await requestJson(
      "https://preview.example.test",
      async () => null,
      "/checkins",
      {},
      async () => new Response("not-json")
    ).catch((error) => error)
    expect(uncertainRequest(error)).toBe(true)
  })
})

describe("event screen summaries", () => {
  const at = (iso: string) => Date.parse(iso)
  it.each([
    ["2026-09-12T10:00:00.000Z", "upcoming"],
    ["2026-09-13T02:00:00.000Z", "today"],
    ["2026-09-13T10:30:00.000Z", "live"],
    ["2026-09-13T12:00:00.000Z", "ended"],
  ] as const)("should describe the event at %s as %s", (now, phase) => {
    expect(eventPhase(event, at(now))).toBe(phase)
  })

  it("should treat today in the event time zone, not the phone's", () => {
    const lateEvening = {
      ...event,
      startsAt: "2026-09-13T17:30:00.000Z",
      endsAt: "2026-09-13T19:00:00.000Z",
    }
    expect(eventPhase(lateEvening, at("2026-09-12T19:30:00.000Z"))).toBe(
      "today"
    )
    expect(eventPhase(lateEvening, at("2026-09-12T18:30:00.000Z"))).toBe(
      "upcoming"
    )
  })

  it("should put cancellation and suspension before timing", () => {
    const now = at("2026-09-13T10:30:00.000Z")
    expect(
      eventPhase({ ...event, cancelledAt: "2026-09-01T00:00:00.000Z" }, now)
    ).toBe("cancelled")
    expect(
      eventPhase({ ...event, suspendedAt: "2026-09-01T00:00:00.000Z" }, now)
    ).toBe("suspended")
  })

  it.each([
    [{ registered: 0, checkedIn: 0 }, 0],
    [{ registered: 40, checkedIn: 10 }, 0.25],
    [{ registered: 2, checkedIn: 3 }, 1],
  ])("should report check-in share %j as %d", (counts, share) => {
    expect(checkInShare({ ...counts, unresolvedOffline: 0 })).toBe(share)
  })

  it.each([
    [{ state: "valid" }, "notIn"],
    [{ state: "checked_in" }, "checkedIn"],
    [{ state: "valid", activeCheckInId: "checkin" }, "checkedIn"],
    [{ state: "refunded", activeCheckInId: "old" }, "refunded"],
    [{ state: "cancelled", activeCheckInId: "old" }, "cancelled"],
    [{ state: "valid", admissionBlocked: true }, "blocked"],
  ] as const)("should show guest %j as %s", (changes, status) => {
    expect(
      guestStatus({
        admissionBlocked: false,
        activeCheckInId: null,
        ...changes,
      })
    ).toBe(status)
  })
})

describe("staff event order", () => {
  it("should list current and upcoming events first, soonest on top, then past ones newest first", () => {
    const now = Date.parse("2026-09-13T11:00:00.000Z")
    const at = (
      id: string,
      startsAt: string,
      endsAt: string,
      cancelledAt: string | null = null
    ) => ({
      ...event,
      id,
      startsAt,
      endsAt,
      cancelledAt,
    })
    const events = [
      at("old", "2026-09-01T10:00:00.000Z", "2026-09-01T12:00:00.000Z"),
      at("later", "2026-09-20T10:00:00.000Z", "2026-09-20T12:00:00.000Z"),
      at(
        "cancelled",
        "2026-09-14T10:00:00.000Z",
        "2026-09-14T12:00:00.000Z",
        "2026-09-02T00:00:00.000Z"
      ),
      at("live", "2026-09-13T10:00:00.000Z", "2026-09-13T12:00:00.000Z"),
      at("recent", "2026-09-10T10:00:00.000Z", "2026-09-10T12:00:00.000Z"),
    ]
    expect(sortForStaff(events, now).map((item) => item.id)).toEqual([
      "live",
      "later",
      "cancelled",
      "recent",
      "old",
    ])
    expect(events[0]?.id).toBe("old")
  })
})
