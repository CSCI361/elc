import { z } from "zod"
import type { Bindings } from "../env"
import {
  emailLimits,
  EmailTransportError,
  freezeEmailRequest,
  type EmailAdapter,
  type EmailRequest,
} from "./email"

export type DeliveryRow = {
  id: string
  source_id: string
  kind: string
  entity_id: string
  event_id: string | null
  recipient_id: string
  part_key: string
  metadata_json: string
  pdf_state: "not_required" | "pending" | "ready" | "failed"
  email_state:
    | "pending"
    | "accepted"
    | "delivered"
    | "bounced"
    | "failed"
    | "suppressed"
    | "review_needed"
  payload_key: string | null
  payload_hash: string | null
  provider_id: string | null
  provider_status: string | null
  first_attempt_at: number | null
  last_attempt_at: number | null
  attempts: number
  failures: number
  created_at: number
  updated_at: number
  completed_at: number | null
  next_attempt_at: number
  lease_token: string | null
  lease_until: number | null
}
export type CurrentDelivery = { version: string; recipient: string }
export type DeliveryDependencies = {
  /** Recheck current account, resource state and ACL; hash every field affecting the message/PDF. */
  readCurrent: (row: DeliveryRow) => Promise<CurrentDelivery | null>
  prepare: (row: DeliveryRow, current: CurrentDelivery) => Promise<EmailRequest>
  adapter: EmailAdapter
  available: boolean
  now?: () => number
  id?: () => string
}
type Environment = Pick<Bindings, "DB" | "FILES" | "ENVIRONMENT">
type FrozenDelivery = {
  generation: string
  version: string
  request: EmailRequest
}
const maximumStoredBytes = 14 * 1024 * 1024
const envelopeSchema = z.strictObject({
  generation: z.uuid(),
  version: z.string().regex(/^[a-f0-9]{64}$/),
  request: z.unknown(),
})
const currentSchema = z.strictObject({
  version: z.string().regex(/^[a-f0-9]{64}$/),
  recipient: z.email().max(254),
})
const terminal = (row: DeliveryRow) =>
  !["pending", "accepted"].includes(row.email_state)
