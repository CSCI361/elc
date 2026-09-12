import { z } from "zod"
import { SUPPORT_LIVE_PROTOCOL } from "@elc/shared"

export const SUPPORT_PROTOCOL = SUPPORT_LIVE_PROTOCOL
export const REVALIDATE_MS = 30_000
export const MAX_CASE_SOCKETS = 32
export const MAX_SESSION_SOCKETS = 3
export const MAX_ACTOR_SOCKETS = 8
export const MAX_CONNECTION_MS = 30 * 60_000
export const MAX_CLIENT_BYTES = 256
export const MAX_CLIENT_MESSAGES_PER_MINUTE = 12
export const MAX_UPDATES_PER_MINUTE = 120

const id = z.string().min(1).max(128)
export const liveQuerySchema = z.strictObject({
  after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
})
export const connectionSchema = z.strictObject({
  version: z.literal(1),
  caseId: id,
  actorId: id,
  sessionId: id,
  connectedAt: z.int().nonnegative(),
  lastSentSequence: z.int().nonnegative(),
  inputWindowAt: z.int().nonnegative(),
  inputCount: z.int().nonnegative(),
  outputWindowAt: z.int().nonnegative(),
  outputCount: z.int().nonnegative(),
})
export type Connection = z.infer<typeof connectionSchema>
export const clientMessageSchema = z.strictObject({ type: z.literal("ping") })
export const liveJobSchema = z.strictObject({
  outboxId: z.string().min(1).max(256),
})

/** No message body, subject, actor identity or account token is sent over the live channel. */
export type { SupportLiveFrame } from "@elc/shared"
