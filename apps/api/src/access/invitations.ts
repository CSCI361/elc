import {
  acceptedEventInvitationSchema,
  acceptEventInvitationSchema,
  createEventInvitationSchema,
  eventAccessListQuerySchema,
  eventAccessRevisionSchema,
  eventInvitationListSchema,
  eventInvitationMutationSchema,
  policy,
} from "@elc/shared"
import { requireActiveAccount } from "../auth/permissions"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  readReceipt,
  requestHash,
} from "../db/transitions"
import { activeAccountSql } from "../events/store"
import {
  accessAudit,
  accessCursor,
  accessOutbox,
  accessOwner,
  invitationDto,
  invitationRow,
  nextAccessCursor,
  ownerGuards,
  parseAccess,
  type AccessDependencies,
  type AccessEnvironment,
  type InvitationRow,
} from "./store"
import {
  createInvitationToken,
  invitationAcceptanceUrl,
  invitationTokenHash,
} from "./tokens"

export async function listEventInvitations(
  db: D1Database,
  actorId: string,
  eventId: string,
  rawQuery: unknown = {},
  now = Date.now()
) {
  const query = parseAccess(eventAccessListQuerySchema, rawQuery)
  const event = await accessOwner(db, actorId, eventId)
  const cursor = accessCursor(query, eventId, event.revision, "invitations")
  const results = (
    await db
      .prepare(
        "SELECT * FROM invitations WHERE event_id = ? AND id > ? ORDER BY id LIMIT ?"
      )
      .bind(eventId, cursor, query.limit + 1)
      .all<InvitationRow>()
  ).results
  const page = results.slice(0, query.limit)
  return eventInvitationListSchema.parse({
    eventId,
    revision: event.revision,
    items: page.map((row) => invitationDto(row, now)),
    nextCursor:
      results.length > query.limit
        ? nextAccessCursor(
            eventId,
            event.revision,
            "invitations",
            page.at(-1)!.id
          )
        : null,
  })
}

export async function createEventInvitation(
  env: AccessEnvironment,
  actorId: string,
  eventId: string,
  raw: unknown,
  dependencies: AccessDependencies = {}
) {
  const input = parseAccess(createEventInvitationSchema, raw)
  return issueInvitation(env, actorId, eventId, input, undefined, dependencies)
}
export async function reissueEventInvitation(
  env: AccessEnvironment,
  actorId: string,
  eventId: string,
  invitationId: string,
  raw: unknown,
  dependencies: AccessDependencies = {}
) {
  const input = parseAccess(eventAccessRevisionSchema, raw)
  return issueInvitation(
    env,
    actorId,
    eventId,
    input,
    invitationId,
    dependencies
  )
}

