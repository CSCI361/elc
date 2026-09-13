import { z } from "zod"
import { entityIdSchema, utcTimestampSchema } from "./common"
import { discountSchema } from "./money"

export const resolveCampaignRequestSchema = z.strictObject({
  code: z.string().trim().min(1).max(64),
})

export const resolveCampaignResponseSchema = z.strictObject({
  eventId: entityIdSchema,
  campaign: z.strictObject({
    id: entityIdSchema,
    name: z.string().trim().min(1).max(100),
    discount: discountSchema,
    startsAt: utcTimestampSchema,
    endsAt: utcTimestampSchema,
    applicableTicketTypeIds: z.array(entityIdSchema).min(1),
  }),
  serverNow: utcTimestampSchema,
})

export type ResolvedCampaign = z.infer<typeof resolveCampaignResponseSchema>
