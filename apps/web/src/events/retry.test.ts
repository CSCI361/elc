import { describe, expect, it } from "vite-plus/test"
import { canRetry, EventApiError } from "./api"

describe("canRetry", () => {
  it("should offer a retry for network and server failures", () => {
    expect(canRetry(new Error("offline"))).toBe(true)
    expect(canRetry(new EventApiError("INTERNAL", 500))).toBe(true)
    expect(canRetry(new EventApiError("CONFLICT", 409))).toBe(true)
  })

  it("should not offer a retry when the account has no access", () => {
    expect(canRetry(new EventApiError("FORBIDDEN", 403))).toBe(false)
    expect(canRetry(new EventApiError("UNAUTHENTICATED", 401))).toBe(false)
  })

  it("should not offer a retry when the record does not exist", () => {
    expect(canRetry(new EventApiError("NOT_FOUND", 404))).toBe(false)
  })
})
