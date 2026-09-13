import { z } from "zod"
import type { Bindings } from "../env"
import { assertSql } from "../db/transitions"
import { supportAccessExpression } from "../support/guards"
import { deliveryDigest, deliveryOutboxId } from "./jobs"
import { currentSupportAssigneeSql } from "./sources"

const sourceKinds = [
  "order.completed",
  "payment.failed",
  "activation.completed",
  "event.changed",
  "refund.changed",
  "payout.simulated",
  "payout.adjusted",
  "support.notify",
  "registration.cancelled",
] as const
const sourceKindsSql = sourceKinds.map((kind) => `'${kind}'`).join(",")
const identifier = z.string().min(1).max(128)
const sourcePayloads = {
  "order.completed": z.strictObject({ orderId: identifier }),
  "payment.failed": z.strictObject({ paymentAttemptId: identifier }),
  "activation.completed": z.strictObject({
    eventId: identifier,
    paymentAttemptId: identifier,
  }),
  "event.changed": z.strictObject({
    eventId: identifier,
    resourceId: identifier,
    action: z.string().min(1).max(100),
    revision: z.int().nonnegative(),
  }),
  "refund.changed": z.strictObject({
    refundId: identifier,
    paymentAttemptId: identifier,
    state: z.enum(["requested", "pending", "succeeded", "failed"]),
  }),
  "payout.simulated": z.strictObject({
    payoutId: identifier,
    eventId: identifier,
    simulation: z.literal(true),
  }),
  "payout.adjusted": z.strictObject({
    payoutId: identifier,
    eventId: identifier,
    refundId: identifier,
    simulation: z.literal(true),
  }),
  "support.notify": z.strictObject({
    caseId: identifier,
    changeId: identifier,
    sequence: z.int().positive(),
  }),
  "registration.cancelled": z.strictObject({ orderId: identifier }),
}
type Source = {
  id: string
  kind: (typeof sourceKinds)[number]
  entity_id: string
  payload_json: string
  created_at: number
  completed_at: number | null
  attempts: number
}
type Cursor =
  | { mode: "orders"; at: number; id: string }
  | { mode: "tickets"; after: string; part: number; total: number }
  | { mode: "recipients"; after: string; selection: string }
  | { mode: "done"; reason: "complete" | "invalid" | "ineligible" }
const cursorSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("orders"),
    at: z.int().nonnegative(),
    id: identifier,
  }),
  z.strictObject({
    mode: z.literal("tickets"),
    after: identifier,
    part: z.int().positive(),
    total: z.int().positive(),
  }),
  z.strictObject({
    mode: z.literal("recipients"),
    after: identifier,
    selection: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.strictObject({
    mode: z.literal("done"),
    reason: z.enum(["complete", "invalid", "ineligible"]),
  }),
])
type Predicate = { sql: string; values: unknown[] }
type Recipient = {
  recipient_id: string
  email: string
  event_id: string | null
  entity_id: string
}
type Job = Recipient & {
  kind: string
  metadata: Record<string, unknown>
  part: string
  guard: Predicate
  id?: string
}
type Page = {
  jobs: Job[]
  cursor: Cursor
  complete: boolean
  guard?: Predicate
}
export type NotificationFanoutDependencies = {
  now?: () => number
  beforeCommit?: () => Promise<void>
}
const active = "u.email_verified=1 AND p.suspended_at IS NULL"
const accountJoins =
  "JOIN user u ON u.id=recipient_id LEFT JOIN profiles p ON p.user_id=u.id"
const terminal = (reason: "complete" | "invalid" | "ineligible"): Page => ({
  jobs: [],
  cursor: { mode: "done", reason },
  complete: true,
})
const validRecipient = (row: Recipient) =>
  identifier.safeParse(row.recipient_id).success &&
  z.email().max(254).safeParse(row.email).success
const empty = (
  row: Recipient,
  kind: string,
  guard: Predicate,
  metadata: Record<string, unknown> = {}
): Job => ({ ...row, kind, guard, metadata, part: "" })

