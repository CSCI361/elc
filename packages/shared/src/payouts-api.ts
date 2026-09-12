import { z } from "zod"

export const payoutListQuerySchema = z.object({
  before: z
    .string()
    .regex(/^\d{1,16}:[A-Za-z0-9-]{1,100}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export const eventPayoutsResponseSchema = z.object({
  eventId: z.string(),
  eventTitle: z.string(),
  timeZone: z.string(),
  simulation: z.literal(true),
  currency: z.literal("KZT"),
  eligibleAt: z.iso.datetime(),
  summary: z.object({
    completedPaymentsMinor: z.int().nonnegative(),
    confirmedRefundsMinor: z.int().nonnegative(),
    remainingProcessingFeesMinor: z.int().nonnegative(),
    estimatedContributionMinor: z.int().nonnegative(),
    simulatedPaidMinor: z.int().nonnegative(),
    adjustmentMinor: z.int().nonpositive(),
    outstandingMinor: z.int().nonnegative(),
    heldMinor: z.int().nonnegative(),
    availableMinor: z.int().nonnegative(),
  }),
  payouts: z.array(
    z.object({
      id: z.string(),
      amountMinor: z.int().nonnegative(),
      orderCount: z.int().positive(),
      completedAt: z.iso.datetime(),
      items: z.array(
        z.object({
          orderId: z.string(),
          paidMinor: z.int().positive(),
          processingFeeMinor: z.int().nonnegative(),
          contributionMinor: z.int().nonnegative(),
          adjustment: z
            .object({
              id: z.string(),
              refundId: z.string(),
              amountMinor: z.int().nonpositive(),
              createdAt: z.iso.datetime(),
            })
            .nullable(),
        })
      ),
    })
  ),
  nextCursor: z.string().nullable(),
})
export type EventPayoutsResponse = z.infer<typeof eventPayoutsResponseSchema>
