import { z } from "zod"
import { activationProfileSchema } from "./activation-api"
import { requestIdSchema, utcTimestampSchema } from "./common"

export const organizerProfileResponseSchema = z
  .strictObject({
    profile: activationProfileSchema.nullable(),
    revision: z.int().nonnegative(),
    updatedAt: utcTimestampSchema.nullable(),
  })
  .superRefine((value, context) => {
    if (
      value.profile === null
        ? value.revision !== 0 || value.updatedAt !== null
        : value.revision === 0 || value.updatedAt === null
    )
      context.addIssue({
        code: "custom",
        message: "Profile revision and update time must match its existence.",
      })
  })
export const updateOrganizerProfileSchema = z.strictObject({
  requestId: requestIdSchema,
  expectedRevision: z.int().nonnegative(),
  profile: activationProfileSchema,
})
export const organizerProfileMutationResponseSchema = z.strictObject({
  revision: z.int().positive(),
  updatedAt: utcTimestampSchema,
})
export type OrganizerProfileResponse = z.infer<
  typeof organizerProfileResponseSchema
>
export type UpdateOrganizerProfile = z.infer<
  typeof updateOrganizerProfileSchema
>
export type OrganizerProfileMutationResponse = z.infer<
  typeof organizerProfileMutationResponseSchema
>