function payload(source: Source): Record<string, unknown> | null {
  if (source.payload_json.length > 8192) return null
  try {
    const value = sourcePayloads[source.kind].safeParse(
      JSON.parse(source.payload_json)
    )
    return value.success ? value.data : null
  } catch {
    return null
  }
}
function queryGuard(
  query: string,
  values: unknown[],
  row: Recipient
): Predicate {
  return {
    sql: `EXISTS (SELECT 1 FROM (${query}) selected WHERE selected.recipient_id=? AND selected.email=? AND selected.entity_id=? AND selected.event_id IS ?)`,
    values: [
      ...values,
      row.recipient_id,
      row.email,
      row.entity_id,
      row.event_id,
    ],
  }
}
async function single(
  db: D1Database,
  query: string,
  values: unknown[],
  kind: string,
  metadata: Record<string, unknown> = {}
): Promise<Page> {
  const row = await db
    .prepare(query)
    .bind(...values)
    .first<Recipient>()
  return !row || !validRecipient(row)
    ? terminal("ineligible")
    : {
        ...terminal("complete"),
        jobs: [empty(row, kind, queryGuard(query, values, row), metadata)],
      }
}

const completedOrderQuery = `SELECT o.id entity_id,o.event_id,o.account_id recipient_id,u.email
  FROM orders o JOIN events e ON e.id=o.event_id JOIN user u ON u.id=o.account_id LEFT JOIN profiles p ON p.user_id=u.id
  WHERE o.id=? AND ${active} AND o.state='completed' AND o.completed_at IS NOT NULL AND o.admission_blocked_at IS NULL
    AND e.cancelled_at IS NULL AND e.suspended_at IS NULL AND o.currency='KZT'
    AND NOT EXISTS (SELECT 1 FROM refunds r JOIN payment_attempts payment ON payment.id=r.payment_attempt_id WHERE payment.purpose='ticket_order' AND payment.subject_id=o.id)
    AND (o.total_minor=0 OR EXISTS (SELECT 1 FROM reservations reservation JOIN payment_attempts payment ON payment.id=reservation.payment_attempt_id
      WHERE reservation.order_id=o.id AND payment.purpose='ticket_order' AND payment.subject_id=o.id AND payment.state='succeeded'
        AND payment.succeeded_at IS NOT NULL AND payment.amount_minor=o.total_minor AND payment.currency='KZT'))`

async function ticketPage(
  db: D1Database,
  source: Source,
  cursor: Cursor | null
): Promise<Page> {
  if (cursor && cursor.mode !== "tickets") return terminal("invalid")
  const row = await db
    .prepare(completedOrderQuery)
    .bind(source.entity_id)
    .first<Recipient>()
  if (!row || !validRecipient(row)) return terminal("ineligible")
  const count = await db
    .prepare(
      `SELECT count(*) n,sum(CASE WHEN state NOT IN ('valid','checked_in') THEN 1 ELSE 0 END) invalid FROM tickets WHERE event_id=? AND order_id=?`
    )
    .bind(row.event_id, row.entity_id)
    .first<{ n: number; invalid: number | null }>()
  if (
    !count ||
    count.n < 1 ||
    count.n > 100_000 ||
    count.invalid ||
    (cursor && cursor.total !== count.n)
  )
    return terminal("ineligible")
  const after = cursor?.after ?? "",
    part = cursor?.part ?? 0
  if (part * 6 >= count.n) return terminal("invalid")
  const ids = (
    await db
      .prepare(
        "SELECT id FROM tickets WHERE event_id=? AND order_id=? AND id>? ORDER BY id LIMIT 120"
      )
      .bind(row.event_id, row.entity_id, after)
      .all<{ id: string }>()
  ).results.map((ticket) => ticket.id)
  if (ids.length !== Math.min(120, count.n - part * 6))
    throw new Error("Notification ticket page changed")
  const jobs: Job[] = []
  for (let index = 0; index < ids.length; index += 6) {
    const ticketIds = ids.slice(index, index + 6),
      number = part + index / 6 + 1
    const guard = queryGuard(completedOrderQuery, [source.entity_id], row)
    jobs.push({
      ...row,
      kind: "order.tickets",
      part: String(number),
      metadata: { ticketIds, part: number, parts: Math.ceil(count.n / 6) },
      guard,
    })
  }
  const done = part * 6 + ids.length === count.n
  return {
    jobs,
    cursor: done
      ? { mode: "done", reason: "complete" }
      : {
          mode: "tickets",
          after: ids.at(-1)!,
          part: part + jobs.length,
          total: count.n,
        },
    complete: done,
    guard: {
      sql: `(SELECT count(*) FROM tickets WHERE event_id=? AND order_id=?)=?
      AND NOT EXISTS (SELECT 1 FROM tickets WHERE event_id=? AND order_id=? AND state NOT IN ('valid','checked_in'))
      AND (SELECT count(*) FROM tickets WHERE event_id=? AND order_id=? AND id<=?)=?
      AND (SELECT json_group_array(id) FROM (SELECT id FROM tickets WHERE event_id=? AND order_id=? AND id>? ORDER BY id LIMIT 120))=?`,
      values: [
        row.event_id,
        row.entity_id,
        count.n,
        row.event_id,
        row.entity_id,
        row.event_id,
        row.entity_id,
        after,
        part * 6,
        row.event_id,
        row.entity_id,
        after,
        JSON.stringify(ids),
      ],
    },
  }
}

