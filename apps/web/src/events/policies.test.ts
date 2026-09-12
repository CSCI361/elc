import { describe, expect, it } from "vite-plus/test"
import {
  dateFromInput,
  dateInput,
  parsePrice,
  remainingSeconds,
  safePaymentUrl,
  selectedBasket,
  type Seat,
} from "./policies"

describe("event purchase policies", () => {
  it("converts decimal KZT to minor units without binary rounding", () => {
    expect(parsePrice("4999.99")).toBe(499999)
    expect(parsePrice(" 12,5 ")).toBe(1250)
    expect(parsePrice("0")).toBe(0)
    for (const invalid of ["-1", "1.005", "1e3", "", "NaN", "9007199254740991"])
      expect(parsePrice(invalid)).toBeNull()
  })

  it("counts down from the fixed server deadline without renewing it on reload", () => {
    const expiry = "2026-09-20T10:10:00.000Z"
    expect(remainingSeconds(expiry, Date.parse("2026-09-20T10:00:00Z"))).toBe(
      600
    )
    expect(remainingSeconds(expiry, Date.parse("2026-09-20T10:04:00Z"))).toBe(
      360
    )
    expect(remainingSeconds(expiry, Date.parse(expiry))).toBe(0)
    expect(remainingSeconds(expiry, Date.parse(expiry) + 30000)).toBe(0)
  })

  it("uses the event time zone instead of the browser time zone", () => {
    expect(dateFromInput("2026-09-20T18:30", "Asia/Almaty")).toBe(
      "2026-09-20T13:30:00.000Z"
    )
    expect(dateInput("2026-09-20T13:30:00.000Z", "Asia/Almaty")).toBe(
      "2026-09-20T18:30"
    )
    expect(dateFromInput("2026-09-20T18:30", "Europe/London")).toBe(
      "2026-09-20T17:30:00.000Z"
    )
    expect(dateFromInput("2026-02-30T10:00", "Asia/Almaty")).toBeNull()
    expect(dateFromInput("2026-03-08T02:30", "America/New_York")).toBeNull()
  })

  it("rejects executable, credential-bearing and insecure external payment redirects", () => {
    const origin = "http://localhost:5173"
    expect(
      safePaymentUrl("https://sandbox.example.test/checkout", origin)
    ).toBe("https://sandbox.example.test/checkout")
    expect(
      safePaymentUrl("http://localhost:5173/payments/return", origin)
    ).toBe("http://localhost:5173/payments/return")
    for (const invalid of [
      null,
      "javascript:alert(1)",
      "data:text/html,test",
      "//external.test/",
      "https://user:secret@example.test",
      "http://external.test/",
    ])
      expect(safePaymentUrl(invalid, origin)).toBeNull()
  })
})

describe("assigned-seat basket", () => {
  const seat = (
    id: string,
    ticketTypeId: string,
    state: Seat["state"] = "available"
  ): Seat => ({
    id,
    ticketTypeId,
    state,
    section: "Standard",
    row: "A",
    number: id,
    accessible: false,
    enabled: true,
    priceMinor: 10000,
  })
  const inventory = [
    seat("1", "standard"),
    seat("2", "premium"),
    seat("3", "standard"),
    seat("4", "standard", "held"),
  ]

  it("groups seats by ticket type and preserves attendee-to-seat order", () => {
    expect(
      selectedBasket(inventory, ["3", "2", "1"], {
        "1": " Ada ",
        "2": "Bob",
        "3": "Cleo",
      })
    ).toEqual([
      {
        ticketTypeId: "standard",
        quantity: 2,
        seatIds: ["3", "1"],
        attendeeNames: ["Cleo", "Ada"],
      },
      {
        ticketTypeId: "premium",
        quantity: 1,
        seatIds: ["2"],
        attendeeNames: ["Bob"],
      },
    ])
  })

  it("does not submit a held, disabled, hidden or missing seat", () => {
    expect(() => selectedBasket(inventory, ["4"], { "4": "Ada" })).toThrow(
      "INVENTORY_UNAVAILABLE"
    )
    expect(() => selectedBasket(inventory, ["unknown"], {})).toThrow(
      "INVENTORY_UNAVAILABLE"
    )
    expect(() =>
      selectedBasket([{ ...inventory[0]!, enabled: false }], ["1"], {
        "1": "Ada",
      })
    ).toThrow("INVENTORY_UNAVAILABLE")
    expect(() =>
      selectedBasket([{ ...inventory[0]!, ticketTypeId: null }], ["1"], {
        "1": "Ada",
      })
    ).toThrow("INVENTORY_UNAVAILABLE")
  })

  it("requires an attendee name and never sends a client-provided price", () => {
    expect(() => selectedBasket(inventory, ["1"], { "1": "   " })).toThrow(
      "INVALID_INPUT"
    )
    const item = selectedBasket(inventory, ["1"], { "1": "Ada" })[0]!
    expect(item).not.toHaveProperty("priceMinor")
    expect(item).not.toHaveProperty("discountMinor")
  })
})
