import { apiErrorSchema } from "@elc/shared"
import { describe, expect, it } from "vite-plus/test"
import { app } from "./app"
import type { Bindings } from "./env"

describe("application API boundary", () => {
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