function eventGuard(
  eventId: string,
  kind: string,
  revision: number
): Predicate {
  return {
    sql: `EXISTS (SELECT 1 FROM events e WHERE e.id=? AND e.revision>=? AND ${kind === "event.cancelled" ? "e.cancelled_at IS NOT NULL" : "e.cancelled_at IS NULL AND e.suspended_at IS NULL"})
    AND NOT EXISTS (SELECT 1 FROM outbox later WHERE later.kind='event.changed' AND later.entity_id=? AND json_valid(later.payload_json)
      AND json_extract(later.payload_json,'$.action') IN ('event.updated','event.cancelled') AND json_extract(later.payload_json,'$.revision')>?)`,
    values: [eventId, revision, eventId, revision],
  }
}
async function eventPage(
  db: D1Database,
  source: Source,
  data: Record<string, unknown>,
  cursor: Cursor | null
): Promise<Page> {
  if (cursor && cursor.mode !== "orders") return terminal("invalid")
  const kind = data.action as string
  if (!["event.updated", "event.cancelled"].includes(kind))
    return terminal("ineligible")
  if (data.eventId !== source.entity_id || data.resourceId !== source.entity_id)
    return terminal("invalid")
  const state = eventGuard(source.entity_id, kind, data.revision as number)
  if (
    !(await db
      .prepare(`SELECT 1 WHERE ${state.sql}`)
      .bind(...state.values)
      .first())
  )
    return terminal("ineligible")
  // Page canonical order rows before filtering accounts. An inactive page still advances to later buyers.
  const rows = (
    await db
      .prepare(`SELECT o.id entity_id,o.event_id,o.account_id recipient_id,u.email,o.completed_at
    FROM orders o JOIN user u ON u.id=o.account_id WHERE o.event_id=? AND o.completed_at IS NOT NULL AND o.completed_at<=?
      AND (o.completed_at>? OR (o.completed_at=? AND o.id>?)) ORDER BY o.completed_at,o.id LIMIT 20`)
      .bind(
        source.entity_id,
        source.created_at,
        cursor?.at ?? -1,
        cursor?.at ?? -1,
        cursor?.id ?? ""
      )
      .all<Recipient & { completed_at: number }>()
  ).results
  const jobs = rows.filter(validRecipient).map((row) => {
    const orderCondition =
      kind === "event.updated"
        ? "AND o.state='completed' AND o.admission_blocked_at IS NULL"
        : ""
    return empty({ ...row, entity_id: source.entity_id }, kind, {
      sql: `${state.sql} AND EXISTS (SELECT 1 FROM orders o JOIN user u ON u.id=o.account_id LEFT JOIN profiles p ON p.user_id=u.id
      WHERE o.id=? AND o.event_id=? AND o.account_id=? AND u.email=? AND ${active} AND o.completed_at IS NOT NULL AND o.completed_at<=? ${orderCondition})`,
      values: [
        ...state.values,
        row.entity_id,
        source.entity_id,
        row.recipient_id,
        row.email,
        source.created_at,
      ],
    })
  })
  const last = rows.at(-1)
  return {
    jobs,
    cursor: last
      ? { mode: "orders", at: last.completed_at, id: last.entity_id }
      : { mode: "done", reason: "complete" },
    complete: rows.length < 20,
  }
}

