import { z } from "zod"
import { eventRevisionRequestSchema } from "./events-api"

export const cancelEventRequestSchema = eventRevisionRequestSchema.extend({
  reason: z.string().trim().min(3).max(500),
})
