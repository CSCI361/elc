import { z } from "zod"
import { entityIdSchema, localeSchema } from "./common"

export const authCapabilitiesSchema = z.strictObject({
  emailAndPassword: z.boolean(),
  emailDelivery: z.boolean(),
  google: z.boolean(),
})

export const accountResponseSchema = z.strictObject({
  user: z.strictObject({
    id: entityIdSchema,
    name: z.string(),
    email: z.email(),
    emailVerified: z.boolean(),
  }),
  profile: z.strictObject({
    locale: localeSchema,
    hasSavedLocale: z.boolean(),
  }),
})

export const updatePreferencesSchema = z.strictObject({ locale: localeSchema })
