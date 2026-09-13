import {
  symmetricDecrypt,
  symmetricEncrypt,
  verifyJWT,
} from "better-auth/crypto"
import { z } from "zod"
import type { Bindings } from "../env"
import { assertSql } from "../db/transitions"
import {
  createResendEmailAdapter,
  freezeEmailRequest,
  EmailTransportError,
} from "../delivery/email"
import {
  deliveryDigest,
  deliveryOutboxId,
  processEmailDelivery,
  type DeliveryDependencies,
  type DeliveryRow,
} from "../delivery/jobs"
import {
  AuthDeliveryError,
  hasEmailTransport,
  type AuthDependencies,
  type AuthEmail,
} from "./email"

type Environment = Pick<
  Bindings,
  | "DB"
  | "FILES"
  | "DELIVERY"
  | "ENVIRONMENT"
  | "AUTH_SECRET"
  | "APP_ORIGIN"
  | "AUTH_URL"
  | "EMAIL_FROM"
  | "RESEND_API_KEY"
>
const emailSchema = z.strictObject({
  kind: z.enum(["verify-email", "reset-password"]),
  to: z.email().max(254),
  subject: z.string().max(200),
  text: z.string().max(65536),
})
const intentSchema = z.strictObject({
  deliveryId: z.string(),
  recipientId: z.string(),
  expiresAt: z.number().int(),
  email: emailSchema,
})
type Intent = z.infer<typeof intentSchema>
const encryptionKey = (env: Environment) =>
  `elc-auth-email-v1\n${env.AUTH_SECRET}`
export const isAuthDelivery = (row: Pick<DeliveryRow, "kind">) =>
  row.kind === "verify-email" || row.kind === "reset-password"

