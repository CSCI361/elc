import {
  issueOfflineSnapshotSchema,
  offlineCanonicalJson,
  offlinePageDigest,
  offlineSnapshotManifestSchema,
  offlineSnapshotPageSchema,
  type OfflineSnapshotManifest,
} from "@elc/shared"
import { requireEventPermission } from "../auth/permissions"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  readReceipt,
  requestHash,
} from "../db/transitions"
import { staffAuthorizationSql } from "../tickets/scan"
import {
  deviceGuard,
  iso,
  loadDevice,
  offlineAudit,
  offlineReceipt,
  parseOffline,
  type OfflineDependencies,
  type OfflineEnvironment,
  type SnapshotRow,
} from "./store"

async function signingKey(env: OfflineEnvironment) {
  try {
    if (
      !env.OFFLINE_SIGNING_KEY_ID ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(env.OFFLINE_SIGNING_KEY_ID)
    )
      throw new Error("key id")
    const jwk: JsonWebKey = JSON.parse(
      env.OFFLINE_SIGNING_PRIVATE_JWK ?? "null"
    )
    if (
      !jwk ||
      jwk.kty !== "EC" ||
      jwk.crv !== "P-256" ||
      !jwk.d ||
      !jwk.x ||
      !jwk.y
    )
      throw new Error("private key")
    return {
      keyId: env.OFFLINE_SIGNING_KEY_ID,
      key: await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"]
      ),
    }
  } catch {
    throw new ApiFailure(
      "SERVICE_UNAVAILABLE",
      503,
      "Offline snapshot signing is not configured."
    )
  }
}
async function loadSnapshot(
  db: D1Database,
  id: string,
  actorId: string,
  eventId: string
) {
  const row = await db
    .prepare(
      "SELECT * FROM offline_snapshots WHERE id = ? AND account_id = ? AND event_id = ?"
    )
    .bind(id, actorId, eventId)
    .first<SnapshotRow>()
  if (!row) throw new ApiFailure("NOT_FOUND", 404, "Snapshot not found.")
  return row
}
async function frozenPage(db: D1Database, snapshot: SnapshotRow, page: number) {
  const rows = await db
    .prepare(
      "SELECT payload_json FROM offline_snapshot_tickets WHERE snapshot_id = ? AND ordinal >= ? AND ordinal < ? ORDER BY ordinal LIMIT 100"
    )
    .bind(snapshot.id, page * 100, (page + 1) * 100)
    .all<{ payload_json: string }>()
  return offlineSnapshotPageSchema.parse({
    version: 1,
    snapshotId: snapshot.id,
    accountId: snapshot.account_id,
    deviceId: snapshot.device_id,
    eventId: snapshot.event_id,
    issuedAt: iso(snapshot.issued_at),
    expiresAt: iso(snapshot.expires_at),
    page,
    totalPages: Math.max(1, Math.ceil(snapshot.ticket_count / 100)),
    totalTickets: snapshot.ticket_count,
    tickets: rows.results.map((row) => JSON.parse(row.payload_json)),
  })
}

