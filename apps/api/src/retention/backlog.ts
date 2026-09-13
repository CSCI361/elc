import { DAY, HISTORY_MS, PAYLOAD_MS, eligibleEventSql } from "./policy"
import { inactiveAccountSql } from "./housekeeping"

/** Recovery attestation must inspect eligible work and failed jobs, not only the last pass's counts.
 * Financial/admission holds are intentionally excluded from eligible events. This read grants no
 * permission to publish a restored environment; all other recovery gates must also pass. */
export async function getRetentionBacklog(db: D1Database, now = Date.now()) {
  const statements = [
    db
      .prepare(`SELECT count(*) AS count FROM (${eligibleEventSql})`)
      .bind(now, now),
    db
      .prepare(
        "SELECT count(*) AS count FROM support_cases WHERE event_id IS NULL AND updated_at<=?"
      )
      .bind(now - HISTORY_MS),
    db
      .prepare(
        "SELECT count(*) AS count FROM offline_snapshots WHERE expires_at<=?"
      )
      .bind(now - 7 * DAY),
    db
      .prepare(`SELECT count(*) AS count FROM outbox o WHERE o.completed_at<=? AND NOT EXISTS
   (SELECT 1 FROM email_deliveries d WHERE d.source_id=o.id AND d.completed_at IS NULL)`)
      .bind(now - PAYLOAD_MS),
    db
      .prepare(`SELECT count(*) AS count FROM email_deliveries d WHERE d.event_id IS NULL AND d.completed_at<=?
   AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.id=d.source_id AND o.completed_at IS NULL)`)
      .bind(now - PAYLOAD_MS),
    db
      .prepare(`SELECT count(*) AS count FROM audit_entries a WHERE a.event_id IS NULL AND a.created_at<=?
   AND NOT EXISTS (SELECT 1 FROM support_cases c WHERE c.id=a.entity_id)`)
      .bind(now - HISTORY_MS),
    db
      .prepare(
        "SELECT count(*) AS count FROM development_mail WHERE created_at<=?"
      )
      .bind(now - PAYLOAD_MS),
    db
      .prepare(`SELECT count(*) AS count FROM (${inactiveAccountSql})`)
      .bind(now - HISTORY_MS, now),
    db
      .prepare(
        "SELECT count(*) AS count FROM retention_object_jobs WHERE completed_at IS NULL OR next_attempt_at<=?"
      )
      .bind(now),
  ]
  statements.push(
    db
      .prepare(
        "SELECT count(*) AS count FROM auth_email_intents WHERE expires_at<=? AND encrypted_payload IS NOT NULL"
      )
      .bind(now)
  )
  const results = await db.batch(statements)
  const counts = results.map((result) =>
    Number((result.results[0] as { count: number }).count)
  )
  const [
    events,
    cases,
    snapshots,
    outbox,
    standaloneDeliveries,
    audits,
    developmentMail,
    accounts,
    objects,
    expiredAuthIntents,
  ] = counts
  return {
    events: events!,
    cases: cases!,
    snapshots: snapshots!,
    outbox: outbox!,
    standaloneDeliveries: standaloneDeliveries!,
    audits: audits!,
    developmentMail: developmentMail!,
    accounts: accounts!,
    objects: objects!,
    expiredAuthIntents: expiredAuthIntents!,
    clear: counts.every((count) => count === 0),
  }
}
