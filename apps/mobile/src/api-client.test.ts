import { describe, expect, it } from "vite-plus/test"
import { createNativeApi } from "./api-client"
import { authenticatedFetch } from "./transport"

describe("Hono native cookie transport", () => {
  it("builds typed event paths, bounded queries and JSON mutation bodies with the current cookie", async () => {
    const requests: { url: URL; init: RequestInit }[] = []
    let cookie = "elc.session_token=first"
    const api = createNativeApi(
      "https://preview.example.test",
      async () => cookie,
      async (input, init) => {
        requests.push({
          url: new URL(
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url
          ),
          init: init!,
        })
        return Response.json({})
      }
    )
    await api.events("cursor value")
    expect(requests[0]!.url.pathname).toBe("/api/scanner/events")
    expect(requests[0]!.url.searchParams.get("limit")).toBe("20")
    expect(requests[0]!.url.searchParams.get("cursor")).toBe("cursor value")
    expect(new Headers(requests[0]!.init.headers).get("Cookie")).toBe(
      "elc.session_token=first"
    )
    cookie = "elc.session_token=second"
    await api.attendees("event name", "Адам 100%", undefined)
    expect(requests[1]!.url.pathname).toBe(
      "/api/scanner/events/event%20name/attendees"
    )
    expect(requests[1]!.url.searchParams.get("q")).toBe("Адам 100%")
    expect(new Headers(requests[1]!.init.headers).get("Cookie")).toBe(
      "elc.session_token=second"
    )
    const scan = {
      eventId: "event",
      operationId: "stable-operation",
      credential: {
        kind: "elc_admission" as const,
        version: 1 as const,
        token: "A".repeat(43),
      },
    }
    await api.scan(scan)
    expect(requests[2]!.url.pathname).toBe("/api/checkins")
    expect(requests[2]!.init.method).toBe("POST")
    expect(requests[2]!.init.body).toBe(JSON.stringify(scan))
    await api.reverse("event", {
      checkInId: "checkin",
      requestId: "stable-correction",
      reason: "Mistaken admission",
    })
    expect(requests[3]!.url.pathname).toBe(
      "/api/events/event/checkins/checkin/reverse"
    )
    expect(requests[3]!.init.body).toBe(
      JSON.stringify({
        requestId: "stable-correction",
        reason: "Mistaken admission",
      })
    )
    await api.saveLanguage("kk")
    expect(requests[4]!.init.method).toBe("PATCH")
    expect(requests[4]!.init.body).toBe(JSON.stringify({ locale: "kk" }))
  })

  it("rejects an external or non-API URL before reading or forwarding a cookie", async () => {
    let cookies = 0
    let calls = 0
    const transport = authenticatedFetch(
      "https://preview.example.test",
      async () => {
        cookies++
        return "fixture"
      },
      async () => {
        calls++
        return Response.json({})
      }
    )
    for (const target of [
      "https://other.example.test/api/checkins",
      "https://preview.example.test/account",
      "https://user:password@preview.example.test/api/checkins",
    ]) {
      await expect(transport(target)).rejects.toMatchObject({ status: 403 })
    }
    expect(cookies).toBe(0)
    expect(calls).toBe(0)
  })
})
