import { z } from "zod"
import { entityIdSchema, requestIdSchema } from "./common"

export const eventImageLimits = Object.freeze({
  count: 5,
  fileBytes: 5 * 1024 * 1024,
  pixels: 4_000_000,
  edge: 8192,
  altText: 500,
})
export const eventImageAltTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(eventImageLimits.altText)
export const eventImageSchema = z.strictObject({
  id: entityIdSchema,
  url: z
    .string()
    .regex(/^\/api\/events\/[A-Za-z0-9_-]+\/images\/[A-Za-z0-9_-]+$/),
  altText: eventImageAltTextSchema,
  position: z
    .int()
    .min(0)
    .max(eventImageLimits.count - 1),
  contentType: z.enum(["image/jpeg", "image/png"]),
  sizeBytes: z.int().min(1).max(eventImageLimits.fileBytes),
})
export const eventUploadImageRequestSchema = z.strictObject({
  requestId: requestIdSchema,
  expectedRevision: z.int().nonnegative(),
  altText: eventImageAltTextSchema,
})
export const updateEventImagesRequestSchema = z.strictObject({
  requestId: requestIdSchema,
  expectedRevision: z.int().nonnegative(),
  images: z
    .array(
      z.strictObject({ id: entityIdSchema, altText: eventImageAltTextSchema })
    )
    .max(eventImageLimits.count)
    .refine(
      (images) =>
        new Set(images.map((image) => image.id)).size === images.length
    ),
})
export type EventImage = z.infer<typeof eventImageSchema>
export type EventUploadImageRequest = z.infer<
  typeof eventUploadImageRequestSchema
>
export type UpdateEventImagesRequest = z.infer<
  typeof updateEventImagesRequestSchema
>
