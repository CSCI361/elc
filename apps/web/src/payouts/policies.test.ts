import { describe, expect, it } from "vite-plus/test"
import { eventPayoutsResponseSchema } from "@elc/shared"
import {
  payoutCursor,
  payoutEventId,
  payoutPath,
  summaryMeasures,
} from "./policies"

describe("payout report boundaries", () => {
  it("accepts only the bounded event route and safely decodes its reference", () => {
    expect(payoutEventId("/organizer/events/event%20name/payouts")).toBe(
      "event name"
    )
    expect(payoutEventId("/organizer/events/%/payouts")).toBeNull()
    expect(payoutEventId("/organizer/events/event/payouts/extra")).toBeNull()
    expect(payoutEventId("/events/event/payouts")).toBeNull()
  })
  it("encodes event references and uses only a valid bounded cursor", () => {
    expect(payoutPath("event/?secret", "123:record-id")).toBe(
      "/events/event%2F%3Fsecret/payouts?limit=20&before=123%3Arecord-id"
    )
    expect(payoutCursor("?before=123%3Arecord-id&limit=9999")).toBe(
      "123:record-id"
    )
    expect(payoutCursor("?before=https%3A%2F%2Felsewhere.test")).toBe("")
  })
  it("keeps immutable payout totals and later negative adjustments as separate measures", () => {
    expect(summaryMeasures).toContain("simulatedPaidMinor")
    expect(summaryMeasures).toContain("adjustmentMinor")
    expect(new Set(summaryMeasures).size).toBe(9)
    const summary = eventPayoutsResponseSchema.shape.summary
    const values = Object.fromEntries(
      summaryMeasures.map((key) => [
        key,
        key === "adjustmentMinor" ? -9700 : 10000,
      ])
    )
    expect(summary.parse(values).adjustmentMinor).toBe(-9700)
    expect(
      summary.safeParse({ ...values, adjustmentMinor: 9700 }).success
    ).toBe(false)
    expect(
      eventPayoutsResponseSchema.shape.simulation.safeParse(false).success
    ).toBe(false)
  })
})
