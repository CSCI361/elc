import {
  operationsQuerySchema,
  operationsResponseSchema,
  type OperationsResponse,
} from "@elc/shared"
import { ApiFailure, assertSql } from "../db/transitions"
import {
  retentionColumns,
  retentionDto,
  type RetentionRow,
} from "../history/store"

const authority = `EXISTS (SELECT 1 FROM user actor LEFT JOIN profiles profile ON profile.user_id=actor.id
 WHERE actor.id=? AND actor.email_verified=1 AND profile.suspended_at IS NULL
 AND EXISTS (SELECT 1 FROM platform_grants g WHERE g.user_id=actor.id AND g.permission='platform:moderate'))`
const retained = `(e.expires_at>? OR e.refund_hold OR e.payment_hold OR e.case_hold OR e.admission_hold)`
const retentionProjection = `e.expires_at,e.refund_hold,e.payment_hold,e.case_hold,e.admission_hold`

/** Bounded operational projections omit credentials, checkout URLs and provider payloads. */
export async function listOperations(
  db: D1Database,
  actorId: string,
  raw: unknown = {},
  dependencies: { now?: () => number; beforeRead?: () => Promise<void> } = {}
) {
  const parsed = operationsQuerySchema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Choose valid operational search filters."
    )
  if (!(await db.prepare(`SELECT 1 WHERE ${authority}`).bind(actorId).first()))
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "Platform moderation permission is required."
    )
  const input = parsed.data
  const parts: string[] = [],
    bindings: unknown[] = []
  const alias =
    input.kind === "orders" ? "o" : input.kind === "payments" ? "p" : "a"
  parts.push(`${alias}.id>?`)
  bindings.push(input.after ?? "")
  if (input.q) {
    parts.push(
      input.kind === "orders"
        ? "o.id=?"
        : input.kind === "payments"
          ? "(p.id=? OR p.subject_id=? OR p.provider_payment_id=? OR p.provider_order_id=?)"
          : "(a.id=? OR a.entity_id=? OR a.correlation_id=? OR a.action=?)"
    )
    bindings.push(
      ...Array.from({ length: input.kind === "orders" ? 1 : 4 }, () => input.q)
    )
  }
  if (input.eventId) {
    parts.push("e.id=?")
    bindings.push(input.eventId)
  }
  if (input.accountId) {
    parts.push(
      `${alias}.${input.kind === "orders" ? "account_id" : "actor_id"}=?`
    )
    bindings.push(input.accountId)
  }
  if (input.campaignId) {
    parts.push("o.campaign_id=?")
    bindings.push(input.campaignId)
  }
  await dependencies.beforeRead?.()
  const now = (dependencies.now ?? Date.now)()
  const select =
    input.kind === "orders"
      ? `SELECT o.id,o.event_id AS eventId,o.account_id AS accountId,o.state,o.total_minor AS totalMinor,o.discount_minor AS discountMinor,o.processing_fee_minor AS processingFeeMinor,o.currency,o.created_at AS createdAt,${retentionProjection}
     FROM orders o JOIN retained_events e ON e.id=o.event_id`
      : input.kind === "payments"
        ? `SELECT p.id,e.id AS eventId,p.actor_id AS actorId,p.subject_id AS subjectId,p.purpose,p.state,p.dispatch_state AS dispatchState,p.provider_payment_id AS providerPaymentId,p.provider_order_id AS providerOrderId,p.amount_minor AS amountMinor,p.currency,p.created_at AS createdAt,r.state AS refundState,r.amount_minor AS refundAmountMinor,${retentionProjection}
      FROM payment_attempts p LEFT JOIN orders o ON p.purpose='ticket_order' AND o.id=p.subject_id JOIN retained_events e ON e.id=CASE WHEN p.purpose='event_activation' THEN p.subject_id ELSE o.event_id END LEFT JOIN refunds r ON r.payment_attempt_id=p.id`
        : `SELECT a.id,a.event_id AS eventId,a.actor_id AS actorId,a.scope,a.action,a.entity_id AS entityId,a.description,a.correlation_id AS correlationId,a.created_at AS createdAt,
      CASE WHEN a.event_id IS NULL THEN a.created_at+15552000000 ELSE e.expires_at END AS expires_at,COALESCE(e.refund_hold,0) AS refund_hold,COALESCE(e.payment_hold,0) AS payment_hold,COALESCE(e.case_hold,0) AS case_hold,COALESCE(e.admission_hold,0) AS admission_hold
      FROM audit_entries a LEFT JOIN retained_events e ON e.id=a.event_id`
  const retentionFilter =
    input.kind === "audit"
      ? `((a.event_id IS NULL AND a.created_at>?) OR (a.event_id IS NOT NULL AND ${retained}))`
      : retained
  const timeBindings = input.kind === "audit" ? [now - 15552000000, now] : [now]
  const result = await db.batch([
    db.prepare(`SELECT (${authority}) AS allowed`).bind(actorId),
    db
      .prepare(
        `WITH retained_events AS (SELECT e.id,${retentionColumns} FROM events e) ${select} WHERE ${parts.join(" AND ")} AND ${retentionFilter} AND (${authority}) ORDER BY ${alias}.id LIMIT ?`
      )
      .bind(...bindings, ...timeBindings, actorId, input.limit + 1),
  ])
  if (!(result[0]!.results[0] as { allowed: number }).allowed)
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "Platform moderation permission is required."
    )
  const rows = result[1]!.results as (Record<string, unknown> & RetentionRow)[]
  const nextCursor =
    rows.length > input.limit ? rows[input.limit - 1]!.id : null
  const items = rows.slice(0, input.limit).map((row) => {
    const {
      expires_at,
      refund_hold,
      payment_hold,
      case_hold,
      admission_hold,
      ...item
    } = row
    return {
      ...item,
      createdAt: new Date(item.createdAt as number).toISOString(),
      retention: retentionDto({
        expires_at,
        refund_hold,
        payment_hold,
        case_hold,
        admission_hold,
      }),
    }
  })
  return operationsResponseSchema.parse({
    kind: input.kind,
    items,
    nextCursor,
    generatedAt: new Date(now).toISOString(),
  })
}

