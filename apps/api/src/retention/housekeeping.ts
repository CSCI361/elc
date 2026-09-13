import { assertSql } from "../db/transitions"
import { DAY, HISTORY_MS, PAYLOAD_MS } from "./policy"

// These are server canonical scan/audit records, not the device's local journal.
// Snapshot verification metadata must remain through the seven-day sync window.
// Canonical operations and admission reports retain the event's 180-day history.
export async function cleanupExpiredSnapshots(
  db: D1Database,
  now = Date.now()
) {
  const ids = (
    await db
      .prepare(
        `SELECT id FROM offline_snapshots WHERE expires_at<=? ORDER BY expires_at,id LIMIT 100`
      )
      .bind(now - 7 * DAY)
      .all<{ id: string }>()
  ).results.map((row) => row.id)
  if (!ids.length) return 0
  await db.batch([
    db
      .prepare(
        "DELETE FROM offline_snapshot_tickets WHERE snapshot_id IN (SELECT value FROM json_each(?))"
      )
      .bind(JSON.stringify(ids)),
    db
      .prepare(
        "DELETE FROM offline_snapshots WHERE id IN (SELECT value FROM json_each(?)) AND expires_at<=?"
      )
      .bind(JSON.stringify(ids), now - 7 * DAY),
  ])
  return ids.length
}

/** A completed outbox payload can expire without shortening the business audit's lifetime. */
export async function cleanupCompletedPayloads(
  db: D1Database,
  now = Date.now()
) {
  const cutoff = now - PAYLOAD_MS
  const ids = (
    await db
      .prepare(`SELECT o.id FROM outbox o WHERE o.completed_at<=?
 AND NOT EXISTS (SELECT 1 FROM email_deliveries d WHERE d.source_id=o.id AND d.completed_at IS NULL)
 ORDER BY o.completed_at,o.id LIMIT 100`)
      .bind(cutoff)
      .all<{ id: string }>()
  ).results.map((row) => row.id)
  if (ids.length)
    await db.batch([
      ...assertSql(
        db,
        `NOT EXISTS (SELECT 1 FROM email_deliveries WHERE source_id IN (SELECT value FROM json_each(?)) AND completed_at IS NULL)`,
        [JSON.stringify(ids)]
      ),
      db
        .prepare(
          "DELETE FROM delivery_fanout WHERE source_id IN (SELECT value FROM json_each(?))"
        )
        .bind(JSON.stringify(ids)),
      db
        .prepare(
          "DELETE FROM outbox WHERE id IN (SELECT value FROM json_each(?)) AND completed_at<=?"
        )
        .bind(JSON.stringify(ids), cutoff),
    ])
  // Authentication and standalone notification deliveries have no event aggregate to retire them.
  // Capture payload cleanup before removing their durable transport rows.
  const standalone = JSON.stringify(
    (
      await db
        .prepare(`SELECT d.id FROM email_deliveries d
   WHERE d.event_id IS NULL AND d.completed_at<=? AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.id=d.source_id AND o.completed_at IS NULL) ORDER BY d.completed_at,d.id LIMIT 100`)
        .bind(cutoff)
        .all<{ id: string }>()
    ).results.map((row) => row.id)
  )
  await db.batch([
    ...assertSql(
      db,
      `NOT EXISTS (SELECT 1 FROM email_deliveries WHERE id IN (SELECT value FROM json_each(?)) AND (completed_at IS NULL OR completed_at>?))`,
      [standalone, cutoff]
    ),
    db
      .prepare(`INSERT OR IGNORE INTO retention_object_jobs(id,bucket,mode,object_key,created_at,next_attempt_at)
    SELECT lower(hex(randomblob(16))),'files','key',object_key,?,? FROM
    (SELECT payload_key AS object_key FROM email_deliveries WHERE id IN (SELECT value FROM json_each(?))
     UNION SELECT key FROM delivery_payload_objects WHERE delivery_id IN (SELECT value FROM json_each(?))) WHERE object_key IS NOT NULL`)
      .bind(now, now, standalone, standalone),
    db
      .prepare(
        "DELETE FROM delivery_payload_objects WHERE delivery_id IN (SELECT value FROM json_each(?))"
      )
      .bind(standalone),
    db
      .prepare(
        "DELETE FROM auth_email_intents WHERE delivery_id IN (SELECT value FROM json_each(?))"
      )
      .bind(standalone),
    db
      .prepare(
        "DELETE FROM email_deliveries WHERE id IN (SELECT value FROM json_each(?))"
      )
      .bind(standalone),
  ])
  await db.batch([
    // A standalone support audit follows its case, whose activity can extend the deadline.
    db
      .prepare(`DELETE FROM audit_entries WHERE id IN (SELECT a.id FROM audit_entries a WHERE a.event_id IS NULL AND a.created_at<=?
   AND NOT EXISTS (SELECT 1 FROM support_cases c WHERE c.id=a.entity_id)
   ORDER BY a.created_at,a.id LIMIT 100)`)
      .bind(now - HISTORY_MS),
    db
      .prepare(
        "DELETE FROM development_mail WHERE id IN (SELECT id FROM development_mail WHERE created_at<=? ORDER BY created_at,id LIMIT 100)"
      )
      .bind(cutoff),
  ])
  return ids.length
}

