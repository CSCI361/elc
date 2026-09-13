import { z } from "zod"
import {
  organizerAnalyticsOverviewQuerySchema,
  organizerAnalyticsOverviewResponseSchema,
} from "@elc/shared"
import { ApiFailure, requestHash } from "../db/transitions"
import { activeAccountSql } from "../events/store"
import { reportingPeriod } from "./dates"
import { reportAccess } from "./sql"

const zone = "Asia/Almaty" as const
/** Candidate indexes reduce the scope scan; reportAccess still checks current authority in every statement. */
export const overviewContext = `WITH filters AS (SELECT ? actor,? q,? starts,? ends,? at),
  candidate_ids AS (
    SELECT id FROM events WHERE organizer_id=(SELECT actor FROM filters)
    UNION SELECT event_id FROM event_permissions WHERE user_id=(SELECT actor FROM filters)
      AND permission='analytics:read' AND revoked_at IS NULL
  ), authorized_events AS MATERIALIZED (
    SELECT e.* FROM candidate_ids candidate JOIN events e ON e.id=candidate.id CROSS JOIN filters f
    WHERE ${reportAccess} AND instr(lower(e.title),lower(f.q))>0
  )`
const measures = [
  "completed_orders",
  "tickets_issued",
  "gross",
  "discount",
  "refunded_tickets",
  "refunded",
  "fee",
  "fee_reversed",
  "redemptions",
  "activation_fees",
  "activation_refunds",
  "compensation",
  "payout_count",
  "payout_amount",
  "adjustment_count",
  "adjustment_amount",
] as const
type Measure = (typeof measures)[number]
type MetricRow = Record<Measure, number>
function entry(
  event: string,
  at: string,
  values: Partial<Record<Measure, string>>,
  from: string
) {
  return `SELECT ${event} event_id,${at} recorded_at,${measures.map((key) => `${values[key] ?? "0"} ${key}`).join(",")} ${from}`
}
const quantity =
  "(SELECT COALESCE(SUM(item.quantity),0) FROM order_items item WHERE item.order_id=o.id)"
const refundFrom = `FROM filters f CROSS JOIN refunds r INDEXED BY refund_confirmation_reporting
  JOIN payment_attempts p ON p.id=r.payment_attempt_id AND p.purpose='ticket_order' JOIN orders o ON o.id=p.subject_id
  JOIN reservations reservation ON reservation.order_id=o.id AND reservation.payment_attempt_id=p.id
  JOIN authorized_events e ON e.id=o.event_id WHERE r.state='succeeded' AND r.confirmed_at>=f.starts AND r.confirmed_at<f.ends`
/** Whole-order snapshots retain the originally rounded fee; no ticket-type allocation is needed. */
const entryBranches = [
  entry(
    "e.id",
    "o.completed_at",
    {
      completed_orders: "1",
      tickets_issued: quantity,
      gross: "o.subtotal_minor",
      discount: "o.discount_minor",
      fee: "o.processing_fee_minor",
      redemptions:
        "EXISTS (SELECT 1 FROM promo_allocations a WHERE a.order_id=o.id AND a.campaign_id=o.campaign_id AND a.committed_at IS NOT NULL)",
    },
    `FROM authorized_events e CROSS JOIN filters f CROSS JOIN orders o INDEXED BY orders_reporting ON o.event_id=e.id WHERE o.completed_at>=f.starts AND o.completed_at<f.ends`
  ),
  entry(
    "e.id",
    "r.confirmed_at",
    {
      refunded_tickets: quantity,
      refunded: "o.total_minor",
      fee_reversed: "o.processing_fee_minor",
    },
    `${refundFrom} AND o.completed_at IS NOT NULL`
  ),
  entry(
    "e.id",
    "p.succeeded_at",
    { activation_fees: "p.amount_minor" },
    `FROM authorized_events e CROSS JOIN filters f JOIN payment_attempts p ON p.purpose='event_activation' AND p.subject_id=e.id
      WHERE p.state='succeeded' AND p.succeeded_at>=f.starts AND p.succeeded_at<f.ends`
  ),
  entry(
    "e.id",
    "r.confirmed_at",
    { activation_refunds: "r.amount_minor" },
    `FROM filters f CROSS JOIN refunds r INDEXED BY refund_confirmation_reporting JOIN payment_attempts p ON p.id=r.payment_attempt_id AND p.purpose='event_activation'
      JOIN authorized_events e ON e.id=p.subject_id WHERE r.state='succeeded' AND r.confirmed_at>=f.starts AND r.confirmed_at<f.ends`
  ),
  entry(
    "e.id",
    "r.confirmed_at",
    { compensation: "r.amount_minor" },
    `${refundFrom} AND o.completed_at IS NULL`
  ),
  entry(
    "e.id",
    "p.completed_at",
    { payout_count: "1", payout_amount: "p.amount_minor" },
    `FROM authorized_events e CROSS JOIN filters f JOIN simulated_payouts p ON p.event_id=e.id WHERE p.completed_at>=f.starts AND p.completed_at<f.ends`
  ),
  entry(
    "e.id",
    "a.created_at",
    { adjustment_count: "1", adjustment_amount: "a.amount_minor" },
    `FROM authorized_events e CROSS JOIN filters f JOIN simulated_payouts p ON p.event_id=e.id JOIN simulated_payout_items item ON item.payout_id=p.id
      JOIN simulated_payout_adjustments a ON a.payout_item_id=item.id WHERE a.created_at>=f.starts AND a.created_at<f.ends`
  ),
]
// D1 permits five compound SELECT terms. Keep each group and its final union within that limit.
const entries = `, ticket_and_activation_entries AS (${entryBranches.slice(0, 5).join(" UNION ALL ")}),
  payout_entries AS (${entryBranches.slice(5).join(" UNION ALL ")}),
  entries AS MATERIALIZED (SELECT * FROM ticket_and_activation_entries UNION ALL SELECT * FROM payout_entries)`
