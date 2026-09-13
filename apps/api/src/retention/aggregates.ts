import { assertSql, isTransitionConflict } from "../db/transitions"
import { DAY, HISTORY_MS, eligibleEventSql } from "./policy"

type Dependencies = {
  now?: () => number
  beforeCommit?: (kind: "event" | "case", id: string) => Promise<void>
}

const orderIds = "SELECT id FROM orders WHERE event_id=?"
const paymentIds = `SELECT id FROM payment_attempts WHERE (purpose='event_activation' AND subject_id=?) OR (purpose='ticket_order' AND subject_id IN (${orderIds}))`
const caseIds = "SELECT id FROM support_cases WHERE event_id=?"
const eventEntityIds = `SELECT id FROM events WHERE id=? UNION SELECT id FROM orders WHERE event_id=?
 UNION SELECT id FROM tickets WHERE event_id=? UNION SELECT id FROM ticket_types WHERE event_id=?
 UNION SELECT id FROM inventory WHERE event_id=? UNION SELECT id FROM campaigns WHERE event_id=?
 UNION SELECT id FROM invitations WHERE event_id=? UNION SELECT id FROM reservations WHERE event_id=?
 UNION SELECT id FROM support_cases WHERE event_id=? UNION SELECT id FROM support_messages WHERE case_id IN (${caseIds})
 UNION SELECT id FROM support_case_changes WHERE case_id IN (${caseIds})
 UNION SELECT id FROM support_attachments WHERE case_id IN (${caseIds})
 UNION SELECT id FROM email_deliveries WHERE event_id=?
 UNION SELECT id FROM offline_devices WHERE event_id=? UNION SELECT id FROM offline_snapshots WHERE event_id=?
 UNION SELECT operation_id FROM offline_operations WHERE event_id=?
 UNION SELECT id FROM checkins WHERE ticket_id IN (SELECT id FROM tickets WHERE event_id=?)
 UNION SELECT id FROM payment_attempts WHERE (purpose='event_activation' AND subject_id=?) OR (purpose='ticket_order' AND subject_id IN (${orderIds}))
 UNION SELECT id FROM refunds WHERE payment_attempt_id IN (${paymentIds})
 UNION SELECT id FROM simulated_payouts WHERE event_id=?
 UNION SELECT id FROM simulated_payout_adjustments WHERE payout_item_id IN (SELECT id FROM simulated_payout_items WHERE order_id IN (${orderIds}))`

const eventEntities = (column: string) =>
  `(${eventEntityIds
    .split(/\s+UNION\s+/)
    .map((selection) => `${column} IN (${selection})`)
    .join(" OR ")})`

// Every placeholder in these authored aggregate statements is the same aggregate ID.
const scoped = (db: D1Database, sql: string, id: string) =>
  db.prepare(sql).bind(...Array.from(sql.matchAll(/\?/g), () => id))

function objectJobs(
  db: D1Database,
  selection: string,
  bindings: unknown[],
  now: number,
  mode = "key"
) {
  return db
    .prepare(`INSERT OR IGNORE INTO retention_object_jobs
 (id,bucket,mode,object_key,created_at,next_attempt_at)
 SELECT lower(hex(randomblob(16))),'files',?,object_key,?,? FROM (${selection}) WHERE object_key IS NOT NULL`)
    .bind(mode, now, now, ...bindings)
}
function caseChildren(db: D1Database, selection: string, id: string) {
  return [
    scoped(
      db,
      `DELETE FROM support_attachments WHERE case_id IN (${selection})`,
      id
    ),
    scoped(
      db,
      `DELETE FROM support_case_changes WHERE case_id IN (${selection})`,
      id
    ),
    scoped(
      db,
      `DELETE FROM support_messages WHERE case_id IN (${selection})`,
      id
    ),
    scoped(db, `DELETE FROM support_cases WHERE id IN (${selection})`, id),
  ]
}

/** The D1 commit both removes canonical access and records every related object deletion.
 * A failed guard/constraint rolls back the whole aggregate and all its object jobs. */