export async function issueOfflineSnapshot(
  env: OfflineEnvironment,
  actorId: string,
  eventId: string,
  raw: unknown,
  dependencies: OfflineDependencies = {}
) {
  const input = parseOffline(issueOfflineSnapshotSchema, raw)
  const db = env.DB
  await requireEventPermission(db, actorId, eventId, "ticket:scan")
  await loadDevice(db, input.deviceId, eventId, actorId)
  const signer = await signingKey(env)
  const hash = await requestHash("offline.snapshot.issue", {
    eventId,
    ...input,
  })
  const receipt = await readReceipt(db, actorId, input.requestId, hash)
  let id = receipt?.resourceId ?? crypto.randomUUID()
  const clock = dependencies.now ?? Date.now
  if (!receipt) {
    await dependencies.beforeCommit?.()
    const now = clock()
    const authorization = staffAuthorizationSql(actorId, eventId, "ticket:scan")
    try {
      await db.batch([
        ...assertSql(db, authorization.predicate, authorization.bindings),
        ...deviceGuard(db, actorId, eventId, input.deviceId),
        ...assertSql(
          db,
          `EXISTS (SELECT 1 FROM events WHERE id = ? AND cancelled_at IS NULL AND suspended_at IS NULL AND ends_at + 7200000 > ?${dependencies.now ? "" : " AND ends_at + 7200000 > CAST(unixepoch('subsecond') * 1000 AS INTEGER)"})`,
          [eventId, now]
        ),
        db
          .prepare(`INSERT INTO offline_snapshots (id, account_id, device_id, event_id, issued_at, expires_at, event_ends_at, ticket_count, key_id)
          SELECT ?, ?, ?, id, ?, min(? + 14400000, ends_at + 7200000), ends_at, (SELECT count(*) FROM tickets WHERE event_id = events.id), ? FROM events WHERE id = ?`)
          .bind(id, actorId, input.deviceId, now, now, signer.keyId, eventId),
        db
          .prepare(`INSERT INTO offline_snapshot_tickets (snapshot_id, ticket_id, ordinal, token_hash, payload_json)
          SELECT ?, t.id, row_number() OVER (ORDER BY t.id) - 1, t.token_hash,
            json_object('ticketId', t.id, 'tokenHash', t.token_hash, 'state', t.state, 'attendeeName', t.attendee_name,
              'admissionBlocked', json(CASE WHEN o.state <> 'completed' OR o.admission_blocked_at IS NOT NULL OR e.cancelled_at IS NOT NULL OR e.suspended_at IS NOT NULL OR e.ends_at <= ? THEN 'true' ELSE 'false' END),
              'activeCheckInId', (SELECT id FROM checkins WHERE ticket_id = t.id AND reversed_at IS NULL), 'seat', json(COALESCE(t.seat_json, 'null')))
          FROM tickets t JOIN orders o ON o.id = t.order_id JOIN events e ON e.id = t.event_id WHERE t.event_id = ?`)
          .bind(id, now, eventId),
        offlineReceipt(
          db,
          actorId,
          input.requestId,
          hash,
          id,
          { snapshotId: id },
          now
        ),
        offlineAudit(
          db,
          actorId,
          eventId,
          id,
          input.requestId,
          "offline.snapshot_issued",
          now
        ),
      ])
    } catch (error) {
      if (!isTransitionConflict(error)) throw error
      const replay = await readReceipt(db, actorId, input.requestId, hash)
      if (!replay)
        throw new ApiFailure(
          "CONFLICT",
          409,
          "Snapshot eligibility changed before issuance."
        )
      id = replay.resourceId
    }
  }
  const snapshot = await loadSnapshot(db, id, actorId, eventId)
  if (snapshot.expires_at <= clock())
    throw new ApiFailure(
      "SNAPSHOT_EXPIRED",
      409,
      "Request a new snapshot after the previous snapshot expires."
    )
  if (snapshot.manifest_json)
    return getOfflineManifest(env, actorId, eventId, id, clock)
  if (snapshot.key_id !== signer.keyId)
    throw new ApiFailure(
      "SERVICE_UNAVAILABLE",
      503,
      "The original snapshot signing key is no longer configured."
    )
  const pages: OfflineSnapshotManifest["pages"] = []
  for (
    let page = 0;
    page < Math.max(1, Math.ceil(snapshot.ticket_count / 100));
    page++
  ) {
    const payload = await frozenPage(db, snapshot, page)
    pages.push({
      page,
      ticketCount: payload.tickets.length,
      digest: await offlinePageDigest(payload),
    })
  }
  const unsigned = {
    version: 1 as const,
    snapshotId: id,
    accountId: actorId,
    deviceId: snapshot.device_id,
    eventId,
    issuedAt: iso(snapshot.issued_at),
    expiresAt: iso(snapshot.expires_at),
    eventEndsAt: iso(snapshot.event_ends_at),
    keyId: signer.keyId,
    algorithm: "ES256" as const,
    ticketCount: snapshot.ticket_count,
    pageSize: 100 as const,
    pages,
  }
  const bytes = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      signer.key,
      new TextEncoder().encode(
        `elc-offline-manifest-v1\n${offlineCanonicalJson(unsigned)}`
      )
    )
  )
  const signature = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
  const manifest = offlineSnapshotManifestSchema.parse({
    ...unsigned,
    signature,
  })
  await dependencies.beforeCommit?.()
  const authorization = staffAuthorizationSql(actorId, eventId, "ticket:scan")
  try {
    await db.batch([
      ...assertSql(db, authorization.predicate, authorization.bindings),
      ...deviceGuard(db, actorId, eventId, input.deviceId),
      ...assertSql(
        db,
        `EXISTS (SELECT 1 FROM offline_snapshots s JOIN events e ON e.id = s.event_id
          WHERE s.id = ? AND s.expires_at > ? AND e.cancelled_at IS NULL AND e.suspended_at IS NULL${dependencies.now ? "" : " AND s.expires_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER)"})`,
        [id, clock()]
      ),
      db
        .prepare(
          "UPDATE offline_snapshots SET manifest_json = ? WHERE id = ? AND manifest_json IS NULL"
        )
        .bind(JSON.stringify(manifest), id),
    ])
  } catch (error) {
    if (!isTransitionConflict(error)) throw error
    throw new ApiFailure(
      "CONFLICT",
      409,
      "Snapshot authorization changed before signing completed."
    )
  }
  return getOfflineManifest(env, actorId, eventId, id, clock)
}

