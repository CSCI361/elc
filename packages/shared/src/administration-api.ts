import { z } from "zod"
import { entityIdSchema, requestIdSchema } from "./common"

export const administrationQuerySchema = z.strictObject({
  q: z.string().trim().max(200).default(""),
  after: entityIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  suspended: z.enum(["all", "yes", "no"]).default("all"),
})
export const accountAdministrationSchema = z.strictObject({
  id: entityIdSchema,
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  suspendedAt: z.iso.datetime().nullable(),
  revision: z.int().nonnegative(),
})
export const eventAdministrationSchema = z.strictObject({
  id: entityIdSchema,
  title: z.string(),
  organizerId: entityIdSchema,
  visibility: z.enum(["public", "unlisted", "private"]),
  publicationState: z.enum(["draft", "published", "unpublished"]),
  startsAt: z.iso.datetime(),
  suspendedAt: z.iso.datetime().nullable(),
  revision: z.int().nonnegative(),
})
export const accountAdministrationListSchema = z.strictObject({
  items: z.array(accountAdministrationSchema).max(50),
  nextCursor: entityIdSchema.nullable(),
})
export const eventAdministrationListSchema = z.strictObject({
  items: z.array(eventAdministrationSchema).max(50),
  nextCursor: entityIdSchema.nullable(),
})
export const suspensionRequestSchema = z.strictObject({
  requestId: requestIdSchema,
  expectedRevision: z.int().nonnegative(),
  suspended: z.boolean(),
  reason: z.string().trim().min(3).max(500),
})
export const suspensionResponseSchema = z.strictObject({
  kind: z.enum(["account", "event"]),
  id: entityIdSchema,
  revision: z.int().nonnegative(),
  suspendedAt: z.iso.datetime().nullable(),
})
export type AccountAdministration = z.infer<typeof accountAdministrationSchema>
export type EventAdministration = z.infer<typeof eventAdministrationSchema>