const accountReferences = `NOT EXISTS (SELECT 1 FROM events WHERE organizer_id=p.user_id)
 AND NOT EXISTS (SELECT 1 FROM orders WHERE account_id=p.user_id)
 AND NOT EXISTS (SELECT 1 FROM support_cases WHERE requester_id=p.user_id OR assignee_id=p.user_id)
 AND NOT EXISTS (SELECT 1 FROM audit_entries WHERE actor_id=p.user_id OR (scope='account' AND entity_id=p.user_id))
 AND NOT EXISTS (SELECT 1 FROM event_permissions WHERE user_id=p.user_id)
 AND NOT EXISTS (SELECT 1 FROM invitations WHERE accepted_by=p.user_id)
 AND NOT EXISTS (SELECT 1 FROM reservations WHERE account_id=p.user_id)
 AND NOT EXISTS (SELECT 1 FROM payment_attempts WHERE actor_id=p.user_id)
 AND NOT EXISTS (SELECT 1 FROM activation_checklist_history WHERE actor_id=p.user_id)
 AND NOT EXISTS (SELECT 1 FROM refunds WHERE requested_by=p.user_id)
 AND NOT EXISTS (SELECT 1 FROM checkins WHERE actor_id=p.user_id OR reversed_by=p.user_id)
 AND NOT EXISTS (SELECT 1 FROM offline_devices WHERE account_id=p.user_id OR revoked_by=p.user_id)
 AND NOT EXISTS (SELECT 1 FROM offline_snapshots WHERE account_id=p.user_id)
 AND NOT EXISTS (SELECT 1 FROM offline_operations WHERE account_id=p.user_id)
 AND NOT EXISTS (SELECT 1 FROM offline_admission_reports WHERE reviewed_by=p.user_id)
 AND NOT EXISTS (SELECT 1 FROM offline_admission_reviews WHERE actor_id=p.user_id)
 AND NOT EXISTS (SELECT 1 FROM support_messages WHERE author_id=p.user_id)
 AND NOT EXISTS (SELECT 1 FROM support_case_changes WHERE actor_id=p.user_id)
 AND NOT EXISTS (SELECT 1 FROM support_attachments WHERE uploader_id=p.user_id)
 AND NOT EXISTS (SELECT 1 FROM event_image_assets WHERE uploader_id=p.user_id)
 AND NOT EXISTS (SELECT 1 FROM email_deliveries WHERE recipient_id=p.user_id)
 AND NOT EXISTS (SELECT 1 FROM platform_grants WHERE user_id=p.user_id)
 AND NOT EXISTS (SELECT 1 FROM session WHERE user_id=p.user_id AND expires_at>?)`

export const inactiveAccountSql = `SELECT u.id AS user_id FROM user u
 LEFT JOIN account_activity aa ON aa.user_id=u.id
 WHERE MAX(u.created_at,COALESCE(aa.last_sign_in_at,0))<=? AND ${accountReferences.replaceAll("p.user_id", "u.id")}`

/** Delete the inactive login and profile together: removing a suspension profile alone
 * would accidentally reactivate the retained login. Any retained relationship postpones this. */
export async function cleanupInactiveProfiles(
  db: D1Database,
  now = Date.now()
) {
  const eligible = inactiveAccountSql
  const ids = (
    await db
      .prepare(`${eligible} ORDER BY u.id LIMIT 100`)
      .bind(now - HISTORY_MS, now)
      .all<{ user_id: string }>()
  ).results.map((row) => row.user_id)
  if (!ids.length) return 0
  const selected = JSON.stringify(ids)
  await db.batch([
    ...assertSql(
      db,
      `(SELECT count(*) FROM (${eligible}) WHERE user_id IN (SELECT value FROM json_each(?)))=?`,
      [now - HISTORY_MS, now, selected, ids.length]
    ),
    db
      .prepare(
        "DELETE FROM request_receipts WHERE actor_id IN (SELECT value FROM json_each(?))"
      )
      .bind(selected),
    db
      .prepare(
        "DELETE FROM verification WHERE value IN (SELECT value FROM json_each(?)) OR identifier IN (SELECT email FROM user WHERE id IN (SELECT value FROM json_each(?)))"
      )
      .bind(selected, selected),
    db
      .prepare(
        "DELETE FROM development_mail WHERE recipient IN (SELECT email FROM user WHERE id IN (SELECT value FROM json_each(?)))"
      )
      .bind(selected),
    db
      .prepare(
        "DELETE FROM profiles WHERE user_id IN (SELECT value FROM json_each(?))"
      )
      .bind(selected),
    db
      .prepare("DELETE FROM user WHERE id IN (SELECT value FROM json_each(?))")
      .bind(selected),
  ])
  return ids.length
}
