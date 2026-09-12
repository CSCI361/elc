import {
  addSupportMessageSchema,
  assignSupportCaseSchema,
  changeSupportStatusSchema,
  openSupportCaseSchema,
  supportMutationResponseSchema,
  type OpenSupportCase,
  type SupportMutationResponse,
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
import type { SqlPredicate } from "../orders/guards"
import { supportCaseAccessSql, supportEventReadSql } from "./guards"
import {
  caseDto,
  changeDto,
  parseSupport,
  requireSupportCase,
  stateJson,
  supportTime,
  type CaseRow,
  type ChangeRow,
  type MessageRow,
  type SupportDependencies,
} from "./store"

type Context = {
  eventId: string | null
  orderId: string | null
  ticketId: string | null
}
type Mutation = {
  actorId: string
  requestId: string
  hash: string
  previous?: CaseRow
  row: CaseRow
  kind: ChangeRow["kind"]
  body?: string
  guards: SqlPredicate[]
  dependencies: SupportDependencies
}

function contextUnavailable(): never {
  throw new ApiFailure(
    "NOT_FOUND",
    404,
    "The support context is unavailable for this account."
  )
}

async function resolveContext(
  db: D1Database,
  actorId: string,
  input: OpenSupportCase
): Promise<Context> {
  let orderId = input.orderId ?? null
  let eventId = input.eventId ?? null
  const ticketId = input.ticketId ?? null
  if (ticketId) {
    const ticket = await db
      .prepare("SELECT order_id, event_id FROM tickets WHERE id = ?")
      .bind(ticketId)
      .first<{ order_id: string; event_id: string }>()
    if (
      !ticket ||
      (orderId && orderId !== ticket.order_id) ||
      (eventId && eventId !== ticket.event_id)
    )
      contextUnavailable()
    orderId = ticket.order_id
    eventId = ticket.event_id
  }
  if (orderId) {
    const order = await db
      .prepare("SELECT account_id, event_id FROM orders WHERE id = ?")
      .bind(orderId)
      .first<{ account_id: string; event_id: string }>()
    if (
      !order ||
      (eventId && eventId !== order.event_id) ||
      (input.audience === "attendee" && order.account_id !== actorId)
    )
      contextUnavailable()
    eventId = order.event_id
  }
  if (input.audience === "attendee" && !eventId)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Choose an event, order or ticket for an attendee request."
    )
  if (
    ["refund", "dispute", "compensation"].includes(input.category) &&
    !orderId
  )
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "This category requires an order or ticket context."
    )
  if (eventId) {
    const event = await db
      .prepare("SELECT organizer_id FROM events WHERE id = ?")
      .bind(eventId)
      .first<{ organizer_id: string }>()
    if (
      !event ||
      (input.audience === "organizer_platform" &&
        event.organizer_id !== actorId)
    )
      contextUnavailable()
    if (input.audience === "attendee" && !orderId) {
      const read = supportEventReadSql(actorId, eventId)
      if (
        !(await db
          .prepare(`SELECT 1 WHERE ${read.predicate}`)
          .bind(...read.bindings)
          .first())
      )
        contextUnavailable()
    }
  }
  return { eventId, orderId, ticketId }
}

function contextGuards(
  actorId: string,
  input: OpenSupportCase,
  context: Context
): SqlPredicate[] {
  const guards: SqlPredicate[] = [
    { predicate: activeAccountSql, bindings: [actorId] },
  ]
  if (context.eventId) {
    if (input.audience === "organizer_platform")
      guards.push({
        predicate:
          "EXISTS (SELECT 1 FROM events WHERE id = ? AND organizer_id = ?)",
        bindings: [context.eventId, actorId],
      })
    else if (!context.orderId)
      guards.push(supportEventReadSql(actorId, context.eventId))
  }
  if (context.orderId)
    guards.push({
      predicate: `EXISTS (SELECT 1 FROM orders WHERE id = ? AND event_id = ? ${input.audience === "attendee" ? "AND account_id = ?" : ""})`,
      bindings:
        input.audience === "attendee"
          ? [context.orderId, context.eventId, actorId]
          : [context.orderId, context.eventId],
    })
  if (context.ticketId)
    guards.push({
      predicate:
        "EXISTS (SELECT 1 FROM tickets WHERE id = ? AND order_id = ? AND event_id = ?)",
      bindings: [context.ticketId, context.orderId, context.eventId],
    })
  return guards
}

async function replay(
  db: D1Database,
  actorId: string,
  requestId: string,
  hash: string,
  mode: "read" | "manage" = "read"
): Promise<SupportMutationResponse | null> {
  const receipt = await readReceipt(db, actorId, requestId, hash)
  if (!receipt) return null
  await requireSupportCase(db, actorId, receipt.resourceId, mode)
  if (!receipt.responseJson)
    throw new Error("Support receipt lacks its response")
  return supportMutationResponseSchema.parse(JSON.parse(receipt.responseJson))
}

