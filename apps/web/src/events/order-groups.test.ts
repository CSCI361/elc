import { describe, expect, it } from "vite-plus/test"
import { groupOrders } from "./order-groups"

const now = Date.parse("2026-11-21T12:00:00.000Z")
const order = (id: string, eventStartsAt: string, state = "completed") => ({
  id,
  eventStartsAt,
  state,
})

describe("groupOrders", () => {
  it("should list upcoming events soonest first", () => {
    const { upcoming } = groupOrders(
      [
        order("dec20", "2026-12-20T03:00:00.000Z"),
        order("nov26", "2026-11-26T14:00:00.000Z"),
        order("dec08", "2026-12-08T14:00:00.000Z"),
      ],
      now
    )
    expect(upcoming.map((item) => item.id)).toEqual(["nov26", "dec08", "dec20"])
  })

  it("should put past events in their own group, most recent first", () => {
    const { upcoming, past } = groupOrders(
      [
        order("sep21", "2026-09-21T13:00:00.000Z"),
        order("nov25", "2026-11-25T04:00:00.000Z"),
        order("sep28", "2026-09-28T14:00:00.000Z"),
      ],
      now
    )
    expect(upcoming.map((item) => item.id)).toEqual(["nov25"])
    expect(past.map((item) => item.id)).toEqual(["sep28", "sep21"])
  })

  it("should treat cancelled, refunded and expired orders as past even when the event is ahead", () => {
    const { upcoming, past } = groupOrders(
      [
        order("cancelled", "2026-12-08T14:00:00.000Z", "cancelled"),
        order("refunded", "2026-12-09T14:00:00.000Z", "refunded"),
        order("expired", "2026-12-10T14:00:00.000Z", "expired"),
        order("pending", "2026-12-11T14:00:00.000Z", "pending"),
      ],
      now
    )
    expect(upcoming.map((item) => item.id)).toEqual(["pending"])
    expect(past.map((item) => item.id)).toEqual([
      "expired",
      "refunded",
      "cancelled",
    ])
  })

  it("should not change the input list", () => {
    const items = [
      order("b", "2026-12-20T03:00:00.000Z"),
      order("a", "2026-11-26T14:00:00.000Z"),
    ]
    groupOrders(items, now)
    expect(items.map((item) => item.id)).toEqual(["b", "a"])
  })
})