async function supportPage(
  db: D1Database,
  source: Source,
  data: Record<string, unknown>,
  cursor: Cursor | null
): Promise<Page> {
  if (cursor && cursor.mode !== "recipients") return terminal("invalid")
  if (data.caseId !== source.entity_id) return terminal("invalid")
  const canonicalQuery = `SELECT c.id,c.event_id,c.assignee_id,c.requester_id,c.revision,c.audience,change.actor_id,change.kind,
    (${currentSupportAssigneeSql()}) assigned FROM support_cases c JOIN support_case_changes change ON change.case_id=c.id
    WHERE c.id=? AND change.id=? AND change.sequence=?`
  const args = [source.entity_id, data.changeId, data.sequence]
  const current = await db
    .prepare(canonicalQuery)
    .bind(...args)
    .first<{
      id: string
      event_id: string | null
      assignee_id: string | null
      requester_id: string
      revision: number
      audience: string
      actor_id: string
      kind: string
      assigned: number
    }>()
  if (!current) return terminal("ineligible")
  const selection = await deliveryDigest(JSON.stringify(current))
  const after = cursor?.selection === selection ? cursor.after : ""
  // Each indexed grant branch contributes at most twenty keys. Keep revoked candidates in
  // the raw page so an empty authorized page still advances. json_each keeps D1's compound
  // SELECT count at five while reading only the requester and assignee values.
  const rows = (
    await db
      .prepare(`WITH candidates(recipient_id) AS (
    SELECT participant.value FROM support_cases c,json_each(json_array(c.requester_id,c.assignee_id)) participant WHERE c.id=? AND participant.value IS NOT NULL
    UNION SELECT e.organizer_id FROM support_cases c JOIN events e ON e.id=c.event_id WHERE c.id=? AND c.audience='attendee'
    UNION SELECT user_id FROM (SELECT ep.user_id FROM support_cases c JOIN event_permissions ep ON ep.event_id=c.event_id
      WHERE c.id=? AND c.audience='attendee' AND ep.permission='support:manage' AND ep.user_id>? ORDER BY ep.user_id LIMIT 20)
    UNION SELECT user_id FROM (SELECT user_id FROM platform_grants WHERE permission='platform:support' AND user_id>? ORDER BY user_id LIMIT 20)
    UNION SELECT user_id FROM (SELECT user_id FROM platform_grants WHERE permission='platform:moderate' AND user_id>? ORDER BY user_id LIMIT 20)
  ) SELECT recipient_id,u.email FROM candidates ${accountJoins} WHERE recipient_id>? ORDER BY recipient_id LIMIT 20`)
      .bind(
        source.entity_id,
        source.entity_id,
        source.entity_id,
        after,
        after,
        after,
        after
      )
      .all<{ recipient_id: string; email: string }>()
  ).results
  const jobs = rows
    .map((candidate) => ({
      ...candidate,
      event_id: current.event_id,
      entity_id: current.id,
    }))
    .filter(validRecipient)
    .map((row) =>
      empty(
        row,
        "support.changed",
        {
          sql: `EXISTS (SELECT 1 FROM support_cases c JOIN support_case_changes change ON change.case_id=c.id JOIN user u ON u.id=?
      WHERE c.id=? AND change.id=? AND change.sequence=? AND u.email=? AND change.actor_id<>u.id
        AND ${supportAccessExpression("c")}
        AND (c.requester_id=u.id OR c.assignee_id=u.id OR NOT (${currentSupportAssigneeSql()})))`,
          values: [
            row.recipient_id,
            current.id,
            data.changeId,
            data.sequence,
            row.email,
            row.recipient_id,
          ],
        },
        { changeId: data.changeId }
      )
    )
  const last = rows.at(-1)
  return {
    jobs,
    cursor: last
      ? { mode: "recipients", after: last.recipient_id, selection }
      : { mode: "done", reason: "complete" },
    complete: rows.length < 20,
    guard: {
      sql: `EXISTS (SELECT 1 FROM (${canonicalQuery}) selected WHERE selected.revision=? AND selected.assigned=? AND selected.assignee_id IS ?)`,
      values: [
        ...args,
        current.revision,
        current.assigned,
        current.assignee_id,
      ],
    },
  }
}