function linkFor(env: Environment, email: AuthEmail) {
  const links = email.text
    .split("\n")
    .filter((line) => /^https?:\/\//.test(line))
  if (links.length !== 1) return null
  const link = new URL(links[0]!)
  const base = new URL(env.AUTH_URL ?? env.APP_ORIGIN)
  if (
    link.origin !== base.origin ||
    link.username ||
    link.password ||
    link.hash
  )
    return null
  if (email.kind === "verify-email") {
    const tokens = link.searchParams.getAll("token")
    return link.pathname === "/api/auth/verify-email" &&
      tokens.length === 1 &&
      tokens[0]
      ? { token: tokens[0], identifier: null }
      : null
  }
  const match = /^\/api\/auth\/reset-password\/([A-Za-z0-9_-]{1,256})$/.exec(
    link.pathname
  )
  return match
    ? { token: match[1]!, identifier: `reset-password:${match[1]}` }
    : null
}

async function binding(env: Environment, email: AuthEmail, now: number) {
  const link = linkFor(env, email)
  if (!link) return null
  const user =
    await env.DB.prepare(`SELECT u.id,u.email,u.email_verified FROM user u
    LEFT JOIN profiles p ON p.user_id=u.id WHERE u.email=? AND p.suspended_at IS NULL`)
      .bind(email.to)
      .first<{ id: string; email: string; email_verified: number }>()
  if (!user) return null
  if (email.kind === "verify-email") {
    if (user.email_verified !== 0) return null
    const token = await verifyJWT(link.token, env.AUTH_SECRET)
    if (
      !token ||
      token.email !== user.email.toLowerCase() ||
      token.updateTo !== undefined ||
      typeof token.exp !== "number" ||
      !Number.isSafeInteger(token.exp)
    )
      return null
    const expiresAt = token.exp * 1000
    return expiresAt > now && expiresAt <= now + 3600000
      ? { user, expiresAt, identifier: null }
      : null
  }
  const token = await env.DB.prepare(
    "SELECT expires_at FROM verification WHERE identifier=? AND value=? AND expires_at>? ORDER BY expires_at DESC LIMIT 1"
  )
    .bind(link.identifier, user.id, now)
    .first<{ expires_at: number }>()
  return token && token.expires_at <= now + 3600000
    ? { user, expiresAt: token.expires_at, identifier: link.identifier }
    : null
}

async function intentId(
  recipientId: string,
  email: AuthEmail,
  expiresAt: number
) {
  return `auth-${await deliveryDigest(JSON.stringify({ recipientId, email, expiresAt }))}`
}

export function createAuthDeliverySources(
  env: Environment,
  options: { now?: () => number } = {}
): Pick<DeliveryDependencies, "readCurrent" | "prepare"> {
  const now = options.now ?? Date.now
  async function load(
    row: DeliveryRow
  ): Promise<{ intent: Intent; version: string } | null> {
    if (
      !isAuthDelivery(row) ||
      row.event_id !== null ||
      row.entity_id !== row.recipient_id ||
      row.source_id !== `auth-mail:${row.id}` ||
      row.part_key !== "" ||
      row.metadata_json !== "{}"
    )
      return null
    const stored = await env.DB.prepare(
      "SELECT encrypted_payload,expires_at FROM auth_email_intents WHERE delivery_id=? AND encrypted_payload IS NOT NULL AND expires_at>? AND created_at<=?"
    )
      .bind(row.id, now(), now())
      .first<{ encrypted_payload: string; expires_at: number }>()
    if (!stored) return null
    let intent: Intent
    try {
      intent = intentSchema.parse(
        JSON.parse(
          await symmetricDecrypt({
            key: encryptionKey(env),
            data: stored.encrypted_payload,
          })
        )
      )
    } catch {
      return null
    }
    if (
      intent.deliveryId !== row.id ||
      intent.recipientId !== row.recipient_id ||
      intent.email.kind !== row.kind ||
      intent.expiresAt !== stored.expires_at ||
      (await intentId(intent.recipientId, intent.email, intent.expiresAt)) !==
        row.id
    )
      return null
    const current = await binding(env, intent.email, now())
    if (
      !current ||
      current.user.id !== row.recipient_id ||
      current.expiresAt !== intent.expiresAt
    )
      return null
    return {
      intent,
      version: await deliveryDigest(
        JSON.stringify({ intent, from: env.EMAIL_FROM })
      ),
    }
  }
  return {
    async readCurrent(row) {
      const current = await load(row)
      return current
        ? { version: current.version, recipient: current.intent.email.to }
        : null
    },
    async prepare(row, current) {
      const loaded = await load(row)
      if (
        !loaded ||
        loaded.version !== current.version ||
        loaded.intent.email.to !== current.recipient
      )
        throw new EmailTransportError("INVALID_REQUEST", "permanent")
      return freezeEmailRequest({
        deliveryId: row.id,
        idempotencyKey: `elc-email/${row.id}`,
        from: env.EMAIL_FROM,
        to: loaded.intent.email.to,
        subject: loaded.intent.email.subject,
        text: loaded.intent.email.text,
      })
    },
  }
}

/** Commit a short-lived encrypted intent before publishing. Cron recovers lost queue messages. */
export async function enqueueAuthEmail(
  env: Environment,
  input: AuthEmail,
  options: { now?: () => number } = {}
): Promise<string | null> {
  const now = options.now ?? Date.now
  const email = emailSchema.parse(input)
  const at = now()
  const current = await binding(env, email, at)
  if (!current) return null
  const id = await intentId(current.user.id, email, current.expiresAt)
  freezeEmailRequest({
    deliveryId: id,
    idempotencyKey: `elc-email/${id}`,
    from: env.EMAIL_FROM,
    to: email.to,
    subject: email.subject,
    text: email.text,
  })
  const intent: Intent = {
    deliveryId: id,
    recipientId: current.user.id,
    expiresAt: current.expiresAt,
    email,
  }
  const encrypted = await symmetricEncrypt({
    key: encryptionKey(env),
    data: JSON.stringify(intent),
  })
  const sourceId = `auth-mail:${id}`
  await env.DB.batch([
    ...assertSql(
      env.DB,
      `EXISTS(SELECT 1 FROM user u LEFT JOIN profiles p ON p.user_id=u.id
      WHERE u.id=? AND u.email=? AND p.suspended_at IS NULL AND (?<>'verify-email' OR u.email_verified=0))
      AND ? > ? AND (? IS NULL OR EXISTS(SELECT 1 FROM verification WHERE identifier=? AND value=? AND expires_at=?))`,
      [
        current.user.id,
        email.to,
        email.kind,
        current.expiresAt,
        now(),
        current.identifier,
        current.identifier,
        current.user.id,
        current.expiresAt,
      ]
    ),
    env.DB.prepare(
      "INSERT OR IGNORE INTO outbox(id,kind,entity_id,payload_json,created_at,next_attempt_at,completed_at) VALUES (?,'auth.email',?,'{}',?,?,?)"
    ).bind(sourceId, current.user.id, at, at, at),
    env.DB.prepare(
      "INSERT OR IGNORE INTO email_deliveries(id,source_id,kind,entity_id,recipient_id,metadata_json,created_at,updated_at,next_attempt_at) VALUES (?,?,?,?,?,'{}',?,?,?)"
    ).bind(
      id,
      sourceId,
      email.kind,
      current.user.id,
      current.user.id,
      at,
      at,
      at
    ),
    env.DB.prepare(
      "INSERT OR IGNORE INTO auth_email_intents(delivery_id,encrypted_payload,expires_at,created_at) VALUES (?,?,?,?)"
    ).bind(id, encrypted, current.expiresAt, at),
    env.DB.prepare(
      "INSERT OR IGNORE INTO outbox(id,kind,entity_id,payload_json,created_at,next_attempt_at) VALUES (?,'email.send',?,'{}',?,?)"
    ).bind(deliveryOutboxId(id), id, at, at),
  ])
  try {
    if (env.ENVIRONMENT === "local") {
      await processEmailDelivery(env, id, {
        ...createAuthDeliverySources(env, options),
        now,
        available: true,
        adapter: createResendEmailAdapter({ apiKey: undefined }),
      })
    } else await env.DELIVERY.send({ id: deliveryOutboxId(id) })
  } catch {
    // The committed outbox is sufficient for retry; never log authentication links.
  }
  return id
}

export function durableAuthDependencies(env: Environment): AuthDependencies {
  if (env.ENVIRONMENT !== "local" && !hasEmailTransport(env)) return {}
  return {
    sendEmail: async (email) => {
      try {
        await enqueueAuthEmail(env, email)
      } catch {
        throw new AuthDeliveryError("EMAIL_DELIVERY_FAILED")
      }
    },
  }
}

/** Clear expired token material without reviving or deleting delivery audit records. */
export async function cleanupAuthEmailIntents(
  env: Pick<Bindings, "DB">,
  now = Date.now()
) {
  const ids = JSON.stringify(
    (
      await env.DB.prepare(`SELECT i.delivery_id FROM auth_email_intents i
    JOIN email_deliveries d ON d.id=i.delivery_id WHERE i.expires_at<=? AND
    (i.encrypted_payload IS NOT NULL OR (d.email_state='pending' AND d.provider_id IS NULL AND (d.lease_until IS NULL OR d.lease_until<=?)))
    ORDER BY i.expires_at,i.delivery_id LIMIT 100`)
        .bind(now, now)
        .all<{ delivery_id: string }>()
    ).results.map((row) => row.delivery_id)
  )
  await env.DB.batch([
    env.DB.prepare(`UPDATE email_deliveries SET email_state='suppressed',last_error='AUTH_LINK_EXPIRED',completed_at=?,updated_at=?,lease_token=NULL,lease_until=NULL
      WHERE id IN (SELECT value FROM json_each(?)) AND email_state='pending' AND provider_id IS NULL AND (lease_until IS NULL OR lease_until<=?)`).bind(
      now,
      now,
      ids,
      now
    ),
    env.DB.prepare(`UPDATE outbox SET completed_at=? WHERE kind='email.send' AND entity_id IN (SELECT value FROM json_each(?))
      AND EXISTS (SELECT 1 FROM email_deliveries d WHERE d.id=outbox.entity_id AND d.completed_at IS NOT NULL)`).bind(
      now,
      ids
    ),
    env.DB.prepare(
      "UPDATE auth_email_intents SET encrypted_payload=NULL WHERE delivery_id IN (SELECT value FROM json_each(?))"
    ).bind(ids),
  ])
}