export async function retireEvent(
  db: D1Database,
  id: string,
  dependencies: Dependencies = {}
) {
  await dependencies.beforeCommit?.("event", id)
  const now = dependencies.now?.() ?? Date.now()
  try {
    await db.batch([
      ...assertSql(
        db,
        `EXISTS (SELECT 1 FROM (${eligibleEventSql}) WHERE id=?)`,
        [now, now, id]
      ),
      objectJobs(
        db,
        `SELECT quarantine_key AS object_key FROM support_attachments WHERE case_id IN (${caseIds}) UNION SELECT object_key FROM support_attachments WHERE case_id IN (${caseIds})`,
        [id, id],
        now
      ),
      objectJobs(
        db,
        "SELECT 'private/ticket-pdfs/' || id || '/' AS object_key FROM tickets WHERE event_id=?",
        [id],
        now,
        "prefix"
      ),
      objectJobs(
        db,
        "SELECT payload_key AS object_key FROM email_deliveries WHERE event_id=? UNION SELECT key FROM delivery_payload_objects WHERE delivery_id IN (SELECT id FROM email_deliveries WHERE event_id=?)",
        [id, id],
        now
      ),
      scoped(
        db,
        `DELETE FROM request_receipts WHERE ${eventEntities("resource_id")}`,
        id
      ),
      scoped(
        db,
        `DELETE FROM delivery_fanout WHERE source_id IN (SELECT id FROM outbox WHERE ${eventEntities("entity_id")})`,
        id
      ),
      scoped(db, `DELETE FROM outbox WHERE ${eventEntities("entity_id")}`, id),
      db
        .prepare(
          "DELETE FROM delivery_payload_objects WHERE delivery_id IN (SELECT id FROM email_deliveries WHERE event_id=?)"
        )
        .bind(id),
      db
        .prepare(
          "DELETE FROM auth_email_intents WHERE delivery_id IN (SELECT id FROM email_deliveries WHERE event_id=?)"
        )
        .bind(id),
      db.prepare("DELETE FROM email_deliveries WHERE event_id=?").bind(id),
      scoped(
        db,
        `DELETE FROM offline_admission_reviews WHERE operation_id IN (SELECT operation_id FROM offline_operations WHERE event_id=?)`,
        id
      ),
      scoped(
        db,
        `DELETE FROM offline_admission_reports WHERE operation_id IN (SELECT operation_id FROM offline_operations WHERE event_id=?)`,
        id
      ),
      db.prepare("DELETE FROM offline_operations WHERE event_id=?").bind(id),
      db
        .prepare(
          "DELETE FROM offline_snapshot_tickets WHERE snapshot_id IN (SELECT id FROM offline_snapshots WHERE event_id=?)"
        )
        .bind(id),
      db.prepare("DELETE FROM offline_snapshots WHERE event_id=?").bind(id),
      db.prepare("DELETE FROM offline_devices WHERE event_id=?").bind(id),
      db
        .prepare(
          "DELETE FROM checkins WHERE ticket_id IN (SELECT id FROM tickets WHERE event_id=?)"
        )
        .bind(id),
      scoped(
        db,
        `DELETE FROM simulated_payout_adjustments WHERE payout_item_id IN (SELECT id FROM simulated_payout_items WHERE order_id IN (${orderIds}))`,
        id
      ),
      scoped(
        db,
        `DELETE FROM simulated_payout_items WHERE order_id IN (${orderIds})`,
        id
      ),
      db.prepare("DELETE FROM simulated_payouts WHERE event_id=?").bind(id),
      scoped(
        db,
        `DELETE FROM refunds WHERE payment_attempt_id IN (${paymentIds})`,
        id
      ),
      ...caseChildren(db, caseIds, id),
      db.prepare("DELETE FROM tickets WHERE event_id=?").bind(id),
      db.prepare("DELETE FROM activation_attempts WHERE event_id=?").bind(id),
      db
        .prepare("DELETE FROM activation_checklist_history WHERE event_id=?")
        .bind(id),
      db.prepare("DELETE FROM event_activations WHERE event_id=?").bind(id),
      scoped(
        db,
        `DELETE FROM provider_events WHERE payment_attempt_id IN (${paymentIds})`,
        id
      ),
      scoped(
        db,
        `DELETE FROM payment_attempts WHERE id IN (${paymentIds})`,
        id
      ),
      scoped(db, `DELETE FROM order_items WHERE order_id IN (${orderIds})`, id),
      scoped(
        db,
        `DELETE FROM promo_allocations WHERE order_id IN (${orderIds})`,
        id
      ),
      db.prepare("DELETE FROM inventory WHERE event_id=?").bind(id),
      db.prepare("DELETE FROM reservations WHERE event_id=?").bind(id),
      db.prepare("DELETE FROM orders WHERE event_id=?").bind(id),
      db
        .prepare(
          "DELETE FROM campaign_ticket_types WHERE campaign_id IN (SELECT id FROM campaigns WHERE event_id=?)"
        )
        .bind(id),
      db.prepare("DELETE FROM campaigns WHERE event_id=?").bind(id),
      db.prepare("DELETE FROM ticket_types WHERE event_id=?").bind(id),
      db.prepare("DELETE FROM invitations WHERE event_id=?").bind(id),
      db.prepare("DELETE FROM event_permissions WHERE event_id=?").bind(id),
      db.prepare("DELETE FROM audit_entries WHERE event_id=?").bind(id),
      db.prepare("DELETE FROM events WHERE id=?").bind(id),
    ])
    return true
  } catch (error) {
    if (isTransitionConflict(error)) return false
    throw error
  }
}

