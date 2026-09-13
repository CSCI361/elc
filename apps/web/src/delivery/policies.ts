import {
  deliveryIdSchema,
  deliveryListQuerySchema,
  requestDeliveryRecoverySchema,
} from "@elc/shared"
import { z } from "zod"

const pendingSchema = z.strictObject({
  version: z.literal(1),
  accountId: z.string().min(1).max(128),
  deliveryId: deliveryIdSchema,
  input: requestDeliveryRecoverySchema,
})
export type PendingRecovery = z.infer<typeof pendingSchema>
export const recoveryKey = (accountId: string, deliveryId: string) =>
  `elc:delivery-recovery:${encodeURIComponent(accountId)}:${encodeURIComponent(deliveryId)}`
export function readPending(
  raw: string | null,
  accountId: string,
  deliveryId: string
) {
  try {
    const value = pendingSchema.parse(JSON.parse(raw ?? "null"))
    return value.accountId === accountId && value.deliveryId === deliveryId
      ? value
      : null
  } catch {
    return null
  }
}
export { deliveryRoute } from "./route"
export function deliveryQuery(search: string) {
  const input = deliveryListQuerySchema.safeParse(
    Object.fromEntries(new URLSearchParams(search))
  )
  return input.success ? input.data : null
}
export function deliverySearch(query: unknown) {
  const input = deliveryListQuerySchema.parse(query),
    params = new URLSearchParams()
  for (const [key, value] of Object.entries(input))
    if (value !== undefined) params.set(key, String(value))
  return params.toString()
}
export function canDiscardRejectedRecovery(
  wasUncertain: boolean,
  status?: number
) {
  // The API checks the exact immutable receipt before returning a state conflict.
  return status === 409 || (!wasUncertain && status === 400)
}