async function financialPage(
  db: D1Database,
  source: Source,
  data: Record<string, unknown>
): Promise<Page> {
  const ownership = `((payment.purpose='ticket_order' AND o.id=payment.subject_id AND o.account_id=payment.actor_id AND o.event_id=e.id)
    OR (payment.purpose='event_activation' AND payment.subject_id=e.id AND e.organizer_id=payment.actor_id))`
  const joins = `JOIN events e ON e.id=CASE WHEN payment.purpose='ticket_order' THEN o.event_id ELSE payment.subject_id END
    JOIN user u ON u.id=payment.actor_id LEFT JOIN profiles p ON p.user_id=u.id`
  if (source.kind === "payment.failed") {
    if (data.paymentAttemptId !== source.entity_id) return terminal("invalid")
    return single(
      db,
      `SELECT payment.id entity_id,e.id event_id,payment.actor_id recipient_id,u.email FROM payment_attempts payment
      LEFT JOIN orders o ON payment.purpose='ticket_order' AND o.id=payment.subject_id ${joins}
      WHERE payment.id=? AND payment.currency='KZT' AND payment.state='failed' AND payment.succeeded_at IS NULL AND ${active} AND ${ownership}
        AND (payment.purpose<>'ticket_order' OR o.completed_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM payment_attempts success WHERE success.purpose=payment.purpose AND success.subject_id=payment.subject_id AND success.state='succeeded')`,
      [source.entity_id],
      "payment.failed"
    )
  }
  if (source.kind === "activation.completed") {
    if (data.eventId !== source.entity_id) return terminal("invalid")
    return single(
      db,
      `SELECT payment.id entity_id,e.id event_id,payment.actor_id recipient_id,u.email FROM payment_attempts payment
      JOIN events e ON e.id=payment.subject_id JOIN event_activations activation ON activation.event_id=e.id AND activation.successful_payment_attempt_id=payment.id
      JOIN user u ON u.id=payment.actor_id LEFT JOIN profiles p ON p.user_id=u.id WHERE e.id=? AND payment.id=? AND ${active}
        AND payment.purpose='event_activation' AND payment.state='succeeded' AND payment.succeeded_at IS NOT NULL AND payment.currency='KZT' AND payment.last_error_code IS NULL
        AND e.organizer_id=payment.actor_id AND e.paid_sales_state='active' AND e.cancelled_at IS NULL AND e.suspended_at IS NULL
        AND activation.activated_at IS NOT NULL AND activation.suspended_at IS NULL AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.payment_attempt_id=payment.id)`,
      [source.entity_id, data.paymentAttemptId],
      "activation.completed"
    )
  }
  if (source.kind === "refund.changed") {
    if (data.refundId !== source.entity_id) return terminal("invalid")
    if (data.state !== "succeeded") return terminal("ineligible")
    return single(
      db,
      `SELECT r.id entity_id,e.id event_id,payment.actor_id recipient_id,u.email FROM refunds r JOIN payment_attempts payment ON payment.id=r.payment_attempt_id
      LEFT JOIN orders o ON payment.purpose='ticket_order' AND o.id=payment.subject_id ${joins}
      WHERE r.id=? AND payment.id=? AND r.state='succeeded' AND r.confirmed_at IS NOT NULL AND r.amount_minor=payment.amount_minor
        AND payment.currency='KZT' AND payment.state='succeeded' AND payment.succeeded_at IS NOT NULL AND ${active} AND ${ownership}`,
      [source.entity_id, data.paymentAttemptId],
      "refund.completed"
    )
  }
  const adjustment = source.kind === "payout.adjusted"
  if (!adjustment && data.payoutId !== source.entity_id)
    return terminal("invalid")
  return single(
    db,
    `SELECT payout.id entity_id,payout.event_id,payout.organizer_id recipient_id,u.email FROM simulated_payouts payout
    JOIN events e ON e.id=payout.event_id JOIN user u ON u.id=payout.organizer_id LEFT JOIN profiles p ON p.user_id=u.id
    ${adjustment ? "JOIN simulated_payout_items item ON item.payout_id=payout.id JOIN simulated_payout_adjustments adjustment ON adjustment.payout_item_id=item.id JOIN refunds r ON r.id=adjustment.refund_id" : ""}
    WHERE payout.id=? AND payout.event_id=? AND payout.currency='KZT' AND e.organizer_id=payout.organizer_id AND ${active}
    ${adjustment ? "AND adjustment.id=? AND adjustment.refund_id=? AND adjustment.amount_minor<=0 AND r.state='succeeded'" : "AND payout.amount_minor>=0"}`,
    [
      data.payoutId,
      data.eventId,
      ...(adjustment ? [source.entity_id, data.refundId] : []),
    ],
    "payout.status",
    adjustment ? { adjustmentId: source.entity_id } : {}
  )
}

