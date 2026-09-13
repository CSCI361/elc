import { calendarUid } from "@elc/shared"
import {
  duplicatePastEventSchema,
  duplicatePastEventResponseSchema,
} from "../../../../packages/shared/src/history-api"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  readReceipt,
  requestHash,
} from "../db/transitions"
import { activeAccountSql, inventoryGuards } from "../events/store"
import {
  eventAuthoritySql,
  parseHistory,
  retainedEvent,
  retainedSql,
  retentionColumns,
  type HistoryDependencies,
} from "./store"

const maxInventory = 10_000
const maxTicketTypes = 100
/** SQL copies configuration at commit; original transaction and grant tables are never selected. */
export async function duplicatePastEvent(
  db: D1Database,
  actorId: string,
  sourceEventId: string,
  raw: unknown,
  dependencies: HistoryDependencies = {}
) {
  const input = parseHistory(duplicatePastEventSchema, raw)
  const firstNow = dependencies.now?.() ?? Date.now()
  await retainedEvent(db, actorId, sourceEventId, firstNow, "event:manage")
  const hash = await requestHash("history.duplicate", {
    sourceEventId,
    ...input,
  })
  const saved = await readReceipt(db, actorId, input.requestId, hash)
  if (saved?.responseJson)
    return duplicatePastEventResponseSchema.parse(
      JSON.parse(saved.responseJson)
    )
  const sourceTypes = (
    await db
      .prepare(
        "SELECT id FROM ticket_types WHERE event_id = ? ORDER BY id LIMIT ?"
      )
      .bind(sourceEventId, maxTicketTypes + 1)
      .all<{ id: string }>()
  ).results
  if (sourceTypes.length > maxTicketTypes)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Duplication supports at most 100 ticket types and 10,000 inventory places."
    )
  const mapping = JSON.stringify(
    sourceTypes.map((type) => ({ oldId: type.id, newId: crypto.randomUUID() }))
  )
  const id = crypto.randomUUID()
  const response = { sourceEventId, eventId: id, resourceId: id, revision: 0 }
  await dependencies.beforeCommit?.()
  const now = dependencies.now?.() ?? Date.now()
  const start = Date.parse(input.startsAt),
    end = Date.parse(input.endsAt),
    open = Date.parse(input.registrationOpensAt),
    close = Date.parse(input.registrationClosesAt)
  if (start <= now || close <= now)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Choose a future event start and registration deadline."
    )
  const timeCheck = dependencies.now
    ? "?"
    : "CAST(unixepoch('subsecond') * 1000 AS INTEGER)"
  const sourceGuard = `EXISTS (SELECT e.id, ${retentionColumns} FROM events e WHERE e.id = ? AND e.revision = ?
    AND (e.ends_at <= ${timeCheck} OR e.cancelled_at IS NOT NULL) AND e.suspended_at IS NULL
    AND e.capacity <= ${maxInventory} AND ${retainedSql} AND ${eventAuthoritySql("event:manage")})`
  const sourceBindings = [
    sourceEventId,
    input.expectedRevision,
    ...(dependencies.now ? [now] : []),
    now,
    actorId,
  ]
  try {
    await db.batch([
      ...assertSql(db, activeAccountSql, [actorId]),
      ...assertSql(db, sourceGuard, sourceBindings),
      ...assertSql(db, `? > ${timeCheck} AND ? > ${timeCheck}`, [
        start,
        ...(dependencies.now ? [now] : []),
        close,
        ...(dependencies.now ? [now] : []),
      ]),
      ...assertSql(
        db,
        `(SELECT count(*) FROM ticket_types WHERE event_id = ?) = ?
        AND NOT EXISTS (SELECT 1 FROM ticket_types t WHERE t.event_id = ? AND NOT EXISTS (SELECT 1 FROM json_each(?) m WHERE json_extract(m.value,'$.oldId') = t.id))
        AND (SELECT count(*) FROM inventory WHERE event_id = ?) <= ${maxInventory}`,
        [
          sourceEventId,
          sourceTypes.length,
          sourceEventId,
          mapping,
          sourceEventId,
        ]
      ),
      ...inventoryGuards(db, sourceEventId),
      db
        .prepare(`INSERT INTO events (id,organizer_id,title,description,category,venue_name,venue_address,starts_at,ends_at,registration_opens_at,registration_closes_at,time_zone,visibility,seating_mode,venue_layout_id,capacity,max_tickets_per_order,refund_instructions,calendar_uid,calendar_sequence,reporting_id,publication_state,paid_sales_state,revision,created_at,updated_at)
        SELECT ?,?,title,description,category,venue_name,venue_address,?,?,?,?,time_zone,visibility,seating_mode,venue_layout_id,capacity,max_tickets_per_order,refund_instructions,?,0,?,'draft','pending',0,?,? FROM events WHERE id = ?`)
        .bind(
          id,
          actorId,
          start,
          end,
          open,
          close,
          calendarUid(id),
          `rpt_${crypto.randomUUID().replaceAll("-", "")}`,
          now,
          now,
          sourceEventId
        ),
      db
        .prepare(`INSERT INTO ticket_types (id,event_id,name,description,kind,price_minor,quantity,sales_start_at,sales_end_at,hidden,updated_at)
        SELECT json_extract(m.value,'$.newId'),?,t.name,t.description,t.kind,t.price_minor,t.quantity,?,?,t.hidden,?
        FROM ticket_types t JOIN json_each(?) m ON json_extract(m.value,'$.oldId') = t.id WHERE t.event_id = ?`)
        .bind(id, open, close, now, mapping, sourceEventId),
      db
        .prepare(`INSERT INTO inventory (id,event_id,ticket_type_id,section,row,number,accessible,enabled)
        SELECT lower(hex(randomblob(16))),?,json_extract(m.value,'$.newId'),i.section,i.row,i.number,i.accessible,i.enabled
        FROM inventory i JOIN json_each(?) m ON json_extract(m.value,'$.oldId') = i.ticket_type_id WHERE i.event_id = ?`)
        .bind(id, mapping, sourceEventId),
      ...inventoryGuards(db, id),
      db
        .prepare(`INSERT INTO audit_entries (id,event_id,actor_id,scope,action,entity_id,description,correlation_id,created_at)
        VALUES (?, ?, ?, 'event', 'event.duplicated', ?, 'Created a new draft from reusable past-event configuration.', ?, ?)`)
        .bind(crypto.randomUUID(), id, actorId, id, input.requestId, now),
      db
        .prepare(
          `INSERT INTO outbox (id,kind,entity_id,payload_json,created_at,next_attempt_at) VALUES (?, 'event.changed', ?, ?, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          id,
          JSON.stringify({
            eventId: id,
            resourceId: id,
            action: "event.duplicated",
            revision: 0,
          }),
          now,
          now
        ),
      db
        .prepare(
          `INSERT INTO request_receipts (actor_id,request_id,input_hash,resource_id,response_json,created_at) VALUES (?,?,?,?,?,?)`
        )
        .bind(
          actorId,
          input.requestId,
          hash,
          id,
          JSON.stringify(response),
          now
        ),
    ])
    return duplicatePastEventResponseSchema.parse(response)
  } catch (error) {
    if (!isTransitionConflict(error)) throw error
    await retainedEvent(
      db,
      actorId,
      sourceEventId,
      dependencies.now?.() ?? Date.now(),
      "event:manage"
    )
    const receipt = await readReceipt(db, actorId, input.requestId, hash)
    if (receipt?.responseJson)
      return duplicatePastEventResponseSchema.parse(
        JSON.parse(receipt.responseJson)
      )
    throw new ApiFailure(
      "CONFLICT",
      409,
      "The source event, authority or inventory changed. Reload the past event before duplicating it."
    )
  }
}
