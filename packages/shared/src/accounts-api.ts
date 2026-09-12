import { z } from "zod"
import {
  currencySchema,
  entityIdSchema,
  localeSchema,
  paginatedSchema,
  utcTimestampSchema,
} from "./common"
import { orderStateSchema } from "./states"

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

export const accountOrdersResponseSchema = paginatedSchema(
  z.strictObject({
    id: entityIdSchema,
    eventId: entityIdSchema,
    eventTitle: z.string(),
    eventStartsAt: utcTimestampSchema,
    state: orderStateSchema,
    totalMinor: z.int().nonnegative(),
    currency: currencySchema,
    createdAt: utcTimestampSchema,
  })
)
