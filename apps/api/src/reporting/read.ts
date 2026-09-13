import {
  eventAnalyticsQuerySchema,
  eventAnalyticsResponseSchema,
  salesMetricsSchema,
  type SalesMetrics,
} from "@elc/shared"
import { ApiFailure } from "../db/transitions"
import { reportingPeriod } from "./dates"
import {
  currentState,
  metricSelection,
  otherPayments,
  reportAccess,
  reportContext,
  salesEntries,
} from "./sql"

type MetricRow = {
  completed_orders: number
  tickets_issued: number
  gross: number
  discount: number
  refunded_tickets: number
  refunded: number
  fee: number
  fee_reversed: number
  redemptions: number
}
function metrics(row: MetricRow): SalesMetrics {
  const net = row.gross - row.discount - row.refunded
  return salesMetricsSchema.parse({
    completedOrders: row.completed_orders,
    ticketsIssued: row.tickets_issued,
    grossMinor: row.gross,
    discountMinor: row.discount,
    refundedTickets: row.refunded_tickets,
    ticketRefundMinor: row.refunded,
    netTicketRevenueMinor: net,
    processingFeeMinor: row.fee,
    processingFeeReversalMinor: row.fee_reversed,
    estimatedPayoutMinor: net - row.fee + row.fee_reversed,
    committedRedemptions: row.redemptions,
  })
}
type EventRow = {
  id: string
  title: string
  time_zone: string
  reporting_id: string
}