export async function retireStandaloneCase(
  db: D1Database,
  id: string,
  dependencies: Dependencies = {}
) {
  await dependencies.beforeCommit?.("case", id)
  const now = dependencies.now?.() ?? Date.now()
  const cases = "SELECT id FROM support_cases WHERE id=? AND event_id IS NULL"
  const entities = `${cases} UNION SELECT id FROM support_messages WHERE case_id=? UNION SELECT id FROM support_case_changes WHERE case_id=? UNION SELECT id FROM support_attachments WHERE case_id=? UNION SELECT id FROM email_deliveries WHERE entity_id=?`
  try {
    await db.batch([
      ...assertSql(
        db,
        "EXISTS (SELECT 1 FROM support_cases WHERE id=? AND event_id IS NULL AND updated_at<=?)",
        [id, now - HISTORY_MS]
      ),
      objectJobs(
        db,
        "SELECT quarantine_key AS object_key FROM support_attachments WHERE case_id=? UNION SELECT object_key FROM support_attachments WHERE case_id=?",
        [id, id],
        now
      ),
      objectJobs(
        db,
        "SELECT payload_key AS object_key FROM email_deliveries WHERE entity_id=? UNION SELECT key FROM delivery_payload_objects WHERE delivery_id IN (SELECT id FROM email_deliveries WHERE entity_id=?)",
        [id, id],
        now
      ),
      scoped(
        db,
        `DELETE FROM request_receipts WHERE resource_id IN (${entities})`,
        id
      ),
      scoped(
        db,
        `DELETE FROM delivery_fanout WHERE source_id IN (SELECT id FROM outbox WHERE entity_id IN (${entities}))`,
        id
      ),
      scoped(db, `DELETE FROM outbox WHERE entity_id IN (${entities})`, id),
      db
        .prepare(
          "DELETE FROM delivery_payload_objects WHERE delivery_id IN (SELECT id FROM email_deliveries WHERE entity_id=?)"
        )
        .bind(id),
      db
        .prepare(
          "DELETE FROM auth_email_intents WHERE delivery_id IN (SELECT id FROM email_deliveries WHERE entity_id=?)"
        )
        .bind(id),
      db.prepare("DELETE FROM email_deliveries WHERE entity_id=?").bind(id),
      db
        .prepare(
          "DELETE FROM audit_entries WHERE event_id IS NULL AND entity_id=?"
        )
        .bind(id),
      ...caseChildren(db, cases, id),
    ])
    return true
  } catch (error) {
    if (isTransitionConflict(error)) return false
    throw error
  }
}

export async function cleanupRetainedAggregates(
  db: D1Database,
  dependencies: Dependencies = {}
) {
  const now = dependencies.now?.() ?? Date.now()
  const eventIds = (
    await db
      .prepare(`${eligibleEventSql} ORDER BY deadline,e.id LIMIT 10`)
      .bind(now, now)
      .all<{ id: string }>()
  ).results
  let events = 0,
    cases = 0
  for (const row of eventIds)
    if (await retireEvent(db, row.id, dependencies)) events++
  const caseIds = (
    await db
      .prepare(
        "SELECT id FROM support_cases WHERE event_id IS NULL AND updated_at<=? ORDER BY updated_at,id LIMIT 20"
      )
      .bind(now - 180 * DAY)
      .all<{ id: string }>()
  ).results
  for (const row of caseIds)
    if (await retireStandaloneCase(db, row.id, dependencies)) cases++
  return { events, cases }
}