async function readableSnapshot(
  db: D1Database,
  actorId: string,
  eventId: string,
  snapshotId: string,
  now: number,
  injectedClock: boolean
) {
  await requireEventPermission(db, actorId, eventId, "ticket:scan")
  const snapshot = await loadSnapshot(db, snapshotId, actorId, eventId)
  const device = await loadDevice(db, snapshot.device_id, eventId, actorId)
  if (device.revoked_at !== null)
    throw new ApiFailure("FORBIDDEN", 403, "This device has been revoked.")
  if (snapshot.expires_at <= now)
    throw new ApiFailure(
      "SNAPSHOT_EXPIRED",
      409,
      "Download a new snapshot before offline validation."
    )
  if (!snapshot.manifest_json)
    throw new ApiFailure(
      "CONFLICT",
      409,
      "Snapshot signing is not complete. Retry the issuance request."
    )
  const current = await authorizedSnapshotStatement(
    db,
    actorId,
    eventId,
    snapshotId,
    now,
    injectedClock
  ).first<SnapshotRow>()
  if (!current)
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "This snapshot is no longer available for this event and device."
    )
  return current
}

function authorizedSnapshotStatement(
  db: D1Database,
  actorId: string,
  eventId: string,
  snapshotId: string,
  now: number,
  injectedClock: boolean
) {
  const authorization = staffAuthorizationSql(actorId, eventId, "ticket:scan")
  return db
    .prepare(`SELECT s.* FROM offline_snapshots s JOIN offline_devices d ON d.id = s.device_id JOIN events e ON e.id = s.event_id
    WHERE s.id = ? AND s.account_id = ? AND s.event_id = ? AND s.expires_at > ? AND s.manifest_json IS NOT NULL
      AND d.account_id = s.account_id AND d.event_id = s.event_id AND d.revoked_at IS NULL
      AND e.cancelled_at IS NULL AND e.suspended_at IS NULL AND (${authorization.predicate})${injectedClock ? "" : " AND s.expires_at > CAST(unixepoch('subsecond') * 1000 AS INTEGER)"}`)
    .bind(snapshotId, actorId, eventId, now, ...authorization.bindings)
}
export async function getOfflineManifest(
  env: OfflineEnvironment,
  actorId: string,
  eventId: string,
  snapshotId: string,
  clock: () => number = Date.now
) {
  const row = await readableSnapshot(
    env.DB,
    actorId,
    eventId,
    snapshotId,
    clock(),
    clock !== Date.now
  )
  return offlineSnapshotManifestSchema.parse(JSON.parse(row.manifest_json!))
}
export async function getOfflineSnapshotPage(
  env: OfflineEnvironment,
  actorId: string,
  eventId: string,
  snapshotId: string,
  rawPage: string | number,
  clock: () => number = Date.now,
  dependencies: { beforeRead?: () => Promise<void> } = {}
) {
  if (!/^\d{1,9}$/.test(String(rawPage)))
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Provide a snapshot page number."
    )
  const page = Number(rawPage)
  const snapshot = await readableSnapshot(
    env.DB,
    actorId,
    eventId,
    snapshotId,
    clock(),
    clock !== Date.now
  )
  if (page >= Math.max(1, Math.ceil(snapshot.ticket_count / 100)))
    throw new ApiFailure("NOT_FOUND", 404, "Snapshot page not found.")
  await dependencies.beforeRead?.()
  // Authorization and the names returned by this page share one database snapshot.
  const [authorized, rows] = await env.DB.batch([
    authorizedSnapshotStatement(
      env.DB,
      actorId,
      eventId,
      snapshotId,
      clock(),
      clock !== Date.now
    ),
    env.DB.prepare(
      "SELECT payload_json FROM offline_snapshot_tickets WHERE snapshot_id = ? AND ordinal >= ? AND ordinal < ? ORDER BY ordinal LIMIT 100"
    ).bind(snapshotId, page * 100, (page + 1) * 100),
  ])
  if (!authorized!.results.length)
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "This snapshot is no longer available for this event and device."
    )
  return offlineSnapshotPageSchema.parse({
    version: 1,
    snapshotId,
    accountId: actorId,
    deviceId: snapshot.device_id,
    eventId,
    issuedAt: iso(snapshot.issued_at),
    expiresAt: iso(snapshot.expires_at),
    page,
    totalPages: Math.max(1, Math.ceil(snapshot.ticket_count / 100)),
    totalTickets: snapshot.ticket_count,
    tickets: (rows!.results as { payload_json: string }[]).map((row) =>
      JSON.parse(row.payload_json)
    ),
  })
}
