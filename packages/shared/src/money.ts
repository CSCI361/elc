import { z } from "zod"

import { minorAmountSchema } from "./common"
import { policy } from "./policy"

const basisPointsSchema = z.int().min(0).max(10_000)
const maxSafeAmount = BigInt(Number.MAX_SAFE_INTEGER)

function toSafeAmount(value: bigint): number {
  if (value < 0n || value > maxSafeAmount) {
    throw new RangeError("The amount exceeds the supported integer range")
  }
  return Number(value)
}

/** Basis points avoid floating-point percentages: 10% is 1,000 basis points. */
export function calculatePercentageAmount(
  amountMinor: number,
  basisPoints: number
): number {
  minorAmountSchema.parse(amountMinor)
  basisPointsSchema.parse(basisPoints)
  const numerator = BigInt(amountMinor) * BigInt(basisPoints)
  return toSafeAmount((numerator + 5_000n) / 10_000n)
}

/** Allocate one rounded discount; ties follow the original item order. */
export function allocateDiscount(
  itemSubtotalsMinor: readonly number[],
  discountMinor: number
): number[] {
  itemSubtotalsMinor.forEach((amount) => minorAmountSchema.parse(amount))
  minorAmountSchema.parse(discountMinor)
  const subtotal = itemSubtotalsMinor.reduce(
    (sum, amount) => sum + BigInt(amount),
    0n
  )
  toSafeAmount(subtotal)
  if (BigInt(discountMinor) > subtotal) {
    throw new RangeError("The discount cannot exceed the eligible subtotal")
  }
  if (subtotal === 0n) return itemSubtotalsMinor.map(() => 0)

  const shares = itemSubtotalsMinor.map((amount, index) => {
    const numerator = BigInt(amount) * BigInt(discountMinor)
    return {
      index,
      amount: numerator / subtotal,
      remainder: numerator % subtotal,
    }
  })
  let remaining =
    BigInt(discountMinor) -
    shares.reduce((sum, share) => sum + share.amount, 0n)
  const ranked = [...shares].sort((left, right) =>
    left.remainder === right.remainder
      ? left.index - right.index
      : left.remainder > right.remainder
        ? -1
        : 1
  )
  for (const share of ranked) {
    if (remaining === 0n) break
    share.amount += 1n
    remaining -= 1n
  }
  return shares.map((share) => toSafeAmount(share.amount))
}

export const discountSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("percentage"),
    basisPoints: z.int().min(100).max(10_000),
  }),
  z.strictObject({ kind: z.literal("fixed"), amountMinor: z.int().positive() }),
])

const pricedItemSchema = z.strictObject({
  unitPriceMinor: minorAmountSchema,
  quantity: z.int().positive(),
  discountEligible: z.boolean(),
})

export type Discount = z.infer<typeof discountSchema>
export type PricedItem = z.infer<typeof pricedItemSchema>
export type OrderTotals = {
  currency: "KZT"
  subtotalMinor: number
  discountMinor: number
  totalMinor: number
  processingFeeMinor: number
  estimatedPayoutMinor: number
  items: {
    subtotalMinor: number
    discountMinor: number
    totalMinor: number
  }[]
}

/** Call with authoritative ticket prices and applicability resolved by the API. */
export function calculateOrderTotals(
  items: readonly PricedItem[],
  discount?: Discount,
  processingFeeBasisPoints = policy.processingFeeBasisPoints
): OrderTotals {
  z.array(pricedItemSchema).min(1).parse(items)
  basisPointsSchema.parse(processingFeeBasisPoints)
  const subtotals = items.map((item) =>
    toSafeAmount(BigInt(item.unitPriceMinor) * BigInt(item.quantity))
  )
  const subtotalMinor = toSafeAmount(
    subtotals.reduce((sum, amount) => sum + BigInt(amount), 0n)
  )
  const eligibleSubtotals = subtotals.map((amount, index) =>
    items[index]?.discountEligible ? amount : 0
  )
  const eligibleSubtotal = toSafeAmount(
    eligibleSubtotals.reduce((sum, amount) => sum + BigInt(amount), 0n)
  )
  let discountMinor = 0
  if (discount) {
    const parsed = discountSchema.parse(discount)
    discountMinor =
      parsed.kind === "percentage"
        ? calculatePercentageAmount(eligibleSubtotal, parsed.basisPoints)
        : Math.min(parsed.amountMinor, eligibleSubtotal)
  }
  const discounts = allocateDiscount(eligibleSubtotals, discountMinor)
  const totalMinor = subtotalMinor - discountMinor
  const processingFeeMinor = calculatePercentageAmount(
    totalMinor,
    processingFeeBasisPoints
  )

  return {
    currency: policy.currency,
    subtotalMinor,
    discountMinor,
    totalMinor,
    processingFeeMinor,
    estimatedPayoutMinor: totalMinor - processingFeeMinor,
    items: subtotals.map((subtotal, index) => ({
      subtotalMinor: subtotal,
      discountMinor: discounts[index] ?? 0,
      totalMinor: subtotal - (discounts[index] ?? 0),
    })),
  }
}
