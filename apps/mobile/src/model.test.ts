import { describe, expect, it } from "vite-plus/test"
import type { ScannerEvent } from "@elc/shared"
import {
  canReverse,
  confirmedScanResponse,
  eventCanScan,
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