export async function readEventAnalytics(
  db: D1Database,
  actorId: string,
  eventId: string,
  raw: unknown = {},
  dependencies: { now?: () => number; beforeRead?: () => Promise<void> } = {}
) {
  const parsed = eventAnalyticsQuerySchema.safeParse(raw)
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Choose valid report dates, filters and page sizes."
    )
  const query = parsed.data
  const initial = await db
    .prepare(
      `SELECT e.id, e.time_zone FROM events e WHERE e.id = ? AND ${reportAccess}`
    )
    .bind(eventId, actorId)
    .first<{ id: string; time_zone: string }>()
  if (!initial)
    throw new ApiFailure("NOT_FOUND", 404, "Event report not found.")
  const now = (dependencies.now ?? Date.now)()
  const period = reportingPeriod(query, initial.time_zone, now)
  const bindings = [
    eventId,
    initial.time_zone,
    actorId,
    period.startAt,
    period.endExclusive,
    query.ticketTypeId ?? null,
  ]
  const statement = (sql: string, ...values: unknown[]) =>
    db.prepare(sql).bind(...bindings, ...values)
  await dependencies.beforeRead?.()
  const readAt = (dependencies.now ?? Date.now)()
  const results = await db.batch([
    statement(`${reportContext} SELECT e.id,e.title,e.time_zone,e.reporting_id FROM authorized_event e CROSS JOIN filters f
      WHERE f.type_id IS NULL OR EXISTS (SELECT 1 FROM ticket_types t WHERE t.event_id = e.id AND t.id = f.type_id)`),
    statement(currentState, readAt, readAt),
    statement(`${salesEntries} SELECT ${metricSelection} FROM entries entry`),
    statement(
      `${salesEntries}, days AS (SELECT json_extract(value,'$.date') date, json_extract(value,'$.start') starts,
      json_extract(value,'$.end') ends FROM json_each(?))
      SELECT day.date, ${metricSelection} FROM days day LEFT JOIN entries entry ON entry.recorded_at >= day.starts AND entry.recorded_at < day.ends
      GROUP BY day.date ORDER BY day.date`,
      JSON.stringify(period.days)
    ),
    statement(
      `${salesEntries}, page AS (SELECT t.id,t.name FROM authorized_event e JOIN ticket_types t ON t.event_id = e.id CROSS JOIN filters f
      WHERE t.id > ? AND (f.type_id IS NULL OR t.id = f.type_id) ORDER BY t.id LIMIT ?)
      SELECT page.id,page.name, ${metricSelection} FROM page LEFT JOIN entries entry ON entry.ticket_type_id = page.id
      GROUP BY page.id ORDER BY page.id`,
      query.typeAfter ?? "",
      query.limit + 1
    ),
    statement(
      `${salesEntries}, page AS (SELECT c.id,c.name,c.reporting_id FROM authorized_event e JOIN campaigns c ON c.event_id = e.id
      WHERE c.id > ? ORDER BY c.id LIMIT ?)
      SELECT page.id,page.name,page.reporting_id, ${metricSelection} FROM page LEFT JOIN entries entry ON entry.attributed_campaign = page.id
      GROUP BY page.id ORDER BY page.id`,
      query.campaignAfter ?? "",
      query.limit + 1
    ),
    statement(otherPayments),
  ])
  const event = results[0]!.results[0] as EventRow | undefined
  if (!event)
    throw new ApiFailure(
      "NOT_FOUND",
      404,
      "The report or its current access changed. Reload the event."
    )
  const current = results[1]!.results[0] as Record<string, number>
  const other = results[6]!.results[0] as Record<string, number>
  const types = results[4]!.results as (MetricRow & {
    id: string
    name: string
  })[]
  const campaigns = results[5]!.results as (MetricRow & {
    id: string
    name: string
    reporting_id: string
  })[]
  return eventAnalyticsResponseSchema.parse({
    eventId: event.id,
    eventTitle: event.title,
    reportingId: event.reporting_id,
    timeZone: event.time_zone,
    currency: "KZT",
    simulation: true,
    generatedAt: new Date(readAt).toISOString(),
    period: {
      start: period.start,
      end: period.end,
      dayCount: period.dayCount,
      startAt: new Date(period.startAt).toISOString(),
      endExclusiveAt: new Date(period.endExclusive).toISOString(),
      ticketTypeId: query.ticketTypeId ?? null,
      refundBasis: "confirmation_date",
      feeAllocation: "frozen_rate_largest_remainder",
    },
    current: {
      asOf: new Date(readAt).toISOString(),
      capacity: current.capacity,
      enabledInventory: current.enabled,
      remainingInventory: current.remaining,
      reservedInventory: current.reserved,
      issuedTickets: current.issued,
      nonCancelledNonRefundedTickets: current.active_sold,
      cancelledTickets: current.cancelled,
      refundedTickets: current.refunded,
      soldPercent: current.capacity
        ? (current.active_sold! * 100) / current.capacity
        : 0,
      eligibleAttendance: current.eligible,
      confirmedAttendance: current.attendance,
      absent: current.eligible! - current.attendance!,
      attendancePercent: current.eligible
        ? (current.attendance! * 100) / current.eligible
        : 0,
      unresolvedOfflineReports: current.unresolved_offline,
      unsynchronizedOfflineCount: null,
    },
    summary: metrics(results[2]!.results[0] as MetricRow),
    otherPayments: {
      scope: "event_all_ticket_types",
      activationFeesMinor: other.activation_fees,
      activationRefundsMinor: other.activation_refunds,
      unfulfilledCompensationMinor: other.compensation,
      attendeeProcessingChargesMinor: 0,
      refundedAttendeeChargesMinor: 0,
    },
    daily: (results[3]!.results as (MetricRow & { date: string })[]).map(
      (row) => ({ date: row.date, ...metrics(row) })
    ),
    ticketTypes: types
      .slice(0, query.limit)
      .map((row) => ({ id: row.id, name: row.name, ...metrics(row) })),
    campaigns: campaigns.slice(0, query.limit).map((row) => ({
      id: row.id,
      name: row.name,
      reportingId: row.reporting_id,
      ...metrics(row),
    })),
    nextTypeCursor:
      types.length > query.limit ? types[query.limit - 1]!.id : null,
    nextCampaignCursor:
      campaigns.length > query.limit ? campaigns[query.limit - 1]!.id : null,
  })
}
