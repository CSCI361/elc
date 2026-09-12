import { z } from "zod"
import {
  currencySchema,
  entityIdSchema,
  requestIdSchema,
  utcTimestampSchema,
} from "./common"
import { paidSalesStateSchema } from "./states"
import { paymentResponseSchema } from "./payments-api"

export const DEMO_PAID_TERMS_VERSION = "elc-demo-paid-2026-09-13"
export const DEMO_PAID_TERMS_TEXT =
  "This academic demonstration uses sandbox payments, simulated identity and payout checks, and a dummy payout account. No real money, bank transfer, or identity verification is involved. The per-event activation fee is non-refundable after activation succeeds. A payment that cannot complete activation is refunded in the sandbox."
export const simulatedCheckStateSchema = z.enum(["pending", "passed", "failed"])
export const activationProfileSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(120),
  legalName: z.string().trim().min(1).max(200),
  contact: z.string().trim().min(3).max(200),
  dummyPayoutReference: z
    .string()
    .trim()
    .regex(
      /^DEMO-[A-Za-z0-9_-]{3,60}$/,
      "Use a dummy DEMO- reference, never bank credentials."
    ),
})
export const updateActivationSchema = z.strictObject({
  requestId: requestIdSchema,
  expectedRevision: z.int().nonnegative(),
  profile: activationProfileSchema,
  identityCheck: z.enum(["passed", "failed"]),
  payoutCheck: z.enum(["passed", "failed"]),
  acceptedTermsVersion: z.literal(DEMO_PAID_TERMS_VERSION).nullable(),
})
export const startActivationPaymentSchema = z.strictObject({
  requestId: requestIdSchema,
  expectedRevision: z.int().nonnegative(),
})
export const activationSettingsSchema = z.strictObject({
  feeMinor: z.int().min(30_000).max(100_000_000),
  currency: currencySchema,
  revision: z.int().nonnegative(),
})
export const updateActivationSettingsSchema = z.strictObject({
  requestId: requestIdSchema,
  expectedRevision: z.int().nonnegative(),
  feeMinor: activationSettingsSchema.shape.feeMinor,
})
export const activationModerationSchema = z.strictObject({
  requestId: requestIdSchema,
  expectedRevision: z.int().nonnegative(),
  suspended: z.boolean(),
  reason: z.string().trim().min(3).max(500),
})
const checkSchema = z.strictObject({
  state: simulatedCheckStateSchema,
  checkedAt: utcTimestampSchema.nullable(),
})
export const activationResponseSchema = z.strictObject({
  activation: z.strictObject({
    eventId: entityIdSchema,
    revision: z.int().nonnegative(),
    eventRevision: z.int().nonnegative(),
    eligibility: paidSalesStateSchema,
    blockers: z.array(
      z.enum([
        "email_unverified",
        "account_suspended",
        "event_suspended",
        "event_cancelled",
        "event_ended",
        "paid_sales_suspended",
        "paid_ticket_required",
        "profile_incomplete",
        "identity_check",
        "payout_check",
        "terms_required",
        "fee_required",
      ])
    ),
    profile: activationProfileSchema.nullable(),
    profileUpdatedAt: utcTimestampSchema.nullable(),
    emailVerified: z.boolean(),
    emailCheckedAt: utcTimestampSchema.nullable(),
    identityCheck: checkSchema,
    payoutCheck: checkSchema,
    terms: z.strictObject({
      version: z.literal(DEMO_PAID_TERMS_VERSION),
      text: z.literal(DEMO_PAID_TERMS_TEXT),
      acceptedVersion: z.string().nullable(),
      acceptedAt: utcTimestampSchema.nullable(),
    }),
    fee: z.strictObject({
      configuredMinor: z.int().positive(),
      configuredRevision: z.int().nonnegative(),
      currency: currencySchema,
      successfulPaymentAttemptId: entityIdSchema.nullable(),
      paidMinor: z.int().positive().nullable(),
      activatedAt: utcTimestampSchema.nullable(),
      refundable: z.boolean(),
    }),
    latestPayment: paymentResponseSchema.shape.payment.nullable(),
    suspendedAt: utcTimestampSchema.nullable(),
    suspensionReason: z.string().nullable(),
  }),
})
export type ActivationResponse = z.infer<typeof activationResponseSchema>
export type UpdateActivation = z.infer<typeof updateActivationSchema>
export type StartActivationPayment = z.infer<
  typeof startActivationPaymentSchema
>
export type ActivationSettings = z.infer<typeof activationSettingsSchema>
