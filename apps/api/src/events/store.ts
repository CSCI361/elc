import {
  eventApiSchema,
  eventMutationResponseSchema,
  deriveEventPhase,
  type EventMutationResponse,
} from "@elc/shared"
import {
  requireActiveAccount,
  requireEventPermission,
} from "../auth/permissions"
import {
  ApiFailure,
  assertSql,
  isTransitionConflict,
  readReceipt,
  requestHash,
} from "../db/transitions"

export type EventContext = {
  db: D1Database
  actorId: string
  correlationId: string
  appOrigin: string
  now: number
}

export type EventRow = {
  images_json?: string
  id: string
  organizer_id: string
  title: string
  description: string
  category: string
  venue_name: string
  venue_address: string
  starts_at: number
  ends_at: number
  registration_opens_at: number
  registration_closes_at: number
  time_zone: string
  visibility: "public" | "unlisted" | "private"
  publication_state: "draft" | "published" | "unpublished"
  paid_sales_state: "pending" | "active" | "suspended"
  seating_mode: "general_admission" | "assigned"
  venue_layout_id: string | null
  capacity: number
  max_tickets_per_order: number
  suspended_at: number | null
  cancelled_at: number | null
  created_at: number
  updated_at: number
  calendar_uid: string
  calendar_sequence: number
  reporting_id: string
  revision: number
  refund_instructions: string
}

export const iso = (value: number) => new Date(value).toISOString()

/** Read the ordered gallery in the same D1 statement as its event revision. */
export const eventImageProjection = `COALESCE((SELECT json_group_array(json_object(
  'id',i.id,'url','/api/events/'||i.event_id||'/images/'||i.id,
  'altText',i.alt_text,'position',i.position,'contentType',i.content_type,'sizeBytes',i.content_size))
  FROM (SELECT l.id,l.event_id,l.alt_text,l.position,a.content_type,a.content_size
    FROM event_images l JOIN event_image_assets a ON a.id=l.asset_id
    WHERE l.event_id=e.id AND a.state='ready' ORDER BY l.position,l.id) i),'[]') AS images_json`

