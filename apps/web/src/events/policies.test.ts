import { describe, expect, it } from "vite-plus/test"
import {
  dateFromInput,
  dateInput,
  parsePrice,
  purchasableSeats,
  remainingSeconds,
  safePaymentUrl,
  selectedBasket,
  withoutPaymentSecrets,
  type Inventory,
  type Seat,
} from "./policies"

describe("event purchase policies", () => {
  it("removes provider bearer credentials before payment return links can be built", () => {
    const url = new URL(
      "https://elc.test/payments/return?attempt=attempt-1&customer_session_token=private-fixture&customer_session_token=second&unexpected=private#private"
    )
    expect(withoutPaymentSecrets(url)).toBe(
      "/payments/return?attempt=attempt-1"
    )
    const staleSignIn = new URL("https://elc.test/auth/sign-in")
    staleSignIn.searchParams.set("returnTo", url.pathname + url.search)
    const sanitizedSignIn = new URL(
      withoutPaymentSecrets(staleSignIn),
      staleSignIn.origin
    )
    expect(sanitizedSignIn.searchParams.get("returnTo")).toBe(
      "/payments/return?attempt=attempt-1"
    )
    expect(sanitizedSignIn.href).not.toContain("private")
    expect(
      withoutPaymentSecrets(
        new URL("https://elc.test/events/demo?campaign=public-code")
      )
    ).toBe("/events/demo?campaign=public-code")
  })
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

  it("keeps inactive paid sales and closed ticket windows out of seat selection", () => {
    const now = Date.parse("2026-09-20T10:00:00Z")
    const type = (
      id: string,
      kind: "free" | "paid",
      salesEndAt = "2026-09-20T11:00:00Z"
    ): Inventory["ticketTypes"][number] => ({
      id,
      eventId: "event",
      currency: "KZT",
      kind,
      name: id,
      description: "",
      priceMinor: kind === "paid" ? 10000 : 0,
      quantity: 40,
      hidden: false,
      salesStartAt: "2026-09-20T09:00:00Z",
      salesEndAt,
      available: 40,
      reserved: 0,
      sold: 0,
      unavailable: 0,
    })
    const data: Inventory = {
      eventId: "event",
      revision: 1,
      seatingMode: "assigned",
      seats: [
        seat("1", "free"),
        seat("2", "paid"),
        seat("3", "closed"),
        seat("4", "paid", "held"),
      ],
      ticketTypes: [
        type("free", "free"),
        type("paid", "paid"),
        type("closed", "free", "2026-09-20T10:00:00Z"),
      ],
    }
    expect(
      purchasableSeats(data, false, now).map((value) => value.state)
    ).toEqual(["available", "unavailable", "unavailable", "held"])
    expect(purchasableSeats(data, true, now)[1]?.state).toBe("available")
    expect(() =>
      selectedBasket(purchasableSeats(data, false, now), ["1", "2"], {
        "1": "Ada",
        "2": "Bob",
      })
    ).toThrow("INVENTORY_UNAVAILABLE")
    expect(data.seats[1]?.state).toBe("available")
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
