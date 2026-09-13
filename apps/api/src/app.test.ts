import { apiErrorSchema } from "@elc/shared"
import { describe, expect, it, vi } from "vite-plus/test"
import { app } from "./app"
import type { Bindings } from "./env"

// Node tests load the same bytes that the Worker bundles as an ArrayBuffer module.
vi.mock("./exports/assets/NotoSans-Regular.bin", async () => {
  const { readFileSync } = await import("node:fs")
  const bytes = readFileSync(
    new URL("./exports/assets/NotoSans-Regular.bin", import.meta.url)
  )
  return { default: new Uint8Array(bytes).buffer }
})

describe("application API boundary", () => {
  it.each([
    "/api/health",
    "/api/me",
    "/api/auth/get-session",
    "/api/payments/webhook",
    "/api/offline/sync",
  ])("pauses %s before touching restored data", async (path) => {
    const prepare = vi.fn(() => {
      throw new Error("Paused requests must not read D1")
    })
    const response = await app.request(
      `http://localhost${path}`,
      {
        method:
          path.endsWith("sync") || path.endsWith("webhook") ? "POST" : "GET",
      },
      { RECOVERY_MODE: "paused", DB: { prepare } } as unknown as Bindings
    )
    expect(response.status).toBe(503)
    expect(response.headers.get("Retry-After")).toBe("60")
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe(
      "SERVICE_UNAVAILABLE"
    )
    expect(prepare).not.toHaveBeenCalled()
  })
  it("returns the shared error contract and matching correlation header for unknown API routes", async () => {
    const response = await app.request("http://localhost/api/unknown")
    const body = apiErrorSchema.parse(await response.json())
    expect(response.status).toBe(404)
    expect(body.error.code).toBe("NOT_FOUND")
    expect(body.error.requestId).toBe(response.headers.get("X-Request-ID"))
    expect(response.headers.get("Cache-Control")).toBe("no-store")
  })

  it("rejects a foreign browser origin before invoking authentication or database writes", async () => {
    const response = await app.request(
      "http://localhost/api/auth/sign-up/email",
      { method: "POST", headers: { Origin: "https://foreign.example" } },
      { APP_ORIGIN: "http://localhost" } as Bindings
    )
    const body = apiErrorSchema.parse(await response.json())
    expect(response.status).toBe(403)
    expect(body.error.code).toBe("FORBIDDEN")
    expect(body.error.requestId).toBe(response.headers.get("X-Request-ID"))
  })
})