/** A single D1 batch owns the case change, history, audit, delivery jobs and replay receipt. */
async function commit(
  db: D1Database,
  mutation: Mutation
): Promise<SupportMutationResponse> {
  const { actorId, requestId, hash, previous, kind } = mutation
  const author =
    mutation.body === undefined
      ? null
      : await db
          .prepare("SELECT name FROM user WHERE id = ?")
          .bind(actorId)
          .first<{ name: string }>()
  await mutation.dependencies.beforeCommit?.()
  const now = supportTime(mutation.dependencies, previous?.updated_at)
  const row: CaseRow = {
    ...mutation.row,
    updated_at: now,
    created_at: previous?.created_at ?? now,
    resolved_at:
      mutation.row.status === "resolved"
        ? previous?.status === "resolved"
          ? previous.resolved_at
          : now
        : null,
  }
  const message: MessageRow | undefined =
    mutation.body === undefined
      ? undefined
      : {
          id: crypto.randomUUID(),
          case_id: row.id,
          sequence: row.last_sequence,
          author_id: actorId,
          author_name: author?.name.trim().slice(0, 256) || "Account",
          body: mutation.body,
          created_at: now,
        }
  const change: ChangeRow = {
    id: crypto.randomUUID(),
    case_id: row.id,
    sequence: row.last_sequence,
    actor_id: actorId,
    kind,
    message_id: message?.id ?? null,
    before_json: previous ? stateJson(previous) : "{}",
    after_json: stateJson(row),
    created_at: now,
  }
  const response = supportMutationResponseSchema.parse({
    case: caseDto(row),
    change: changeDto(change, message),
  })
  const statements = mutation.guards.flatMap((guard) =>
    assertSql(db, guard.predicate, guard.bindings)
  )
  if (previous) {
    statements.push(
      ...assertSql(
        db,
        "EXISTS (SELECT 1 FROM support_cases WHERE id = ? AND revision = ?)",
        [previous.id, previous.revision]
      ),
      db
        .prepare(
          "UPDATE support_cases SET status = ?, assignee_id = ?, revision = ?, last_sequence = ?, updated_at = ?, resolved_at = ? WHERE id = ? AND revision = ?"
        )
        .bind(
          row.status,
          row.assignee_id,
          row.revision,
          row.last_sequence,
          now,
          row.resolved_at,
          row.id,
          previous.revision
        ),
      ...assertSql(db, "changes() = 1")
    )
  } else {
    statements.push(
      db
        .prepare(`INSERT INTO support_cases (id, requester_id, audience, category, subject, event_id, order_id, ticket_id, assignee_id, status, revision, last_sequence, created_at, updated_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'open', 1, 1, ?, ?, NULL)`)
        .bind(
          row.id,
          actorId,
          row.audience,
          row.category,
          row.subject,
          row.event_id,
          row.order_id,
          row.ticket_id,
          now,
          now
        )
    )
  }
  if (message)
    statements.push(
      db
        .prepare(
          "INSERT INTO support_messages (id, case_id, sequence, author_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          message.id,
          message.case_id,
          message.sequence,
          message.author_id,
          message.author_name,
          message.body,
          now
        )
    )
  statements.push(
    db
      .prepare(
        "INSERT INTO support_case_changes (id, case_id, sequence, actor_id, kind, message_id, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        change.id,
        row.id,
        change.sequence,
        actorId,
        kind,
        change.message_id,
        change.before_json,
        change.after_json,
        now
      )
  )
  // Platform conversations deliberately have no event-scoped audit record, even when linked to an event.
  statements.push(
    db
      .prepare(
        "INSERT INTO audit_entries (id, event_id, actor_id, scope, action, entity_id, description, correlation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        crypto.randomUUID(),
        row.audience === "attendee" ? row.event_id : null,
        actorId,
        row.audience === "attendee" ? "event" : "platform",
        `support.${kind}`,
        row.id,
        `Support case ${kind} recorded.`,
        requestId,
        now
      )
  )
  const payload = JSON.stringify({
    caseId: row.id,
    changeId: change.id,
    sequence: change.sequence,
  })
  for (const channel of ["notify", "live"])
    statements.push(
      db
        .prepare(
          "INSERT INTO outbox (id, kind, entity_id, payload_json, created_at, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(
          `support-${channel}:${change.id}`,
          `support.${channel}`,
          row.id,
          payload,
          now,
          now
        )
    )
  statements.push(
    db
      .prepare(
        "INSERT INTO request_receipts (actor_id, request_id, input_hash, resource_id, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(actorId, requestId, hash, row.id, JSON.stringify(response), now)
  )
  try {
    await db.batch(statements)
  } catch (error) {
    if (!isTransitionConflict(error)) throw error
    const saved = await replay(
      db,
      actorId,
      requestId,
      hash,
      kind === "assignment" || kind === "status" ? "manage" : "read"
    )
    if (saved) return saved
    throw new ApiFailure(
      "CONFLICT",
      409,
      "The case or its permissions changed. Reload before retrying."
    )
  }
  return response
}

export async function createSupportCase(
  db: D1Database,
  actorId: string,
  raw: unknown,
  dependencies: SupportDependencies = {}
) {
  const input = parseSupport(openSupportCaseSchema, raw)
  await requireActiveAccount(db, actorId)
  const hash = await requestHash("support.create", input)
  const saved = await replay(db, actorId, input.requestId, hash)
  if (saved) return saved
  const context = await resolveContext(db, actorId, input)
  const row: CaseRow = {
    id: crypto.randomUUID(),
    requester_id: actorId,
    audience: input.audience,
    category: input.category,
    subject: input.subject,
    event_id: context.eventId,
    order_id: context.orderId,
    ticket_id: context.ticketId,
    assignee_id: null,
    status: "open",
    revision: 1,
    last_sequence: 1,
    created_at: 0,
    updated_at: 0,
    resolved_at: null,
  }
  return commit(db, {
    actorId,
    requestId: input.requestId,
    hash,
    row,
    kind: "created",
    body: input.body,
    guards: contextGuards(actorId, input, context),
    dependencies,
  })
}

export async function addSupportMessage(
  db: D1Database,
  actorId: string,
  caseId: string,
  raw: unknown,
  dependencies: SupportDependencies = {}
) {
  const input = parseSupport(addSupportMessageSchema, raw)
  const previous = await requireSupportCase(db, actorId, caseId)
  const hash = await requestHash("support.message", { caseId, ...input })
  const saved = await replay(db, actorId, input.requestId, hash)
  if (saved) return saved
  if (
    previous.revision !== input.expectedRevision ||
    previous.status === "resolved"
  )
    throw new ApiFailure(
      "CONFLICT",
      409,
      "Reload the case. Staff must reopen a resolved case before another reply."
    )
  return commit(db, {
    actorId,
    requestId: input.requestId,
    hash,
    previous,
    row: {
      ...previous,
      revision: previous.revision + 1,
      last_sequence: previous.last_sequence + 1,
    },
    kind: "message",
    body: input.body,
    guards: [supportCaseAccessSql(actorId, caseId)],
    dependencies,
  })
}

export async function assignSupportCase(
  db: D1Database,
  actorId: string,
  caseId: string,
  raw: unknown,
  dependencies: SupportDependencies = {}
) {
  const input = parseSupport(assignSupportCaseSchema, raw)
  const previous = await requireSupportCase(db, actorId, caseId, "manage")
  const hash = await requestHash("support.assignment", { caseId, ...input })
  const saved = await replay(db, actorId, input.requestId, hash, "manage")
  if (saved) return saved
  if (
    previous.revision !== input.expectedRevision ||
    previous.assignee_id === input.assigneeId
  )
    throw new ApiFailure(
      "CONFLICT",
      409,
      "Reload the case and choose a different assignment."
    )
  const guards = [supportCaseAccessSql(actorId, caseId, "manage")]
  if (input.assigneeId) {
    const eligible = supportCaseAccessSql(input.assigneeId, caseId, "manage")
    if (
      !(await db
        .prepare(`SELECT 1 WHERE ${eligible.predicate}`)
        .bind(...eligible.bindings)
        .first())
    )
      throw new ApiFailure(
        "INVALID_INPUT",
        400,
        "Assign this case only to current authorized support staff."
      )
    guards.push(eligible)
  }
  return commit(db, {
    actorId,
    requestId: input.requestId,
    hash,
    previous,
    row: {
      ...previous,
      assignee_id: input.assigneeId,
      revision: previous.revision + 1,
      last_sequence: previous.last_sequence + 1,
    },
    kind: "assignment",
    guards,
    dependencies,
  })
}

export async function changeSupportStatus(
  db: D1Database,
  actorId: string,
  caseId: string,
  raw: unknown,
  dependencies: SupportDependencies = {}
) {
  const input = parseSupport(changeSupportStatusSchema, raw)
  const previous = await requireSupportCase(db, actorId, caseId, "manage")
  const hash = await requestHash("support.status", { caseId, ...input })
  const saved = await replay(db, actorId, input.requestId, hash, "manage")
  if (saved) return saved
  if (
    previous.revision !== input.expectedRevision ||
    previous.status === input.status
  )
    throw new ApiFailure(
      "CONFLICT",
      409,
      "Reload the case and choose a different status."
    )
  return commit(db, {
    actorId,
    requestId: input.requestId,
    hash,
    previous,
    row: {
      ...previous,
      status: input.status,
      revision: previous.revision + 1,
      last_sequence: previous.last_sequence + 1,
    },
    kind: "status",
    guards: [supportCaseAccessSql(actorId, caseId, "manage")],
    dependencies,
  })
}
