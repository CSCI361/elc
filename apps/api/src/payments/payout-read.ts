import {
  eventPayoutsResponseSchema,
  payoutListQuerySchema,
  policy,
} from "@elc/shared"
import { ApiFailure } from "../db/transitions"

/** Repeated in all statements of one D1 read transaction, including pagination. */
const access = `EXISTS (SELECT 1 FROM user actor LEFT JOIN profiles profile ON profile.user_id = actor.id
  WHERE actor.id = ? AND actor.email_verified = 1 AND profile.suspended_at IS NULL
  AND (e.organizer_id = actor.id OR EXISTS (SELECT 1 FROM event_permissions ep
    WHERE ep.event_id = e.id AND ep.user_id = actor.id AND ep.permission = 'analytics:read' AND ep.revoked_at IS NULL)))`

export async function readEventPayouts(
  db: D1Database,
  actorId: string,
  eventId: string,
  raw: unknown = {}
) {
  const query = payoutListQuerySchema.parse(raw)
  const separator = query.before?.indexOf(":") ?? -1
  const beforeTime = query.before
    ? Number(query.before.slice(0, separator))
    : Number.MAX_SAFE_INTEGER
  const beforeId = query.before?.slice(separator + 1) ?? "~"
  if (!Number.isSafeInteger(beforeTime))
    throw new ApiFailure("INVALID_INPUT", 400, "Invalid payout cursor.")
  const results = await db.batch([
    db
      .prepare(
        `SELECT e.ends_at, e.title, e.time_zone FROM events e WHERE e.id = ? AND ${access}`
      )
      .bind(eventId, actorId),
    db
      .prepare(`WITH contribution AS (
      SELECT o.total_minor paid, CASE WHEN r.state = 'succeeded' THEN o.total_minor ELSE 0 END refunded,
        CASE WHEN r.state = 'succeeded' THEN 0 ELSE o.processing_fee_minor END fee,
        CASE WHEN r.state = 'succeeded' THEN 0 ELSE o.total_minor - o.processing_fee_minor END net,
        CASE WHEN item.id IS NOT NULL THEN 1 ELSE 0 END already_paid,
        CASE WHEN e.ends_at + ${policy.payoutDelayMs} > CAST(unixepoch('subsecond') * 1000 AS INTEGER)
          OR r.id IS NOT NULL OR o.admission_blocked_at IS NOT NULL OR e.cancelled_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM support_cases sc WHERE sc.order_id = o.id AND sc.status <> 'resolved'
            AND sc.category IN ('refund','dispute','compensation')) THEN 1 ELSE 0 END held
      FROM orders o JOIN events e ON e.id = o.event_id
      JOIN reservations held ON held.order_id = o.id
      JOIN payment_attempts payment ON payment.id = held.payment_attempt_id AND payment.purpose = 'ticket_order'
        AND payment.subject_id = o.id AND payment.state = 'succeeded' AND payment.amount_minor = o.total_minor
        AND payment.currency = o.currency AND payment.actor_id = o.account_id
      LEFT JOIN refunds r ON r.payment_attempt_id = payment.id
      LEFT JOIN simulated_payout_items item ON item.order_id = o.id
      WHERE e.id = ? AND o.completed_at IS NOT NULL AND ${access}
    ) SELECT COALESCE(SUM(paid), 0) paid, COALESCE(SUM(refunded), 0) refunded, COALESCE(SUM(fee), 0) fee,
      COALESCE(SUM(net), 0) net, COALESCE(SUM(CASE WHEN already_paid = 0 THEN net ELSE 0 END), 0) outstanding,
      COALESCE(SUM(CASE WHEN already_paid = 0 AND held = 1 THEN net ELSE 0 END), 0) held,
      COALESCE(SUM(CASE WHEN already_paid = 0 AND held = 0 THEN net ELSE 0 END), 0) available
      FROM contribution`)
      .bind(eventId, actorId),
    db
      .prepare(`SELECT COALESCE(SUM(p.amount_minor),0) paid,
      COALESCE(SUM((SELECT SUM(a.amount_minor) FROM simulated_payout_items item
        JOIN simulated_payout_adjustments a ON a.payout_item_id = item.id WHERE item.payout_id = p.id)),0) adjustment
      FROM simulated_payouts p JOIN events e ON e.id = p.event_id WHERE e.id = ? AND ${access}`)
      .bind(eventId, actorId),
    db
      .prepare(`SELECT p.id, p.amount_minor, p.order_count, p.completed_at,
      (SELECT json_group_array(json_object('orderId', item.order_id, 'paidMinor', item.paid_minor,
        'processingFeeMinor', item.processing_fee_minor, 'contributionMinor', item.contribution_minor,
        'adjustment', CASE WHEN a.id IS NULL THEN NULL ELSE json_object('id', a.id, 'refundId', a.refund_id,
          'amountMinor', a.amount_minor, 'createdAt', a.created_at) END))
        FROM simulated_payout_items item LEFT JOIN simulated_payout_adjustments a ON a.payout_item_id = item.id
        WHERE item.payout_id = p.id) items_json
      FROM simulated_payouts p JOIN events e ON e.id = p.event_id WHERE e.id = ? AND ${access}
      AND (p.completed_at < ? OR (p.completed_at = ? AND p.id < ?))
      ORDER BY p.completed_at DESC, p.id DESC LIMIT ?`)
      .bind(
        eventId,
        actorId,
        beforeTime,
        beforeTime,
        beforeId,
        query.limit + 1
      ),
  ])
  const event = results[0]!.results[0] as
    | { ends_at: number; title: string; time_zone: string }
    | undefined
  if (!event)
    throw new ApiFailure("NOT_FOUND", 404, "Event financial report not found.")
  const totals = results[1]!.results[0] as Record<string, number>
  const ledger = results[2]!.results[0] as Record<string, number>
  const records = results[3]!.results as unknown as {
    id: string
    amount_minor: number
    order_count: number
    completed_at: number
    items_json: string
  }[]
  const page = records.slice(0, query.limit)
  const last = page.at(-1)
  return eventPayoutsResponseSchema.parse({
    eventId,
    eventTitle: event.title,
    timeZone: event.time_zone,
    simulation: true,
    currency: "KZT",
    eligibleAt: new Date(event.ends_at + policy.payoutDelayMs).toISOString(),
    summary: {
      completedPaymentsMinor: totals.paid,
      confirmedRefundsMinor: totals.refunded,
      remainingProcessingFeesMinor: totals.fee,
      estimatedContributionMinor: totals.net,
      simulatedPaidMinor: ledger.paid,
      adjustmentMinor: ledger.adjustment,
      outstandingMinor: totals.outstanding,
      heldMinor: totals.held,
      availableMinor: totals.available,
    },
    payouts: page.map((row) => ({
      id: row.id,
      amountMinor: row.amount_minor,
      orderCount: row.order_count,
      completedAt: new Date(row.completed_at).toISOString(),
      items: (
        JSON.parse(row.items_json) as {
          adjustment: { createdAt: number } | null
        }[]
      ).map((item) => ({
        ...item,
        adjustment: item.adjustment
          ? {
              ...item.adjustment,
              createdAt: new Date(item.adjustment.createdAt).toISOString(),
            }
          : null,
      })),
    })),
    nextCursor:
      records.length > query.limit && last
        ? `${last.completed_at}:${last.id}`
        : null,
  })
}
