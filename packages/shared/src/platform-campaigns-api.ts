import { z } from "zod"
import { entityIdSchema, utcTimestampSchema } from "./common"
import { discountSchema } from "./money"
import { historyRetentionSchema } from "./history-api"

export const platformCampaignsQuerySchema = z.strictObject({
  q: z.string().trim().max(200).default(""),
  eventId: entityIdSchema.optional(),
  organizerId: entityIdSchema.optional(),
  enabled: z.enum(["all", "yes", "no"]).default("all"),
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export const platformCampaignsResponseSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: entityIdSchema,
        eventId: entityIdSchema,
        eventTitle: z.string(),
        organizerId: entityIdSchema,
        name: z.string().trim().min(1).max(100),
        enabled: z.boolean(),
        discount: discountSchema,
        startsAt: utcTimestampSchema,
        endsAt: utcTimestampSchema,
        maxRedemptions: z.int().positive(),
        activeHolds: z.int().nonnegative(),
        committedRedemptions: z.int().nonnegative(),
        updatedAt: utcTimestampSchema,
        retention: historyRetentionSchema,
      })
    )
    .max(50),
  nextCursor: z.string().max(2048).nullable(),
  generatedAt: utcTimestampSchema,
})

export type PlatformCampaignsQuery = z.infer<
  typeof platformCampaignsQuerySchema
>
export type PlatformCampaignsResponse = z.infer<
  typeof platformCampaignsResponseSchema
>