function csvCell(value: unknown): string {
  if (
    value !== null &&
    value !== undefined &&
    !["string", "number", "boolean"].includes(typeof value)
  )
    throw new Error("CSV columns must contain scalar values.")
  const raw =
    value === null || value === undefined
      ? ""
      : String(value as string | number | boolean)
  // Quoting alone does not stop spreadsheet formula evaluation.
  const safe =
    /^[\s\uFEFF]*[=+@-]/u.test(raw) || /^[\t\r\n]/u.test(raw) ? `'${raw}` : raw
  return `"${safe.replaceAll('"', '""')}"`
}
export async function exportOperations(
  db: D1Database,
  actorId: string,
  raw: unknown = {},
  dependencies: { now?: () => number; beforeExport?: () => Promise<void> } = {}
) {
  const page = await listOperations(db, actorId, raw, dependencies)
  await dependencies.beforeExport?.()
  const now = (dependencies.now ?? Date.now)()
  if (!(await db.prepare(`SELECT 1 WHERE ${authority}`).bind(actorId).first()))
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "Platform moderation permission is required."
    )
  try {
    await db.batch([
      ...assertSql(db, authority, [actorId]),
      db
        .prepare(
          "INSERT INTO audit_entries(id,actor_id,scope,action,entity_id,description,correlation_id,created_at) VALUES(?,?,'platform','operations.exported',?,?,?,?)"
        )
        .bind(
          crypto.randomUUID(),
          actorId,
          page.kind,
          `Exported ${page.items.length} ${page.items.length === 1 ? "record" : "records"} from ${page.kind}.`,
          crypto.randomUUID(),
          now
        ),
    ])
  } catch (error) {
    if (
      !(await db.prepare(`SELECT 1 WHERE ${authority}`).bind(actorId).first())
    )
      throw new ApiFailure(
        "FORBIDDEN",
        403,
        "Platform moderation permission is required."
      )
    throw error
  }
  return { kind: page.kind, csv: operationsCsv(page) }
}
/** Export exactly one authorized page, with stable explicit columns. */
export function operationsCsv(page: OperationsResponse) {
  const columns =
    page.kind === "orders"
      ? [
          "id",
          "eventId",
          "accountId",
          "state",
          "totalMinor",
          "discountMinor",
          "processingFeeMinor",
          "currency",
          "createdAt",
        ]
      : page.kind === "payments"
        ? [
            "id",
            "eventId",
            "actorId",
            "subjectId",
            "purpose",
            "state",
            "dispatchState",
            "providerPaymentId",
            "providerOrderId",
            "amountMinor",
            "currency",
            "refundState",
            "refundAmountMinor",
            "createdAt",
          ]
        : [
            "id",
            "eventId",
            "actorId",
            "scope",
            "action",
            "entityId",
            "description",
            "correlationId",
            "createdAt",
          ]
  const lines = [
    [
      ...columns,
      "retentionExpiresAt",
      "retentionHeld",
      "retentionHoldReasons",
      "generatedAt",
    ]
      .map(csvCell)
      .join(","),
  ]
  for (const item of page.items) {
    const row = item as Record<string, unknown>
    lines.push(
      [
        ...columns.map((column) => row[column]),
        item.retention.expiresAt,
        item.retention.held,
        item.retention.holdReasons.join(";"),
        page.generatedAt,
      ]
        .map(csvCell)
        .join(",")
    )
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n"
}