const selection = measures
  .map((key) => `COALESCE(SUM(entry.${key}),0) ${key}`)
  .join(",")
export const overviewMetricsSql = `${overviewContext}${entries} SELECT ${selection} FROM entries entry`
const currentNames = [
  "capacity",
  "enabled",
  "remaining",
  "reserved",
  "issued",
  "active_sold",
  "cancelled",
  "refunded",
  "eligible",
  "attendance",
  "unresolved_offline",
] as const
type CurrentRow = Record<(typeof currentNames)[number], number>
const eligible =
  "t.state IN ('valid','checked_in') AND o.state='completed' AND o.admission_blocked_at IS NULL AND e.cancelled_at IS NULL AND e.suspended_at IS NULL"
const currentEntries = `, inventory_counts AS (
    SELECT e.id,COUNT(*) enabled,
      SUM(CASE WHEN i.order_id IS NULL AND (r.id IS NULL OR r.state<>'active' OR r.expires_at<=f.at) THEN 1 ELSE 0 END) remaining,
      SUM(CASE WHEN i.order_id IS NULL AND r.state='active' AND r.expires_at>f.at THEN 1 ELSE 0 END) reserved
    FROM authorized_events e CROSS JOIN filters f JOIN inventory i ON i.event_id=e.id AND i.enabled=1
      LEFT JOIN reservations r ON r.id=i.reservation_id GROUP BY e.id
  ), ticket_counts AS (
    SELECT e.id,COUNT(*) issued,
      SUM(CASE WHEN t.state IN ('valid','checked_in') THEN 1 ELSE 0 END) active_sold,
      SUM(CASE WHEN t.state='cancelled' THEN 1 ELSE 0 END) cancelled,
      SUM(CASE WHEN t.state='refunded' THEN 1 ELSE 0 END) refunded,
      SUM(CASE WHEN ${eligible} THEN 1 ELSE 0 END) eligible,
      SUM(CASE WHEN ${eligible} AND EXISTS (SELECT 1 FROM checkins ci WHERE ci.ticket_id=t.id AND ci.reversed_at IS NULL) THEN 1 ELSE 0 END) attendance
    FROM authorized_events e CROSS JOIN tickets t INDEXED BY tickets_event_order ON t.event_id=e.id
      CROSS JOIN orders o ON o.id=t.order_id WHERE o.completed_at IS NOT NULL GROUP BY e.id
  ), offline_counts AS (
    SELECT e.id,COUNT(*) unresolved_offline FROM authorized_events e CROSS JOIN orders o INDEXED BY orders_reporting ON o.event_id=e.id
      CROSS JOIN offline_admission_reports report INDEXED BY offline_unresolved_order ON report.order_id=o.id AND report.review_state='unresolved'
      CROSS JOIN offline_operations op ON op.operation_id=report.operation_id AND op.event_id=e.id
      CROSS JOIN tickets t ON t.id=report.ticket_id AND t.event_id=e.id GROUP BY e.id
  ), current_events AS (
    SELECT e.id,e.capacity,${currentNames
      .slice(1)
      .map(
        (key) =>
          `COALESCE(${["enabled", "remaining", "reserved"].includes(key) ? "i" : key === "unresolved_offline" ? "off" : "t"}.${key},0) ${key}`
      )
      .join(",")}
    FROM authorized_events e LEFT JOIN inventory_counts i ON i.id=e.id LEFT JOIN ticket_counts t ON t.id=e.id LEFT JOIN offline_counts off ON off.id=e.id
  )`
