import { describe, expect, it } from "vite-plus/test"

import {
  allocateDiscount,
  calculateOrderTotals,
  calculatePercentageAmount,
} from "./money"

describe("academic KZT calculations", () => {
  it("matches the documented KZT 10,000 order and keeps activation separate", () => {
    const totals = calculateOrderTotals(
      [{ unitPriceMinor: 1_000_000, quantity: 1, discountEligible: true }],
      { kind: "percentage", basisPoints: 1_000 }
    )
    expect(totals).toMatchObject({
      currency: "KZT",
      subtotalMinor: 1_000_000,
      discountMinor: 100_000,
      totalMinor: 900_000,
      processingFeeMinor: 27_000,
      estimatedPayoutMinor: 873_000,
    })
  })

  it("rounds half up without floating-point intermediates", () => {
    expect(calculatePercentageAmount(5, 1_000)).toBe(1)
    expect(calculatePercentageAmount(4, 1_000)).toBe(0)
    expect(calculatePercentageAmount(Number.MAX_SAFE_INTEGER, 10_000)).toBe(
      Number.MAX_SAFE_INTEGER
    )
  })

  it("allocates a once-rounded percentage instead of rounding each line", () => {
    const totals = calculateOrderTotals(
      [
        { unitPriceMinor: 5, quantity: 1, discountEligible: true },
        { unitPriceMinor: 5, quantity: 1, discountEligible: true },
      ],
      { kind: "percentage", basisPoints: 1_000 }
    )
    expect(totals.discountMinor).toBe(1)
    expect(totals.items.map((item) => item.discountMinor)).toEqual([1, 0])
  })

  it("caps a fixed discount at the applicable ticket subtotal", () => {
    const totals = calculateOrderTotals(
      [
        { unitPriceMinor: 100, quantity: 1, discountEligible: false },
        { unitPriceMinor: 50, quantity: 2, discountEligible: true },
      ],
      { kind: "fixed", amountMinor: 1_000 }
    )
    expect(totals.discountMinor).toBe(100)
    expect(totals.totalMinor).toBe(100)
    expect(totals.items.map((item) => item.discountMinor)).toEqual([0, 100])
  })

  it("charges no processing fee on free and fully discounted orders", () => {
    for (const totals of [
      calculateOrderTotals([
        { unitPriceMinor: 0, quantity: 3, discountEligible: false },
      ]),
      calculateOrderTotals(
        [{ unitPriceMinor: 1_000, quantity: 1, discountEligible: true }],
        { kind: "percentage", basisPoints: 10_000 }
      ),
    ]) {
      expect(totals.totalMinor).toBe(0)
      expect(totals.processingFeeMinor).toBe(0)
      expect(totals.estimatedPayoutMinor).toBe(0)
    }
  })

  it("rejects fractional, negative and overflowing monetary inputs", () => {
    expect(() => calculatePercentageAmount(1.5, 300)).toThrow()
    expect(() => calculatePercentageAmount(-1, 300)).toThrow()
    expect(() => calculatePercentageAmount(100, 10_001)).toThrow()
    expect(() =>
      calculateOrderTotals([
        {
          unitPriceMinor: Number.MAX_SAFE_INTEGER,
          quantity: 2,
          discountEligible: true,
        },
      ])
    ).toThrow(RangeError)
    expect(() =>
      calculateOrderTotals([
        {
          unitPriceMinor: Number.MAX_SAFE_INTEGER,
          quantity: 1,
          discountEligible: true,
        },
        { unitPriceMinor: 1, quantity: 1, discountEligible: true },
      ])
    ).toThrow(RangeError)
  })
})

describe("proportional discount allocation", () => {
  it("uses largest remainders and stable order for equal remainders", () => {
    expect(allocateDiscount([1, 2, 3], 2)).toEqual([0, 1, 1])
    expect(allocateDiscount([1, 1, 1], 2)).toEqual([1, 1, 0])
    expect(allocateDiscount([0, 1, 1], 1)).toEqual([0, 1, 0])
    expect(allocateDiscount([], 0)).toEqual([])
    expect(() => allocateDiscount([0, 0], 1)).toThrow(RangeError)
  })

  it("preserves the discount sum and each line's bounds across small baskets", () => {
    for (let first = 0; first < 8; first += 1) {
      for (let second = 0; second < 8; second += 1) {
        const original = [first, second, 3]
        const subtotal = first + second + 3
        for (let discount = 0; discount <= subtotal; discount += 1) {
          const shares = allocateDiscount(original, discount)
          expect(shares.reduce((sum, amount) => sum + amount, 0)).toBe(discount)
          shares.forEach((amount, index) => {
            expect(Number.isSafeInteger(amount)).toBe(true)
            expect(amount).toBeGreaterThanOrEqual(0)
            expect(amount).toBeLessThanOrEqual(original[index] ?? 0)
          })
        }
        expect(original).toEqual([first, second, 3])
      }
    }
  })
})