export function eventDto(row: EventRow, now: number) {
  return eventApiSchema.parse({
    images: JSON.parse(row.images_json ?? "[]"),
    id: row.id,
    organizerId: row.organizer_id,
    title: row.title,
    description: row.description,
    category: row.category,
    venueName: row.venue_name,
    venueAddress: row.venue_address,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    registrationOpensAt: iso(row.registration_opens_at),
    registrationClosesAt: iso(row.registration_closes_at),
    timeZone: row.time_zone,
    visibility: row.visibility,
    publicationState: row.publication_state,
    paidSalesState: row.paid_sales_state,
    seatingMode: row.seating_mode,
    venueLayoutId: row.venue_layout_id ?? undefined,
    capacity: row.capacity,
    maxTicketsPerOrder: row.max_tickets_per_order,
    suspendedAt: row.suspended_at === null ? null : iso(row.suspended_at),
    cancelledAt: row.cancelled_at === null ? null : iso(row.cancelled_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    revision: row.revision,
    reportingId: row.reporting_id,
    refundInstructions: row.refund_instructions,
    phase: deriveEventPhase(
      {
        startsAt: iso(row.starts_at),
        endsAt: iso(row.ends_at),
        cancelledAt: row.cancelled_at === null ? null : iso(row.cancelled_at),
      },
      iso(now)
    ),
    calendar: {
      uid: row.calendar_uid,
      sequence: row.calendar_sequence,
      status: row.cancelled_at === null ? "CONFIRMED" : "CANCELLED",
      updatedAt: iso(row.updated_at),
    },
  })
}

export async function findEvent(
  db: D1Database,
  eventId: string
): Promise<EventRow> {
  const event = await db
    .prepare(`SELECT e.*,${eventImageProjection} FROM events e WHERE e.id = ?`)
    .bind(eventId)
    .first<EventRow>()
  if (!event) throw new ApiFailure("NOT_FOUND", 404, "Event not found.")
  return event
}

export const activeAccountSql = `EXISTS (
  SELECT 1 FROM user u WHERE u.id = ? AND u.email_verified = 1
  AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = u.id AND p.suspended_at IS NOT NULL)
)`

export const manageEventSql = `EXISTS (
  SELECT 1 FROM events e WHERE e.id = ? AND (e.organizer_id = ? OR EXISTS (
    SELECT 1 FROM event_permissions ep WHERE ep.event_id = e.id AND ep.user_id = ?
      AND ep.permission = 'event:manage' AND ep.revoked_at IS NULL
  ))
)`

export function inventoryGuards(db: D1Database, eventId: string) {
  return assertSql(
    db,
    `EXISTS (
    SELECT 1 FROM events e WHERE e.id = ?
      AND (SELECT COALESCE(SUM(t.quantity), 0) FROM ticket_types t WHERE t.event_id = e.id) <= e.capacity
      AND (SELECT COUNT(*) FROM inventory i WHERE i.event_id = e.id) <= e.capacity
      AND NOT EXISTS (SELECT 1 FROM ticket_types t WHERE t.event_id = e.id
        AND t.quantity != (SELECT COUNT(*) FROM inventory i WHERE i.ticket_type_id = t.id))
  )`,
    [eventId]
  )
}

export async function existingMutation<Input extends { requestId: string }>(
  context: EventContext,
  eventId: string | null,
  operation: string,
  input: Input
) {
  if (eventId)
    await requireEventPermission(
      context.db,
      context.actorId,
      eventId,
      "event:manage"
    )
  else await requireActiveAccount(context.db, context.actorId)
  const hash = await requestHash(operation, input)
  const receipt = await readReceipt(
    context.db,
    context.actorId,
    input.requestId,
    hash
  )
  return {
    hash,
    response: receipt?.responseJson
      ? eventMutationResponseSchema.parse(JSON.parse(receipt.responseJson))
      : null,
  }
}

export async function commitMutation(
  context: EventContext,
  options: {
    eventId: string
    expectedRevision?: number
    requestId: string
    inputHash: string
    action: string
    description: string
    resourceId: string
    statements: D1PreparedStatement[]
  }
): Promise<EventMutationResponse> {
  const { db, actorId, now } = context
  const isCreate = options.expectedRevision === undefined
  const response = {
    eventId: options.eventId,
    resourceId: options.resourceId,
    revision: isCreate ? 0 : options.expectedRevision! + 1,
  }
  const guards = assertSql(db, activeAccountSql, [actorId])
  if (!isCreate) {
    guards.push(
      ...assertSql(db, manageEventSql, [options.eventId, actorId, actorId])
    )
    guards.push(
      ...assertSql(
        db,
        `EXISTS (SELECT 1 FROM events WHERE id = ? AND revision = ? AND cancelled_at IS NULL)`,
        [options.eventId, options.expectedRevision]
      )
    )
  }
  const auditId = crypto.randomUUID()
  const jobId = crypto.randomUUID()
  const tail: D1PreparedStatement[] = []
  if (!isCreate) {
    tail.push(
      db
        .prepare(
          "UPDATE events SET revision = revision + 1, updated_at = ? WHERE id = ?"
        )
        .bind(now, options.eventId)
    )
  }
  tail.push(
    db
      .prepare(`INSERT INTO audit_entries (id, event_id, actor_id, scope, action, entity_id, description, correlation_id, created_at)
      VALUES (?, ?, ?, 'event', ?, ?, ?, ?, ?)`)
      .bind(
        auditId,
        options.eventId,
        actorId,
        options.action,
        options.resourceId,
        options.description,
        context.correlationId,
        now
      ),
    db
      .prepare(`INSERT INTO outbox (id, kind, entity_id, payload_json, created_at, next_attempt_at)
      VALUES (?, 'event.changed', ?, ?, ?, ?)`)
      .bind(
        jobId,
        options.eventId,
        JSON.stringify({
          eventId: options.eventId,
          resourceId: options.resourceId,
          action: options.action,
          revision: response.revision,
        }),
        now,
        now
      ),
    db
      .prepare(`INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, response_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(
        actorId,
        options.requestId,
        options.inputHash,
        options.resourceId,
        JSON.stringify(response),
        now
      )
  )
  try {
    await db.batch([
      ...guards,
      ...options.statements,
      ...inventoryGuards(db, options.eventId),
      ...tail,
    ])
    return response
  } catch (error) {
    if (!isTransitionConflict(error)) throw error
    if (!isCreate)
      await requireEventPermission(db, actorId, options.eventId, "event:manage")
    else await requireActiveAccount(db, actorId)
    const receipt = await readReceipt(
      db,
      actorId,
      options.requestId,
      options.inputHash
    )
    if (receipt?.responseJson)
      return eventMutationResponseSchema.parse(JSON.parse(receipt.responseJson))
    throw new ApiFailure(
      "CONFLICT",
      409,
      "The event changed or this operation no longer fits its inventory. Refresh and try again."
    )
  }
}