export const overviewCurrentSql = `${overviewContext}${currentEntries} SELECT ${currentNames.map((key) => `COALESCE(SUM(${key}),0) ${key}`).join(",")} FROM current_events`
const cursorSchema = z.strictObject({
  id: z.string().min(1).max(128),
  filter: z.string().length(64),
})
function overflow(): never {
  throw new ApiFailure(
    "CONFLICT",
    409,
    "Report totals exceed safe integer precision. Narrow the date or event-title scope."
  )
}
function exact(value: number) {
  if (!Number.isSafeInteger(value)) overflow()
  return value
}
function sum(...values: number[]) {
  const result = values.reduce(
    (total, value) => total + BigInt(exact(value)),
    0n
  )
  if (
    result > BigInt(Number.MAX_SAFE_INTEGER) ||
    result < BigInt(Number.MIN_SAFE_INTEGER)
  )
    overflow()
  return Number(result)
}
function metrics(row: MetricRow) {
  for (const key of measures) exact(row[key])
  const net = sum(row.gross, -row.discount, -row.refunded)
  return {
    summary: {
      completedOrders: row.completed_orders,
      ticketsIssued: row.tickets_issued,
      grossMinor: row.gross,
      discountMinor: row.discount,
      refundedTickets: row.refunded_tickets,
      ticketRefundMinor: row.refunded,
      netTicketRevenueMinor: net,
      processingFeeMinor: row.fee,
      processingFeeReversalMinor: row.fee_reversed,
      estimatedPayoutMinor: sum(net, -row.fee, row.fee_reversed),
      committedRedemptions: row.redemptions,
    },
    otherPayments: {
      activationFeesMinor: row.activation_fees,
      activationRefundsMinor: row.activation_refunds,
      unfulfilledCompensationMinor: row.compensation,
      attendeeProcessingChargesMinor: 0 as const,
      refundedAttendeeChargesMinor: 0 as const,
    },
    payouts: {
      completedCount: row.payout_count,
      completedMinor: row.payout_amount,
      adjustmentCount: row.adjustment_count,
      adjustmentMinor: row.adjustment_amount,
      netMinor: sum(row.payout_amount, row.adjustment_amount),
    },
  }
}
function current(row: CurrentRow, at: number) {
  for (const key of currentNames) exact(row[key])
  return {
    asOf: new Date(at).toISOString(),
    capacity: row.capacity,
    enabledInventory: row.enabled,
    remainingInventory: row.remaining,
    reservedInventory: row.reserved,
    issuedTickets: row.issued,
    nonCancelledNonRefundedTickets: row.active_sold,
    cancelledTickets: row.cancelled,
    refundedTickets: row.refunded,
    soldPercent: row.capacity ? (row.active_sold / row.capacity) * 100 : 0,
    eligibleAttendance: row.eligible,
    confirmedAttendance: row.attendance,
    absent: sum(row.eligible, -row.attendance),
    attendancePercent: row.eligible ? (row.attendance / row.eligible) * 100 : 0,
    unresolvedOfflineReports: row.unresolved_offline,
    unsynchronizedOfflineCount: null,
  }
}

