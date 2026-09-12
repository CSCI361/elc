import { z } from "zod"
import {
  supportCaseListQuerySchema,
  supportCaseListSchema,
  supportCaseResponseSchema,
  supportChangeListSchema,
  supportHistoryQuerySchema,
  supportMessageListSchema,
} from "@elc/shared"
import { requireActiveAccount } from "../auth/permissions"
import { ApiFailure, requestHash } from "../db/transitions"
import { supportAccessExpression, supportCaseAccessSql } from "./guards"
import {
  caseDto,
  changeDto,
  messageDto,
  parseSupport,
  requireSupportCase,
  type CaseRow,
  type ChangeRow,
  type MessageRow,
} from "./store"

export async function readSupportCase(
  db: D1Database,
  actorId: string,
  caseId: string
) {
  const row = await requireSupportCase(db, actorId, caseId)
  const guard = supportCaseAccessSql(actorId, caseId, "manage")
  const staff = await db
    .prepare(`SELECT 1 WHERE ${guard.predicate}`)
    .bind(...guard.bindings)
    .first()
  await requireSupportCase(db, actorId, caseId)
  return supportCaseResponseSchema.parse({
    case: caseDto(row),
    permissions: {
      canMessage: row.status !== "resolved",
      canManage: Boolean(staff),
    },
  })
}

const cursorSchema = z.strictObject({
  createdAt: z.int().nonnegative(),
  id: z.string().min(1).max(128),
  filter: z.string().length(64),
})
export async function listSupportCases(
  db: D1Database,
  actorId: string,
  raw: unknown = {}
) {
  const query = parseSupport(supportCaseListQuerySchema, raw)
  await requireActiveAccount(db, actorId)
  const filter = await requestHash("support.list", {
    actorId,
    view: query.view,
    eventId: query.eventId,
    status: query.status,
    category: query.category,
  })
  let cursor: z.infer<typeof cursorSchema> | null = null
  if (query.cursor) {
    try {
      cursor = cursorSchema.parse(JSON.parse(atob(query.cursor)))
    } catch {
      throw new ApiFailure(
        "INVALID_INPUT",
        400,
        "The support list cursor is invalid."
      )
    }
    if (cursor.filter !== filter)
      throw new ApiFailure(
        "INVALID_INPUT",
        400,
        "The cursor belongs to another support list."
      )
  }
  const conditions = [
    supportAccessExpression("c", query.view === "staff" ? "manage" : "read"),
  ]
  const bindings: unknown[] = [actorId]
  if (query.view === "mine") {
    conditions.push("c.requester_id = ?")
    bindings.push(actorId)
  }
  if (query.view === "assigned") {
    conditions.push("c.assignee_id = ?")
    bindings.push(actorId)
  }
  for (const [column, value] of [
    ["event_id", query.eventId],
    ["status", query.status],
    ["category", query.category],
  ] as const) {
    if (value !== undefined) {
      conditions.push(`c.${column} = ?`)
      bindings.push(value)
    }
  }
  if (cursor) {
    conditions.push("(c.created_at < ? OR (c.created_at = ? AND c.id < ?))")
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.id)
  }
  const rows = (
    await db
      .prepare(
        `SELECT c.* FROM support_cases c WHERE ${conditions.join(" AND ")} ORDER BY c.created_at DESC, c.id DESC LIMIT ?`
      )
      .bind(...bindings, query.limit + 1)
      .all<CaseRow>()
  ).results
  const selected = rows.slice(0, query.limit)
  const last = selected.at(-1)
  return supportCaseListSchema.parse({
    items: selected.map(caseDto),
    nextCursor:
      rows.length > query.limit && last
        ? btoa(
            JSON.stringify({ createdAt: last.created_at, id: last.id, filter })
          )
        : null,
  })
}

async function historyContext(
  db: D1Database,
  actorId: string,
  caseId: string,
  raw: unknown
) {
  const query = parseSupport(supportHistoryQuerySchema, raw)
  const row = await requireSupportCase(db, actorId, caseId)
  if (query.after > row.last_sequence)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "The update cursor is ahead of this case."
    )
  return { query, row }
}

/** The upper bound is a stable catch-up boundary even if another reply commits during this read. */
export async function listSupportMessages(
  db: D1Database,
  actorId: string,
  caseId: string,
  raw: unknown = {}
) {
  const { query, row } = await historyContext(db, actorId, caseId, raw)
  const rows = (
    await db
      .prepare(`SELECT m.* FROM support_messages m JOIN support_cases c ON c.id = m.case_id
    WHERE m.case_id = ? AND m.sequence > ? AND m.sequence <= ? AND ${supportAccessExpression("c")}
    ORDER BY m.sequence LIMIT ?`)
      .bind(caseId, query.after, row.last_sequence, actorId, query.limit + 1)
      .all<MessageRow>()
  ).results
  await requireSupportCase(db, actorId, caseId)
  const selected = rows.slice(0, query.limit)
  return supportMessageListSchema.parse({
    items: selected.map(messageDto),
    nextCursor: rows.length > query.limit ? selected.at(-1)!.sequence : null,
    throughSequence: row.last_sequence,
    caseRevision: row.revision,
  })
}

export async function listSupportChanges(
  db: D1Database,
  actorId: string,
  caseId: string,
  raw: unknown = {}
) {
  const { query, row } = await historyContext(db, actorId, caseId, raw)
  const rows = (
    await db
      .prepare(`SELECT ch.* FROM support_case_changes ch JOIN support_cases c ON c.id = ch.case_id
    WHERE ch.case_id = ? AND ch.sequence > ? AND ch.sequence <= ? AND ${supportAccessExpression("c")}
    ORDER BY ch.sequence LIMIT ?`)
      .bind(caseId, query.after, row.last_sequence, actorId, query.limit + 1)
      .all<ChangeRow>()
  ).results
  const selected = rows.slice(0, query.limit)
  const messages = selected.some((change) => change.message_id !== null)
    ? (
        await db
          .prepare(
            "SELECT * FROM support_messages WHERE case_id = ? AND id IN (SELECT value FROM json_each(?))"
          )
          .bind(
            caseId,
            JSON.stringify(
              selected.flatMap((change) =>
                change.message_id ? [change.message_id] : []
              )
            )
          )
          .all<MessageRow>()
      ).results
    : []
  await requireSupportCase(db, actorId, caseId)
  return supportChangeListSchema.parse({
    items: selected.map((change) =>
      changeDto(
        change,
        messages.find((message) => message.id === change.message_id)
      )
    ),
    nextCursor: rows.length > query.limit ? selected.at(-1)!.sequence : null,
    throughSequence: row.last_sequence,
    caseRevision: row.revision,
  })
}