async function nextPage(
  db: D1Database,
  source: Source,
  cursor: Cursor | null
): Promise<Page> {
  const data = payload(source)
  if (!data) return terminal("invalid")
  if (source.kind === "order.completed")
    return data.orderId === source.entity_id
      ? ticketPage(db, source, cursor)
      : terminal("invalid")
  if (source.kind === "event.changed")
    return eventPage(db, source, data, cursor)
  if (source.kind === "support.notify")
    return supportPage(db, source, data, cursor)
  if (cursor) return terminal("invalid")
  if (source.kind === "registration.cancelled") {
    if (data.orderId !== source.entity_id) return terminal("invalid")
    return single(
      db,
      `SELECT o.id entity_id,o.event_id,o.account_id recipient_id,u.email FROM orders o JOIN user u ON u.id=o.account_id LEFT JOIN profiles p ON p.user_id=u.id
      WHERE o.id=? AND o.state='cancelled' AND o.completed_at IS NOT NULL AND o.total_minor=0 AND ${active}`,
      [source.entity_id],
      "order.cancelled"
    )
  }
  return financialPage(db, source, data)
}

/** Queue only a bounded page of source jobs. Canonical business records never depend on email delivery. */
export async function dispatchNotificationOutbox(
  env: Pick<Bindings, "DB" | "DELIVERY">,
  now = Date.now()
): Promise<void> {
  const pending = (
    await env.DB.prepare(
      `SELECT id FROM outbox WHERE kind IN (${sourceKindsSql}) AND completed_at IS NULL AND next_attempt_at<=? ORDER BY next_attempt_at,id LIMIT 20`
    )
      .bind(now)
      .all<{ id: string }>()
  ).results
  for (const source of pending) {
    try {
      await env.DELIVERY.send({ id: source.id })
      await env.DB.prepare(
        "UPDATE outbox SET dispatched_at=?,next_attempt_at=? WHERE id=? AND completed_at IS NULL"
      )
        .bind(now, now + 60_000, source.id)
        .run()
    } catch {
      /* The committed source remains eligible for the next scheduled dispatch. */
    }
  }
}

