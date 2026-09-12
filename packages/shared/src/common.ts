import { z } from "zod"

import { policy, supportedLocales } from "./policy"

export const entityIdSchema = z.string().trim().min(1).max(128)
export const requestIdSchema = z.string().trim().min(1).max(128)
export const localeSchema = z.enum(supportedLocales)
export const currencySchema = z.literal(policy.currency)
export const minorAmountSchema = z.int().nonnegative()
export const utcTimestampSchema = z.iso.datetime()
export const timeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    if (/^[+-]/.test(value)) return false
    try {
      new Intl.DateTimeFormat("en", { timeZone: value })
      return true
    } catch {
      return false
    }
  }, "Use a supported IANA time-zone identifier")

export const apiErrorCodeSchema = z.enum([
  "INVALID_INPUT",
  "UNAUTHENTICATED",
  "EMAIL_NOT_VERIFIED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "EVENT_UNAVAILABLE",
  "PAID_SALES_INACTIVE",
  "SALES_CLOSED",
  "INVENTORY_UNAVAILABLE",
  "RESERVATION_EXPIRED",
  "CHECKOUT_FROZEN",
  "PROMO_INVALID",
  "PROMO_EXHAUSTED",
  "PAYMENT_MISMATCH",
  "REFUND_INELIGIBLE",
  "INVALID_ADMISSION",
  "ALREADY_CHECKED_IN",
  "SNAPSHOT_EXPIRED",
  "ATTACHMENT_REJECTED",
  "RATE_LIMITED",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
])

export const apiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: apiErrorCodeSchema,
    message: z.string().min(1),
    requestId: requestIdSchema,
    fields: z.record(z.string(), z.array(z.string())).optional(),
  }),
})

export const paginationQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export function paginatedSchema<Item extends z.ZodType>(item: Item) {
  return z.strictObject({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  })
}

export type ApiError = z.infer<typeof apiErrorSchema>
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>
export type Locale = z.infer<typeof localeSchema>
export type PaginationQuery = z.infer<typeof paginationQuerySchema>
