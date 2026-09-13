import { z } from "zod"
import {
  supportCaseApiSchema,
  supportCaseChangeApiSchema,
  supportMessageApiSchema,
  type SupportAudience,
  type SupportCategory,
  type SupportStatus,
  type SupportMessageAttachment,
} from "@elc/shared"
import { requireActiveAccount } from "../auth/permissions"
import { ApiFailure } from "../db/transitions"
import { supportAccessExpression } from "./guards"

export type SupportDependencies = {
  now?: () => number
  beforeCommit?: () => Promise<void>
}
export type CaseRow = {
  id: string
  requester_id: string
  audience: SupportAudience
  category: SupportCategory
  subject: string
  event_id: string | null
  order_id: string | null
  ticket_id: string | null
  assignee_id: string | null
  status: SupportStatus
  revision: number
  last_sequence: number
  created_at: number
  updated_at: number
  resolved_at: number | null
}
export type MessageRow = {
  id: string
  case_id: string
  sequence: number
  author_id: string
  author_name: string
  body: string
  created_at: number
}
export type ChangeRow = {
  id: string
  case_id: string
  sequence: number
  actor_id: string
  kind: "created" | "message" | "assignment" | "status"
  message_id: string | null
  before_json: string
  after_json: string
  created_at: number
}
export const iso = (value: number | null) =>
  value === null ? null : new Date(value).toISOString()
export function parseSupport<Schema extends z.ZodType>(
  schema: Schema,
  raw: unknown
): z.output<Schema> {
  const result = schema.safeParse(raw)
  if (!result.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Provide valid support fields and the current case revision."
    )
  return result.data
}
export function supportTime(dependencies: SupportDependencies, minimum = 0) {
  const value = (dependencies.now ?? Date.now)()
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid support clock")
  return Math.max(value, minimum)
}
export function caseDto(row: CaseRow) {
  return supportCaseApiSchema.parse({
    id: row.id,
    requesterId: row.requester_id,
    audience: row.audience,
    category: row.category,
    subject: row.subject,
    eventId: row.event_id,
    orderId: row.order_id,
    ticketId: row.ticket_id,
    assigneeId: row.assignee_id,
    status: row.status,
    revision: row.revision,
    lastSequence: row.last_sequence,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    resolvedAt: iso(row.resolved_at),
    payoutHeld:
      row.order_id !== null &&
      row.status !== "resolved" &&
      ["refund", "dispute", "compensation"].includes(row.category),
  })
}
export function messageDto(
  row: MessageRow,
  attachments: SupportMessageAttachment[] = []
) {
  return supportMessageApiSchema.parse({
    id: row.id,
    caseId: row.case_id,
    sequence: row.sequence,
    authorId: row.author_id,
    authorName: row.author_name,
    body: row.body,
    createdAt: iso(row.created_at),
    attachments,
  })
}
export function changeDto(
  row: ChangeRow,
  message?: MessageRow,
  attachments: SupportMessageAttachment[] = []
) {
  return supportCaseChangeApiSchema.parse({
    id: row.id,
    caseId: row.case_id,
    sequence: row.sequence,
    actorId: row.actor_id,
    kind: row.kind,
    before: row.kind === "created" ? null : JSON.parse(row.before_json),
    after: JSON.parse(row.after_json),
    message: message ? messageDto(message, attachments) : null,
    createdAt: iso(row.created_at),
  })
}
export const stateJson = (row: CaseRow) =>
  JSON.stringify({ status: row.status, assigneeId: row.assignee_id })

/** A case assignment cannot substitute for current support authority. */
export async function requireSupportCase(
  db: D1Database,
  actorId: string,
  caseId: string,
  mode: "read" | "manage" = "read"
): Promise<CaseRow> {
  await requireActiveAccount(db, actorId)
  const row = await db
    .prepare(
      `SELECT c.* FROM support_cases c WHERE c.id = ? AND ${supportAccessExpression("c", mode)}`
    )
    .bind(caseId, actorId)
    .first<CaseRow>()
  if (!row) throw new ApiFailure("NOT_FOUND", 404, "Support case not found.")
  return row
}
