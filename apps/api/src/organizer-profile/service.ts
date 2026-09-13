import {
  organizerProfileMutationResponseSchema,
  organizerProfileResponseSchema,
  updateOrganizerProfileSchema,
} from "@elc/shared"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  requestHash,
} from "../db/transitions"
import { activeAccountSql } from "../events/store"

export type ProfileDependencies = {
  now?: () => number
  beforeRead?: () => Promise<void>
  beforeCommit?: () => Promise<void>
  beforeReturn?: () => Promise<void>
}
const accountPredicate = "u.email_verified=1 AND p.suspended_at IS NULL"
type ProfileRow = {
  user_id: string
  revision: number | null
  updated_at: number | null
  display_name: string | null
  legal_name: string | null
  contact: string | null
  dummy_payout_reference: string | null
}
const denied = () =>
  new ApiFailure("FORBIDDEN", 403, "An active verified account is required.")

export async function readOrganizerProfile(
  db: D1Database,
  actorId: string,
  dependencies: ProfileDependencies = {}
) {
  await dependencies.beforeRead?.()
  const row = await db
    .prepare(`SELECT u.id AS user_id,op.revision,op.updated_at,op.display_name,op.legal_name,op.contact,op.dummy_payout_reference
    FROM user u LEFT JOIN profiles p ON p.user_id=u.id LEFT JOIN organizer_profiles op ON op.user_id=u.id
    WHERE u.id=? AND ${accountPredicate}`)
    .bind(actorId)
    .first<ProfileRow>()
  if (!row) throw denied()
  return organizerProfileResponseSchema.parse({
    revision: row.revision ?? 0,
    updatedAt:
      row.updated_at === null ? null : new Date(row.updated_at).toISOString(),
    profile:
      row.revision === null
        ? null
        : {
            displayName: row.display_name,
            legalName: row.legal_name,
            contact: row.contact,
            dummyPayoutReference: row.dummy_payout_reference,
          },
  })
}

/** Read the saved acknowledgement and current authority together, including on uncertain retries. */
async function readAuthorizedReceipt(
  db: D1Database,
  actorId: string,
  requestId: string,
  inputHash: string
) {
  const row = await db
    .prepare(`SELECT rr.input_hash,rr.response_json,op.revision,op.updated_at
    FROM user u LEFT JOIN profiles p ON p.user_id=u.id LEFT JOIN organizer_profiles op ON op.user_id=u.id
    LEFT JOIN request_receipts rr ON rr.actor_id=u.id AND rr.request_id=?
    WHERE u.id=? AND ${accountPredicate}`)
    .bind(requestId, actorId)
    .first<{
      input_hash: string | null
      response_json: string | null
      revision: number | null
      updated_at: number | null
    }>()
  if (!row) throw denied()
  if (row.input_hash !== null && row.input_hash !== inputHash)
    throw new ApiFailure(
      "CONFLICT",
      409,
      "This request identifier was already used for a different operation."
    )
  return {
    revision: row.revision ?? 0,
    updatedAt: row.updated_at,
    acknowledgement:
      row.response_json === null
        ? null
        : organizerProfileMutationResponseSchema.parse(
            JSON.parse(row.response_json)
          ),
  }
}

export async function updateOrganizerProfile(
  db: D1Database,
  actorId: string,
  raw: unknown,
  dependencies: ProfileDependencies = {}
) {
  const parsed = updateOrganizerProfileSchema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Provide valid organizer profile fields and the current revision."
    )
  const input = parsed.data,
    hash = await requestHash("organizer.profile.update", input)
  await dependencies.beforeRead?.()
  const current = await readAuthorizedReceipt(
    db,
    actorId,
    input.requestId,
    hash
  )
  if (current.acknowledgement) return current.acknowledgement
  if (current.revision !== input.expectedRevision)
    throw new ApiFailure(
      "CONFLICT",
      409,
      "The organizer profile changed. Reload it before saving."
    )
  await dependencies.beforeCommit?.()
  const now = Math.max(
    dependencies.now?.() ?? Date.now(),
    current.updatedAt ?? 0
  )
  const acknowledgement = organizerProfileMutationResponseSchema.parse({
    revision: input.expectedRevision + 1,
    updatedAt: new Date(now).toISOString(),
  })
  try {
    await db.batch([
      ...assertSql(db, activeAccountSql, [actorId]),
      ...assertSql(
        db,
        "COALESCE((SELECT revision FROM organizer_profiles WHERE user_id=?),0)=?",
        [actorId, input.expectedRevision]
      ),
      db
        .prepare(
          "INSERT INTO request_receipts(actor_id,request_id,input_hash,resource_id,response_json,created_at) VALUES(?,?,?,?,?,?)"
        )
        .bind(
          actorId,
          input.requestId,
          hash,
          actorId,
          JSON.stringify(acknowledgement),
          now
        ),
      db
        .prepare(`INSERT INTO organizer_profiles(user_id,display_name,legal_name,contact,dummy_payout_reference,revision,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)
        ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name,legal_name=excluded.legal_name,contact=excluded.contact,dummy_payout_reference=excluded.dummy_payout_reference,revision=organizer_profiles.revision+1,updated_at=excluded.updated_at`)
        .bind(
          actorId,
          input.profile.displayName,
          input.profile.legalName,
          input.profile.contact,
          input.profile.dummyPayoutReference,
          now,
          now
        ),
      db
        .prepare(
          "INSERT INTO audit_entries(id,actor_id,scope,action,entity_id,description,correlation_id,created_at) VALUES(?,?,'account','organizer_profile.updated',?,'Organizer profile updated.',?,?)"
        )
        .bind(crypto.randomUUID(), actorId, actorId, input.requestId, now),
    ])
  } catch (error) {
    const receipt = await readAuthorizedReceipt(
      db,
      actorId,
      input.requestId,
      hash
    )
    if (receipt.acknowledgement) return receipt.acknowledgement
    if (isTransitionConflict(error))
      throw new ApiFailure(
        "CONFLICT",
        409,
        "The account or organizer profile changed before it could be saved."
      )
    throw error
  }
  await dependencies.beforeReturn?.()
  const saved = await readAuthorizedReceipt(db, actorId, input.requestId, hash)
  if (!saved.acknowledgement)
    throw new ApiFailure(
      "CONFLICT",
      409,
      "The saved profile acknowledgement is unavailable."
    )
  return saved.acknowledgement
}