export const deliveryOutboxId = (id: string) => `email:${id}`
export async function deliveryDigest(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

async function readFrozen(
  env: Environment,
  row: DeliveryRow
): Promise<FrozenDelivery> {
  if (
    !row.payload_key ||
    !row.payload_hash ||
    row.payload_key !==
      `private/email-deliveries/${row.id}/${row.payload_hash}.json`
  )
    throw new EmailTransportError("INVALID_REQUEST", "review_needed")
  const object = await env.FILES.get(row.payload_key)
  if (!object || object.size > maximumStoredBytes)
    throw new EmailTransportError("INVALID_REQUEST", "review_needed")
  const text = await object.text()
  if (
    new TextEncoder().encode(text).length > maximumStoredBytes ||
    (await deliveryDigest(text)) !== row.payload_hash
  )
    throw new EmailTransportError("INVALID_REQUEST", "review_needed")
  try {
    const stored = envelopeSchema.parse(JSON.parse(text))
    const request = freezeEmailRequest(stored.request)
    if (request.deliveryId !== row.id)
      throw new EmailTransportError("INVALID_REQUEST", "review_needed")
    return { generation: stored.generation, version: stored.version, request }
  } catch {
    throw new EmailTransportError("INVALID_REQUEST", "review_needed")
  }
}

/** This consumer never changes canonical orders or tickets. Its durable row owns all retries. */
export async function processEmailDelivery(
  env: Environment,
  id: string,
  dependencies: DeliveryDependencies
): Promise<void> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) return
  const now = dependencies.now ?? Date.now
  const claim = dependencies.id ? dependencies.id() : crypto.randomUUID()
  const started = now()
  const claimed =
    await env.DB.prepare(`UPDATE email_deliveries SET lease_token=?,lease_until=?,updated_at=?
    WHERE id=? AND email_state IN ('pending','accepted') AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?) RETURNING *`)
      .bind(claim, started + 180_000, started, id, started, started)
      .first<DeliveryRow>()
  if (!claimed) return
  let row = claimed
  const finish = async (
    state: DeliveryRow["email_state"],
    code: string | null,
    providerStatus: string | null = row.provider_status
  ) => {
    const at = now()
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE email_deliveries SET email_state=?,pdf_state=CASE WHEN ?='failed' AND pdf_state='pending' THEN 'failed' ELSE pdf_state END,last_error=?,provider_status=?,completed_at=?,updated_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?`
      ).bind(state, state, code, providerStatus, at, at, id, claim),
      env.DB.prepare(
        `UPDATE outbox SET completed_at=? WHERE id=? AND EXISTS (SELECT 1 FROM email_deliveries WHERE id=? AND completed_at IS NOT NULL)`
      ).bind(at, deliveryOutboxId(id), id),
    ])
  }
  const release = async (
    code: string | null,
    delay: number,
    failure: boolean
  ) => {
    const at = now()
    await env.DB.prepare(
      `UPDATE email_deliveries SET last_error=?,failures=failures+?,next_attempt_at=?,updated_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?`
    )
      .bind(code, failure ? 1 : 0, at + delay, at, id, claim)
      .run()
  }
  try {
    if (!dependencies.available && env.ENVIRONMENT !== "local") {
      await release("EMAIL_UNAVAILABLE", 900_000, false)
      return
    }
    let frozen: FrozenDelivery | undefined
    if (row.payload_key) frozen = await readFrozen(env, row)
    if (row.provider_id) {
      if (!frozen)
        throw new EmailTransportError("INVALID_REQUEST", "review_needed")
      const found = await dependencies.adapter.lookup(
        row.provider_id,
        frozen.request
      )
      if (found.deliveryId !== id || found.providerEmailId !== row.provider_id)
        throw new EmailTransportError(
          "PROVIDER_BINDING_MISMATCH",
          "review_needed"
        )
      if (["delivered", "opened", "clicked"].includes(found.status)) {
        await finish("delivered", null, found.status)
      } else if (["bounced", "complained"].includes(found.status)) {
        await finish("bounced", "EMAIL_BOUNCED", found.status)
      } else if (["failed", "canceled", "suppressed"].includes(found.status)) {
        await finish("failed", "EMAIL_PROVIDER_FAILED", found.status)
      } else if (now() - row.first_attempt_at! >= 7 * 86_400_000) {
        await finish("review_needed", "DELIVERY_STATUS_STALE", found.status)
      } else {
        await env.DB.prepare(
          "UPDATE email_deliveries SET provider_status=? WHERE id=? AND lease_token=?"
        )
          .bind(found.status, id, claim)
          .run()
        await release(null, 300_000, false)
      }
      return
    }
    const readCurrent = async () => {
      const current = await dependencies.readCurrent(row)
      return current === null ? null : currentSchema.parse(current)
    }
    let current = await readCurrent()
    if (!current) {
      await finish("suppressed", "CURRENT_ACCESS_OR_STATE_DENIED")
      return
    }
    if (
      frozen &&
      (frozen.version !== current.version ||
        frozen.request.to !== current.recipient)
    ) {
      if (row.first_attempt_at !== null) {
        await finish("suppressed", "FROZEN_MESSAGE_SUPERSEDED")
        return
      }
      frozen = undefined
    }
    if (!frozen) {
      if (row.first_attempt_at !== null)
        throw new EmailTransportError("INVALID_REQUEST", "review_needed")
      const request = freezeEmailRequest(
        await dependencies.prepare(row, current)
      )
      if (request.deliveryId !== id || request.to !== current.recipient)
        throw new EmailTransportError("INVALID_REQUEST", "permanent")
      frozen = {
        generation: crypto.randomUUID(),
        version: current.version,
        request,
      }
      const encoded = JSON.stringify(frozen)
      if (new TextEncoder().encode(encoded).length > maximumStoredBytes)
        throw new EmailTransportError("INVALID_REQUEST", "permanent")
      const hash = await deliveryDigest(encoded)
      const key = `private/email-deliveries/${id}/${hash}.json`
      const stagedAt = now()
      // Register before R2 I/O so a crash or lost lease cannot leave an untracked credential-bearing object.
      await env.DB.prepare(
        "INSERT INTO delivery_payload_objects (key,delivery_id,hash,delete_after,created_at) VALUES (?,?,?,?,?)"
      )
        .bind(key, id, hash, stagedAt + 23 * 3_600_000, stagedAt)
        .run()
      await env.FILES.put(key, encoded, {
        httpMetadata: {
          contentType: "application/json",
          cacheControl: "private, no-store",
        },
      })
      const updated =
        await env.DB.prepare(`UPDATE email_deliveries SET payload_key=?,payload_hash=?,pdf_state=CASE WHEN pdf_state='not_required' THEN pdf_state ELSE 'ready' END,updated_at=?
        WHERE id=? AND lease_token=? AND lease_until>? AND first_attempt_at IS NULL
        AND EXISTS (SELECT 1 FROM delivery_payload_objects object WHERE object.key=? AND object.delivery_id=email_deliveries.id AND object.state='staged' AND object.delete_after>?) RETURNING *`)
          .bind(key, hash, now(), id, claim, now(), key, now())
          .first<DeliveryRow>()
      if (!updated) return
      row = updated
    }
    current = await readCurrent()
    if (!current) {
      await finish("suppressed", "CURRENT_ACCESS_OR_STATE_DENIED")
      return
    }
    if (
      current.version !== frozen.version ||
      current.recipient !== frozen.request.to
    ) {
      if (row.first_attempt_at === null)
        await release("MESSAGE_CHANGED_DURING_PREPARATION", 1000, false)
      else await finish("suppressed", "FROZEN_MESSAGE_SUPERSEDED")
      return
    }
    const at = now()
    if (
      row.first_attempt_at !== null &&
      (at < row.first_attempt_at ||
        at < row.last_attempt_at! ||
        at - row.first_attempt_at >= emailLimits.automaticSendWindowMs)
    ) {
      await finish(
        "review_needed",
        at < row.last_attempt_at! ? "CLOCK_UNSAFE" : "SEND_WINDOW_EXPIRED"
      )
      return
    }
    const attempt =
      await env.DB.prepare(`UPDATE email_deliveries SET first_attempt_at=COALESCE(first_attempt_at,?),last_attempt_at=?,attempts=attempts+1,lease_until=?,updated_at=?
      WHERE id=? AND lease_token=? AND lease_until>? AND email_state='pending' RETURNING *`)
        .bind(at, at, at + 30_000, at, id, claim, at)
        .first<DeliveryRow>()
    if (!attempt) return
    row = attempt
    const permitted = await readCurrent()
    const sendClock = now()
    if (sendClock < row.last_attempt_at! || sendClock >= row.lease_until!) {
      await release("SEND_LEASE_EXPIRED", 1000, false)
      return
    }
    if (
      !permitted ||
      permitted.version !== frozen.version ||
      permitted.recipient !== frozen.request.to
    ) {
      await finish("suppressed", "CURRENT_ACCESS_OR_STATE_DENIED")
      return
    }
    if (env.ENVIRONMENT === "local") {
      // Development transport is persisted atomically and cannot contact the external provider.
      await env.DB.batch([
        env.DB.prepare(`INSERT OR IGNORE INTO development_mail (id,recipient,kind,subject,body,created_at)
          SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM email_deliveries WHERE id=? AND lease_token=? AND email_state='pending')`).bind(
          deliveryOutboxId(id),
          frozen.request.to,
          row.kind,
          frozen.request.subject,
          frozen.request.text,
          at,
          id,
          claim
        ),
        env.DB.prepare(
          `UPDATE email_deliveries SET email_state='delivered',provider_id=?,provider_status='local',completed_at=?,updated_at=?,last_error=NULL,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?`
        ).bind(`local:${id}`, at, at, id, claim),
        env.DB.prepare(
          `UPDATE outbox SET completed_at=? WHERE id=? AND EXISTS (SELECT 1 FROM email_deliveries WHERE id=? AND email_state='delivered')`
        ).bind(at, deliveryOutboxId(id), id),
      ])
      return
    }
    const result = await dependencies.adapter.send(frozen.request, {
      firstAttemptAt: row.first_attempt_at!,
      lastAttemptAt: row.last_attempt_at!,
      leaseExpiresAt: row.lease_until!,
    })
    if (
      result.deliveryId !== id ||
      result.status !== "accepted" ||
      !z.uuid().safeParse(result.providerEmailId).success
    )
      throw new EmailTransportError(
        "PROVIDER_BINDING_MISMATCH",
        "review_needed"
      )
    await env.DB.prepare(
      `UPDATE email_deliveries SET provider_id=?,provider_status='accepted',email_state='accepted',next_attempt_at=?,updated_at=?,last_error=NULL,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?`
    )
      .bind(result.providerEmailId, now() + 60_000, now(), id, claim)
      .run()
  } catch (error) {
    const known = error instanceof EmailTransportError
    const code = known ? error.code : "DELIVERY_PROCESSING_FAILED"
    if (
      (row.provider_id !== null &&
        known &&
        error.disposition === "permanent") ||
      (row.attempts > 1 && known && error.disposition === "permanent") ||
      (known && error.disposition === "review_needed") ||
      (row.failures >= 7 && row.first_attempt_at !== null)
    ) {
      await finish("review_needed", code)
    } else if (
      (known && error.disposition === "permanent") ||
      row.failures >= 7
    ) {
      await finish("failed", code)
    } else {
      await release(
        code,
        Math.min(900_000, 15_000 * 2 ** Math.min(row.failures, 6)),
        true
      )
    }
  }
}

export async function dispatchEmailDeliveries(
  env: Pick<Bindings, "DB" | "DELIVERY">,
  now = Date.now()
) {
  const rows = (
    await env.DB.prepare(`SELECT d.id FROM email_deliveries d JOIN outbox o ON o.id='email:'||d.id
    WHERE d.email_state IN ('pending','accepted') AND d.next_attempt_at<=? AND (d.lease_until IS NULL OR d.lease_until<=?) AND o.completed_at IS NULL AND o.next_attempt_at<=?
    ORDER BY d.next_attempt_at,d.id LIMIT 20`)
      .bind(now, now, now)
      .all<{ id: string }>()
  ).results
  for (const row of rows) {
    try {
      await env.DELIVERY.send({ id: deliveryOutboxId(row.id) })
      await env.DB.prepare(
        "UPDATE outbox SET next_attempt_at=?,dispatched_at=? WHERE id=? AND completed_at IS NULL"
      )
        .bind(now + 60_000, now, deliveryOutboxId(row.id))
        .run()
    } catch {
      // The D1 row remains pending when queue publication fails.
      console.warn(JSON.stringify({ code: "EMAIL_QUEUE_DISPATCH_FAILED" }))
    }
  }
}

export async function consumeEmailDelivery(
  env: Environment,
  outboxId: string,
  dependencies: DeliveryDependencies
): Promise<boolean> {
  const job = await env.DB.prepare(
    "SELECT entity_id,completed_at FROM outbox WHERE id=? AND kind='email.send'"
  )
    .bind(outboxId)
    .first<{ entity_id: string; completed_at: number | null }>()
  if (!job) return false
  if (job.completed_at === null)
    await processEmailDelivery(env, job.entity_id, dependencies)
  const row = await env.DB.prepare("SELECT * FROM email_deliveries WHERE id=?")
    .bind(job.entity_id)
    .first<DeliveryRow>()
  if (row && terminal(row))
    await env.DB.prepare(
      "UPDATE outbox SET completed_at=? WHERE id=? AND completed_at IS NULL"
    )
      .bind(row.completed_at ?? Date.now(), outboxId)
      .run()
  return true
}