async function issueInvitation(
  env: AccessEnvironment,
  actorId: string,
  eventId: string,
  input: { requestId: string; expectedRevision: number; email?: string },
  previousId: string | undefined,
  dependencies: AccessDependencies
) {
  const db = env.DB
  const event = await accessOwner(db, actorId, eventId)
  const hash = await requestHash(
    previousId ? "invitation.reissue" : "invitation.create",
    { eventId, previousId: previousId ?? null, ...input }
  )
  const receipt = await readReceipt(db, actorId, input.requestId, hash)
  if (receipt?.responseJson)
    return eventInvitationMutationSchema.parse(JSON.parse(receipt.responseJson))
  const previous = previousId
    ? await invitationRow(db, eventId, previousId)
    : null
  const email = previous?.email ?? input.email!
  const id = crypto.randomUUID()
  // Validate the trusted application origin without exposing a usable token.
  const appOrigin = new URL(
    invitationAcceptanceUrl(env.APP_ORIGIN, "placeholder")
  ).origin
  const token = await createInvitationToken(id, env.TICKET_ENCRYPTION_KEY)
  await dependencies.beforeCommit?.()
  const now = (dependencies.now ?? Date.now)()
  const expiresAt = Math.min(
    now + policy.privateInvitationLifetimeMs,
    event.ends_at
  )
  if (expiresAt <= now)
    throw new ApiFailure(
      "EVENT_UNAVAILABLE",
      409,
      "This event no longer accepts invitations."
    )
  const row: InvitationRow = {
    id,
    event_id: eventId,
    email,
    token_hash: token.tokenHash,
    expires_at: expiresAt,
    revoked_at: null,
    accepted_by: null,
    accepted_at: null,
    created_at: now,
  }
  const response = eventInvitationMutationSchema.parse({
    eventId,
    revision: input.expectedRevision + 1,
    invitation: invitationDto(row, now),
    deliveryQueued: true,
  })
  try {
    await db.batch([
      ...ownerGuards(db, actorId, eventId, input.expectedRevision),
      ...assertSql(
        db,
        `EXISTS (SELECT 1 FROM events WHERE id = ? AND visibility = 'private' AND suspended_at IS NULL AND cancelled_at IS NULL AND ends_at >= ? AND ends_at > ?
        ${dependencies.now ? "" : "AND ends_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER)"})`,
        [eventId, expiresAt, now]
      ),
      ...assertSql(
        db,
        `NOT EXISTS (SELECT 1 FROM invitations WHERE event_id = ? AND lower(email) = lower(?) AND id <> ? AND revoked_at IS NULL AND (accepted_at IS NOT NULL OR expires_at > ?))`,
        [eventId, email, previousId ?? "", now]
      ),
      ...(previous
        ? assertSql(
            db,
            "EXISTS (SELECT 1 FROM invitations WHERE id = ? AND event_id = ? AND email = ? AND token_hash = ?)",
            [previous.id, eventId, email, previous.token_hash]
          )
        : []),
      db
        .prepare(
          "INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(
          actorId,
          input.requestId,
          hash,
          id,
          JSON.stringify(response),
          now
        ),
      ...(previous
        ? [
            db
              .prepare(
                "UPDATE invitations SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND event_id = ?"
              )
              .bind(now, previous.id, eventId),
          ]
        : []),
      db
        .prepare(
          "INSERT INTO invitations (id, event_id, email, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(id, eventId, email, token.tokenHash, expiresAt, now),
      db
        .prepare(
          "UPDATE events SET revision = revision + 1, updated_at = ? WHERE id = ?"
        )
        .bind(now, eventId),
      accessAudit(
        db,
        eventId,
        actorId,
        previous ? "invitation.reissued" : "invitation.created",
        id,
        previous
          ? `Reissued invitation ${previous.id}; the previous invitation is revoked`
          : "Private event invitation created",
        input.requestId,
        now
      ),
      accessOutbox(
        db,
        "invitation.deliver",
        id,
        {
          invitationId: id,
          eventId,
          email,
          expiresAt,
          appOrigin,
          encryptedToken: token.encryptedToken,
        },
        now
      ),
    ])
  } catch (error) {
    const replay = await readReceipt(db, actorId, input.requestId, hash)
    if (replay?.responseJson)
      return eventInvitationMutationSchema.parse(
        JSON.parse(replay.responseJson)
      )
    if (isTransitionConflict(error))
      throw new ApiFailure(
        "CONFLICT",
        409,
        "The event changed or that email already has an active invitation. Refresh or reissue the existing invitation."
      )
    throw error
  }
  return response
}

export async function revokeEventInvitation(
  db: D1Database,
  actorId: string,
  eventId: string,
  invitationId: string,
  raw: unknown,
  dependencies: AccessDependencies = {}
) {
  const input = parseAccess(eventAccessRevisionSchema, raw)
  await accessOwner(db, actorId, eventId)
  const hash = await requestHash("invitation.revoke", {
    eventId,
    invitationId,
    ...input,
  })
  const receipt = await readReceipt(db, actorId, input.requestId, hash)
  if (receipt?.responseJson)
    return eventInvitationMutationSchema.parse(JSON.parse(receipt.responseJson))
  const current = await invitationRow(db, eventId, invitationId)
  await dependencies.beforeCommit?.()
  const now = (dependencies.now ?? Date.now)()
  const response = eventInvitationMutationSchema.parse({
    eventId,
    revision: input.expectedRevision + 1,
    invitation: invitationDto(
      { ...current, revoked_at: current.revoked_at ?? now },
      now
    ),
    deliveryQueued: false,
  })
  try {
    await db.batch([
      ...ownerGuards(db, actorId, eventId, input.expectedRevision),
      ...assertSql(
        db,
        "EXISTS (SELECT 1 FROM invitations WHERE id = ? AND event_id = ? AND token_hash = ?)",
        [invitationId, eventId, current.token_hash]
      ),
      db
        .prepare(
          "INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(
          actorId,
          input.requestId,
          hash,
          invitationId,
          JSON.stringify(response),
          now
        ),
      db
        .prepare(
          "UPDATE invitations SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND event_id = ?"
        )
        .bind(now, invitationId, eventId),
      db
        .prepare(
          "UPDATE events SET revision = revision + 1, updated_at = ? WHERE id = ?"
        )
        .bind(now, eventId),
      accessAudit(
        db,
        eventId,
        actorId,
        "invitation.revoked",
        invitationId,
        "Private invitation access revoked",
        input.requestId,
        now
      ),
      accessOutbox(
        db,
        "invitation.revoked",
        invitationId,
        { eventId, invitationId },
        now
      ),
    ])
  } catch (error) {
    const replay = await readReceipt(db, actorId, input.requestId, hash)
    if (replay?.responseJson)
      return eventInvitationMutationSchema.parse(
        JSON.parse(replay.responseJson)
      )
    if (isTransitionConflict(error))
      throw new ApiFailure(
        "CONFLICT",
        409,
        "The event or invitation changed before revocation."
      )
    throw error
  }
  return response
}

export async function acceptEventInvitation(
  db: D1Database,
  actorId: string,
  raw: unknown,
  dependencies: AccessDependencies = {}
): Promise<{ eventId: string; invitationId: string; acceptedAt: string }> {
  const input = parseAccess(acceptEventInvitationSchema, raw)
  await requireActiveAccount(db, actorId)
  const tokenHash = await invitationTokenHash(input.token)
  const current = await db
    .prepare("SELECT * FROM invitations WHERE token_hash = ?")
    .bind(tokenHash)
    .first<InvitationRow>()
  if (!current)
    throw new ApiFailure("NOT_FOUND", 404, "This invitation is unavailable.")
  const hash = await requestHash("invitation.accept", {
    tokenHash,
    requestId: input.requestId,
  })
  const existingReceipt = await readReceipt(db, actorId, input.requestId, hash)
  await dependencies.beforeCommit?.()
  const now = (dependencies.now ?? Date.now)()
  const predicate = `EXISTS (SELECT 1 FROM invitations i JOIN events e ON e.id = i.event_id JOIN user u ON u.id = ?
    LEFT JOIN profiles p ON p.user_id = u.id WHERE i.id = ? AND i.token_hash = ? AND i.event_id = ?
    AND u.email_verified = 1 AND p.suspended_at IS NULL AND lower(u.email) = lower(i.email)
    AND i.revoked_at IS NULL AND e.visibility = 'private' AND e.publication_state = 'published'
    AND e.suspended_at IS NULL AND e.cancelled_at IS NULL AND e.ends_at > ? AND i.created_at <= ?
    AND ((i.accepted_by IS NULL AND i.accepted_at IS NULL AND i.expires_at > ?)
      OR (i.accepted_by = u.id AND i.accepted_at IS NOT NULL AND i.accepted_at <= ? AND i.accepted_at < i.expires_at AND i.accepted_at < e.ends_at))
    ${dependencies.now ? "" : "AND e.ends_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER) AND (i.accepted_by = u.id OR i.expires_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER))"})`
  const bindings = [
    actorId,
    current.id,
    tokenHash,
    current.event_id,
    now,
    now,
    now,
    now,
  ]
  const response = acceptedEventInvitationSchema.parse({
    invitationId: current.id,
    eventId: current.event_id,
    acceptedAt: new Date(current.accepted_at ?? now).toISOString(),
  })
  try {
    await db.batch([
      ...assertSql(db, activeAccountSql, [actorId]),
      ...assertSql(db, predicate, bindings),
      ...(existingReceipt
        ? []
        : [
            db
              .prepare(
                "INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
              )
              .bind(
                actorId,
                input.requestId,
                hash,
                current.id,
                JSON.stringify(response),
                now
              ),
          ]),
      ...(current.accepted_at === null
        ? [
            db
              .prepare(
                "UPDATE invitations SET accepted_by = ?, accepted_at = ? WHERE id = ? AND accepted_by IS NULL AND accepted_at IS NULL"
              )
              .bind(actorId, now, current.id),
            // An independent concurrent acceptance must replay instead of adding another audit/job.
            ...assertSql(db, "changes() = 1"),
            db
              .prepare(
                "UPDATE events SET revision = revision + 1, updated_at = ? WHERE id = ?"
              )
              .bind(now, current.event_id),
            accessAudit(
              db,
              current.event_id,
              actorId,
              "invitation.accepted",
              current.id,
              "Verified matching account accepted the private invitation",
              input.requestId,
              now
            ),
            accessOutbox(
              db,
              "invitation.accepted",
              current.id,
              {
                eventId: current.event_id,
                invitationId: current.id,
                accountId: actorId,
              },
              now
            ),
          ]
        : []),
    ])
  } catch (error) {
    if (isTransitionConflict(error)) {
      const replayReceipt = await readReceipt(
        db,
        actorId,
        input.requestId,
        hash
      )
      // Recheck revocation, email and current event state before reporting a concurrent replay.
      const valid = await db
        .prepare(`SELECT (${predicate}) AS valid`)
        .bind(...bindings)
        .first<number>("valid")
      if (valid) {
        const accepted = await db
          .prepare(
            "SELECT accepted_at FROM invitations WHERE id = ? AND accepted_by = ?"
          )
          .bind(current.id, actorId)
          .first<{ accepted_at: number }>()
        if (accepted?.accepted_at !== undefined) {
          // A different concurrent request may have won. Record this request's
          // receipt through the accepted-row path without repeating its audit/job.
          if (!replayReceipt)
            return acceptEventInvitation(
              db,
              actorId,
              input,
              dependencies.now ? { now: dependencies.now } : {}
            )
          return acceptedEventInvitationSchema.parse({
            invitationId: current.id,
            eventId: current.event_id,
            acceptedAt: new Date(accepted.accepted_at).toISOString(),
          })
        }
      }
      throw new ApiFailure(
        "NOT_FOUND",
        404,
        "This invitation is unavailable for the current account."
      )
    }
    throw error
  }
  return response
}