/** All aggregates cover the entire authorized scope. The cursor only limits the per-event table. */
export async function readOrganizerAnalytics(
  db: D1Database,
  actorId: string,
  raw: unknown = {},
  dependencies: { now?: () => number; beforeRead?: () => Promise<void> } = {}
) {
  const parsed = organizerAnalyticsOverviewQuerySchema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Choose valid overview dates, title filter and page size."
    )
  const query = parsed.data
  await dependencies.beforeRead?.()
  const now = (dependencies.now ?? Date.now)(),
    period = reportingPeriod(query, zone, now)
  const filter = await requestHash("analytics.overview", {
    actorId,
    q: query.q ?? "",
    start: period.start,
    end: period.end,
    timeZone: zone,
  })
  let after = ""
  if (query.cursor) {
    try {
      const cursor = cursorSchema.parse(JSON.parse(atob(query.cursor)))
      if (cursor.filter !== filter) throw new Error("different scope")
      after = cursor.id
    } catch {
      throw new ApiFailure(
        "INVALID_INPUT",
        400,
        "The event cursor belongs to another overview. Restart its first page."
      )
    }
  }
  const bindings = [
    actorId,
    query.q ?? "",
    period.startAt,
    period.endExclusive,
    now,
    actorId,
  ]
  const statement = (sql: string, ...values: unknown[]) =>
    db.prepare(sql).bind(...bindings, ...values)
  let results: D1Result[]
  try {
    results = await db.batch([
      statement(
        `${overviewContext} SELECT (${activeAccountSql}) allowed,(SELECT COUNT(*) FROM authorized_events) event_count`,
        actorId
      ),
      statement(overviewMetricsSql),
      statement(
        `${overviewContext}${entries}, days AS (SELECT json_extract(value,'$.date') date,json_extract(value,'$.start') starts,json_extract(value,'$.end') ends FROM json_each(?))
        SELECT day.date,${selection} FROM days day LEFT JOIN entries entry ON entry.recorded_at>=day.starts AND entry.recorded_at<day.ends GROUP BY day.date ORDER BY day.date`,
        JSON.stringify(period.days)
      ),
      statement(overviewCurrentSql),
      statement(
        `${overviewContext}${entries}${currentEntries}, page AS (SELECT * FROM authorized_events WHERE id>? ORDER BY id LIMIT ?)
        SELECT page.id,page.title,page.time_zone,page.reporting_id,page.starts_at,page.ends_at,
          ${currentNames.map((key) => `current.${key} current_${key}`).join(",")},${selection}
        FROM page LEFT JOIN entries entry ON entry.event_id=page.id JOIN current_events current ON current.id=page.id GROUP BY page.id ORDER BY page.id`,
        after,
        query.limit + 1
      ),
    ])
  } catch (error) {
    if (error instanceof Error && /integer overflow/i.test(error.message))
      overflow()
    throw error
  }
  const access = results[0]!.results[0] as {
    allowed: number
    event_count: number
  }
  if (!access.allowed)
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "A verified active account is required."
    )
  const rows = results[4]!.results as (MetricRow &
    Record<`current_${(typeof currentNames)[number]}`, number> & {
      id: string
      title: string
      time_zone: string
      reporting_id: string
      starts_at: number
      ends_at: number
    })[]
  const page = rows.slice(0, query.limit)
  return organizerAnalyticsOverviewResponseSchema.parse({
    timeZone: zone,
    currency: "KZT",
    simulation: true,
    generatedAt: new Date(now).toISOString(),
    scope: {
      eventCount: exact(access.event_count),
      q: query.q ?? "",
      basis: "all_currently_authorized_matching_events",
    },
    period: {
      start: period.start,
      end: period.end,
      dayCount: period.dayCount,
      startAt: new Date(period.startAt).toISOString(),
      endExclusiveAt: new Date(period.endExclusive).toISOString(),
      refundBasis: "confirmation_date",
      feeBasis: "frozen_order_fee",
      payoutBasis: "recorded_date",
    },
    ...metrics(results[1]!.results[0] as MetricRow),
    current: current(results[3]!.results[0] as CurrentRow, now),
    daily: (results[2]!.results as (MetricRow & { date: string })[]).map(
      (row) => ({ date: row.date, ...metrics(row) })
    ),
    events: page.map((row) => ({
      id: row.id,
      title: row.title,
      timeZone: row.time_zone,
      reportingId: row.reporting_id,
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: new Date(row.ends_at).toISOString(),
      reportHref: `/events/${encodeURIComponent(row.id)}/analytics`,
      ...metrics(row),
      current: current(
        Object.fromEntries(
          currentNames.map((key) => [key, row[`current_${key}`]])
        ) as CurrentRow,
        now
      ),
    })),
    nextCursor:
      rows.length > query.limit
        ? btoa(JSON.stringify({ id: page.at(-1)!.id, filter }))
        : null,
  })
}
