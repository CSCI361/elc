import { describe, expect, it } from "vite-plus/test"
import {
  supportLiveFrameSchema,
  type OrderRefundResponse,
  type SupportCase,
} from "@elc/shared"
import { createSupportSignalLedger } from "./live"
import {
  financialActionAvailable,
  matchingRefundCase,
  readSupportContext,
  supportCategories,
  supportHref,
  isSupportPath,
} from "./policies"
const financial = {
  canApprove: true,
  voluntaryEligible: true,
  refund: null,
  orderState: "completed",
  admissionBlocked: false,
} as OrderRefundResponse

describe("support and refund boundaries", () => {
  it("requires financial authority and current eligibility independently", () => {
    expect(financialActionAvailable(financial)).toBe(true)
    for (const change of [
      { canApprove: false },
      { voluntaryEligible: false },
      { orderState: "cancelled" },
      { admissionBlocked: true },
      { refund: { state: "pending" } },
    ])
      expect(
        financialActionAvailable({
          ...financial,
          ...change,
        } as OrderRefundResponse)
      ).toBe(false)
  })
  it("accepts only an unresolved attendee refund reference for the same order", () => {
    const value = {
      orderId: "order",
      audience: "attendee",
      category: "refund",
      status: "open",
    } as SupportCase
    expect(matchingRefundCase(value, "order")).toBe(true)
    for (const change of [
      { orderId: "other" },
      { audience: "organizer_platform" },
      { category: "compensation" },
      { status: "resolved" },
    ])
      expect(
        matchingRefundCase({ ...value, ...change } as SupportCase, "order")
      ).toBe(false)
  })
  it("keeps financial categories attached to an order or ticket", () => {
    expect(supportCategories({ eventId: "event" }, "attendee")).not.toContain(
      "refund"
    )
    expect(supportCategories({ orderId: "order" }, "attendee")).toContain(
      "refund"
    )
    expect(supportCategories({}, "organizer_platform")).not.toContain(
      "compensation"
    )
  })
  it("uses a bounded context and URL-encodes references", () => {
    const value = readSupportContext(
      "?orderId=a%2Fb%3Fc%3Dd&audience=attendee&category=refund&token=secret&returnTo=https://evil.test"
    )
    expect(value).toEqual({
      orderId: "a/b?c=d",
      audience: "attendee",
      category: "refund",
    })
    const href = supportHref(value)
    expect(href).toBe(
      "/support/new?orderId=a%2Fb%3Fc%3Dd&audience=attendee&category=refund"
    )
    expect(isSupportPath("/orders/order/refund")).toBe(true)
    expect(isSupportPath("/support/cases/case/other")).toBe(false)
  })
})
describe("support live invalidation", () => {
  it("does not reload an already current initial subscription", () => {
    const receive = createSupportSignalLedger("case", 5)
    expect(
      receive({
        type: "ready",
        version: 1,
        caseId: "case",
        throughSequence: 5,
        revalidateAfterMs: 30000,
      })
    ).toBe(false)
    expect(
      receive({
        type: "ready",
        version: 1,
        caseId: "case",
        throughSequence: 8,
        revalidateAfterMs: 30000,
      })
    ).toBe(true)
  })
  it("deduplicates updates and recovers gaps through a fresh REST read", () => {
    const receive = createSupportSignalLedger("case", 5)
    const update = {
      type: "case_update" as const,
      version: 1 as const,
      caseId: "case",
      updateId: "update",
      sequence: 9,
    }
    expect(receive(update)).toBe(true)
    expect(receive(update)).toBe(false)
    expect(receive({ ...update, updateId: "older", sequence: 6 })).toBe(false)
    expect(
      receive({
        ...update,
        caseId: "other",
        updateId: "foreign",
        sequence: 100,
      })
    ).toBe(false)
    expect(receive({ ...update, updateId: "next", sequence: 10 })).toBe(true)
  })
  it("uses heartbeat progress for catch-up without accepting message content", () => {
    const receive = createSupportSignalLedger("case", 2)
    expect(receive({ type: "pong", version: 1, throughSequence: 4 })).toBe(true)
    expect(
      supportLiveFrameSchema.safeParse({
        type: "case_update",
        version: 1,
        caseId: "case",
        updateId: "u",
        sequence: 5,
        body: "private text",
      }).success
    ).toBe(false)
    expect(
      supportLiveFrameSchema.safeParse({
        type: "case_update",
        version: 1,
        caseId: "case",
        updateId: "u",
        sequence: -1,
      }).success
    ).toBe(false)
  })
})
