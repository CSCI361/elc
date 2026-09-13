import { describe, expect, it } from "vite-plus/test"
import {
  canDiscardRejectedRecovery,
  deliveryQuery,
  deliveryRoute,
  deliverySearch,
  readPending,
  recoveryKey,
} from "./policies"

const saved = {
  version: 1,
  accountId: "admin",
  deliveryId: "delivery-1",
  input: {
    requestId: "request-1",
    reason: "Retry after verified outage",
    mode: "retry_same_request",
    expectedUpdatedAt: "2026-09-13T10:00:00.000Z",
  },
}
describe("delivery recovery navigation and uncertain operations", () => {
  it("restores the exact request only for its account and delivery", () => {
    const body = JSON.stringify(saved)
    expect(readPending(body, "admin", "delivery-1")).toEqual(saved)
    expect(readPending(body, "other", "delivery-1")).toBeNull()
    expect(readPending(body, "admin", "delivery-2")).toBeNull()
    expect(recoveryKey("a:b", "c")).not.toBe(recoveryKey("a", "b:c"))
  })
  it("rejects corrupt, obsolete and extended stored operations", () => {
    for (const raw of [
      "invalid",
      "null",
      JSON.stringify({ ...saved, version: 2 }),
      JSON.stringify({ ...saved, email: "private@example.test" }),
      JSON.stringify({
        ...saved,
        input: { ...saved.input, mode: "resend_new" },
      }),
    ])
      expect(readPending(raw, "admin", "delivery-1")).toBeNull()
  })
  it("settles an authenticated conflict but retains uncertainty across access and transport failures", () => {
    for (const status of [undefined, 400, 401, 403, 404, 409, 429, 500, 503]) {
      expect(canDiscardRejectedRecovery(true, status)).toBe(status === 409)
      expect(canDiscardRejectedRecovery(false, status)).toBe(
        status === 400 || status === 409
      )
    }
  })
  it("accepts only bounded delivery routes and filters", () => {
    expect(deliveryRoute("/admin/deliveries")).toEqual({ id: null })
    expect(deliveryRoute("/admin/deliveries/delivery-1")).toEqual({
      id: "delivery-1",
    })
    for (const path of [
      "/admin/deliveries/a/recover",
      "/admin/deliveries/%2F",
      "/admin/deliveries/..",
      `/admin/deliveries/${"a".repeat(129)}`,
    ])
      expect(deliveryRoute(path)).toBeNull()
    expect(deliveryQuery("limit=51")).toBeNull()
    expect(deliveryQuery("emailState=sent")).toBeNull()
    expect(deliveryQuery("payload=secret")).toBeNull()
    const query = {
      limit: 20,
      emailState: "review_needed",
      after: "delivery-1",
      kind: "order.tickets",
    } as const
    expect(deliveryQuery(deliverySearch(query))).toEqual(query)
  })
})