/** A source cursor and at most twenty delivery parts commit in the same D1 transaction. */
export async function consumeNotificationOutbox(
  env: Pick<Bindings, "DB">,
  outboxId: string,
  dependencies: NotificationFanoutDependencies = {}
): Promise<boolean> {
  const db = env.DB,
    now = dependencies.now ?? Date.now
  const source = await db
    .prepare(
      "SELECT id,kind,entity_id,payload_json,created_at,completed_at,attempts FROM outbox WHERE id=?"
    )
    .bind(outboxId)
    .first<Source>()
  if (!source || !sourceKinds.includes(source.kind)) return false
  if (source.completed_at !== null) return true
  try {
    const stored = await db
      .prepare(
        "SELECT cursor,completed_at FROM delivery_fanout WHERE source_id=?"
      )
      .bind(source.id)
      .first<{ cursor: string; completed_at: number | null }>()
    const previous = stored?.cursor ?? ""
    let cursor: Cursor | null = null
    if (previous) cursor = cursorSchema.parse(JSON.parse(previous))
    const page =
      stored?.completed_at !== null && stored?.completed_at !== undefined
        ? terminal("complete")
        : await nextPage(db, source, cursor)
    for (const job of page.jobs)
      job.id = `delivery_${await deliveryDigest(JSON.stringify([source.id, job.recipient_id, job.part]))}`
    await dependencies.beforeCommit?.()
    const at = now(),
      statements: D1PreparedStatement[] = [
        db
          .prepare(
            "INSERT INTO delivery_fanout (source_id,created_at) VALUES (?,?) ON CONFLICT(source_id) DO NOTHING"
          )
          .bind(source.id, at),
        ...assertSql(
          db,
          `EXISTS (SELECT 1 FROM outbox WHERE id=? AND kind=? AND entity_id=? AND payload_json=? AND created_at=? AND completed_at IS NULL)
        AND EXISTS (SELECT 1 FROM delivery_fanout WHERE source_id=? AND cursor=?)`,
          [
            source.id,
            source.kind,
            source.entity_id,
            source.payload_json,
            source.created_at,
            source.id,
            previous,
          ]
        ),
        ...(page.guard ? assertSql(db, page.guard.sql, page.guard.values) : []),
      ]
    for (const job of page.jobs) {
      statements.push(
        db
          .prepare(`INSERT INTO email_deliveries (id,source_id,kind,entity_id,event_id,recipient_id,part_key,metadata_json,pdf_state,next_attempt_at,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${job.guard.sql} ON CONFLICT(source_id,recipient_id,part_key) DO NOTHING`)
          .bind(
            job.id,
            source.id,
            job.kind,
            job.entity_id,
            job.event_id,
            job.recipient_id,
            job.part,
            JSON.stringify(job.metadata),
            job.kind === "order.tickets" ? "pending" : "not_required",
            at,
            at,
            at,
            ...job.guard.values
          )
      )
      statements.push(
        db
          .prepare(`INSERT INTO outbox (id,kind,entity_id,payload_json,created_at,next_attempt_at)
        SELECT ?,'email.send',id,json_object('deliveryId',id),?,? FROM email_deliveries WHERE id=?
        ON CONFLICT(id) DO NOTHING`)
          .bind(deliveryOutboxId(job.id!), at, at, job.id)
      )
    }
    statements.push(
      db
        .prepare(
          "UPDATE delivery_fanout SET cursor=?,completed_at=? WHERE source_id=?"
        )
        .bind(JSON.stringify(page.cursor), page.complete ? at : null, source.id)
    )
    statements.push(
      db
        .prepare(
          "UPDATE outbox SET completed_at=?,attempts=attempts+1,next_attempt_at=? WHERE id=? AND completed_at IS NULL"
        )
        .bind(page.complete ? at : null, at + 1000, source.id)
    )
    await db.batch(statements)
  } catch {
    // A failed transaction leaves its cursor and recipient jobs unchanged; only the source retry is rescheduled.
    await db
      .prepare(
        "UPDATE outbox SET attempts=attempts+1,next_attempt_at=? WHERE id=? AND completed_at IS NULL"
      )
      .bind(now() + 60_000, source.id)
      .run()
  }
  return true
}
