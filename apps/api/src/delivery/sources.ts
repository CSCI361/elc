import { z } from "zod"
import { HTTPException } from "hono/http-exception"
import type { Bindings } from "../env"
import { ApiFailure } from "../db/transitions"
import { TICKET_PDF_VERSION } from "../exports/pdf"
import { loadTicketPdfSource } from "../exports/ticket-data"
import { downloadTicketPdf } from "../exports/ticket-pdf"
import { supportAccessExpression } from "../support/guards"
import {
  emailLimits,
  EmailTransportError,
  freezeEmailRequest,
  type EmailPdfAttachment,
  type EmailRequest,
} from "./email"
import { deliveryDigest, type CurrentDelivery, type DeliveryRow } from "./jobs"
import {
  notificationLocale,
  renderNotification,
  type NotificationInput,
} from "./templates"

type Environment = Pick<
  Bindings,
  "DB" | "FILES" | "APP_ORIGIN" | "EMAIL_FROM" | "TICKET_ENCRYPTION_KEY"
>
type Source = {
  kind: string
  entity_id: string
  payload_json: string
  created_at: number
  email: string
  locale: string | null
}
type Event = {
  id: string
  organizer_id: string
  title: string
  cancelled_at: number | null
  suspended_at: number | null
  paid_sales_state: string
}
type Order = {
  id: string
  event_id: string
  account_id: string
  state: string
  completed_at: number | null
  admission_blocked_at: number | null
  total_minor: number
  currency: string
}
type Payment = {
  id: string
  purpose: "ticket_order" | "event_activation"
  subject_id: string
  actor_id: string | null
  state: string
  amount_minor: number
  currency: string
  succeeded_at: number | null
}
const identifier = z.string().min(1).max(128)
const emptyMetadata = z.strictObject({})
const ticketMetadata = z.strictObject({
  ticketIds: z.array(identifier).min(1).max(6),
  part: z.int().min(1),
  parts: z.int().min(1),
})
const supportMetadata = z.strictObject({ changeId: identifier })
const payoutMetadata = z.strictObject({ adjustmentId: identifier.optional() })
function object(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
type Canonical = {
  current: CurrentDelivery
  locale: ReturnType<typeof notificationLocale>
  text: ReturnType<typeof renderNotification>
  ticketIds: string[]
}
/** Assignment only routes notifications while its account still has staff authority. No SQL bindings. */
export const currentSupportAssigneeSql = (alias: "c" | "sc" = "c") =>
  supportAccessExpression(alias, "manage").replace(
    "support_actor.id = ?",
    `support_actor.id = ${alias}.assignee_id`
  )
const unavailable = () =>
  new EmailTransportError("INVALID_REQUEST", "retryable")

/** Load only canonical resources. Outbox payloads identify facts; they never supply recipients or text. */
export function createDeliverySources(
  env: Environment,
  { fontBytes }: { fontBytes: Uint8Array }
) {
  // Copy the caller's bytes so a mutable buffer cannot change a previously frozen renderer version.
  const font = new Uint8Array(fontBytes)
  const fontHash = crypto.subtle
    .digest("SHA-256", font)
    .then((bytes) =>
      Array.from(new Uint8Array(bytes), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("")
    )
  const db = env.DB
  const event = (id: string) =>
    db
      .prepare(
        "SELECT id,organizer_id,title,cancelled_at,suspended_at,paid_sales_state FROM events WHERE id=?"
      )
      .bind(id)
      .first<Event>()
  const order = (id: string) =>
    db
      .prepare(
        "SELECT id,event_id,account_id,state,completed_at,admission_blocked_at,total_minor,currency FROM orders WHERE id=?"
      )
      .bind(id)
      .first<Order>()
  const payment = (id: string) =>
    db
      .prepare(
        "SELECT id,purpose,subject_id,actor_id,state,amount_minor,currency,succeeded_at FROM payment_attempts WHERE id=?"
      )
      .bind(id)
      .first<Payment>()

  async function load(row: DeliveryRow): Promise<Canonical | null> {
    // Require the actual persisted delivery envelope, its canonical source and the current account.
    // A queue payload or a mutated copy of DeliveryRow cannot select a different resource or recipient.
    const source = await db
      .prepare(`SELECT o.kind,o.entity_id,o.payload_json,o.created_at,u.email,p.locale
      FROM email_deliveries d JOIN outbox o ON o.id=d.source_id
      JOIN user u ON u.id=d.recipient_id LEFT JOIN profiles p ON p.user_id=u.id
      WHERE d.id=? AND d.source_id=? AND d.kind=? AND d.entity_id=? AND d.event_id IS ?
        AND d.recipient_id=? AND d.part_key=? AND d.metadata_json=?
        AND u.email_verified=1 AND p.suspended_at IS NULL`)
      .bind(
        row.id,
        row.source_id,
        row.kind,
        row.entity_id,
        row.event_id,
        row.recipient_id,
        row.part_key,
        row.metadata_json
      )
      .first<Source>()
    if (!source || !z.email().max(254).safeParse(source.email).success)
      return null
    const payload = object(source.payload_json),
      metadata = object(row.metadata_json)
    if (!payload || !metadata) return null
    const locale = notificationLocale(source.locale)
    let input: NotificationInput | undefined
    let ticketIds: string[] = []
    let pdfVersions: unknown[] = []
    let authority: unknown
    const sourceMatches = (kind: string, id: string) =>
      source.kind === kind && source.entity_id === id
    const eventFields = (value: Event) => ({
      eventId: value.id,
      eventTitle: value.title,
    })
    const currentEvent = row.event_id ? await event(row.event_id) : null

    if (row.kind === "order.tickets") {
      const parsed = ticketMetadata.safeParse(metadata)
      if (
        !parsed.success ||
        !sourceMatches("order.completed", row.entity_id) ||
        payload.orderId !== row.entity_id
      )
        return null
      const selected = parsed.data,
        currentOrder = await order(row.entity_id)
      if (
        !currentOrder ||
        !currentEvent ||
        currentOrder.event_id !== currentEvent.id ||
        currentOrder.account_id !== row.recipient_id ||
        currentOrder.state !== "completed" ||
        currentOrder.completed_at === null ||
        currentOrder.admission_blocked_at !== null ||
        currentOrder.currency !== "KZT" ||
        currentEvent.cancelled_at !== null ||
        currentEvent.suspended_at !== null
      )
        return null
      const counts = await db
        .prepare(`SELECT COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN state NOT IN ('valid','checked_in') THEN 1 ELSE 0 END),0) AS invalid
        FROM tickets WHERE event_id=? AND order_id=?`)
        .bind(currentEvent.id, currentOrder.id)
        .first<{ total: number; invalid: number }>()
      if (
        !counts?.total ||
        counts.invalid ||
        selected.parts !== Math.ceil(counts.total / 6) ||
        selected.part > selected.parts
      )
        return null
      const tickets = (
        await db
          .prepare(
            `SELECT id,state FROM tickets WHERE event_id=? AND order_id=? ORDER BY id LIMIT 6 OFFSET ?`
          )
          .bind(currentEvent.id, currentOrder.id, (selected.part - 1) * 6)
          .all<{ id: string; state: string }>()
      ).results
      const canonicalIds = tickets.map((ticket) => ticket.id)
      if (JSON.stringify(canonicalIds) !== JSON.stringify(selected.ticketIds))
        return null
      if (
        await db
          .prepare(`SELECT 1 FROM refunds r JOIN payment_attempts p ON p.id=r.payment_attempt_id
        WHERE p.purpose='ticket_order' AND p.subject_id=?`)
          .bind(currentOrder.id)
          .first()
      )
        return null
      if (
        currentOrder.total_minor > 0 &&
        !(await db
          .prepare(`SELECT 1 FROM reservations r JOIN payment_attempts p ON p.id=r.payment_attempt_id
        WHERE r.order_id=? AND p.purpose='ticket_order' AND p.subject_id=r.order_id AND p.state='succeeded'
          AND p.succeeded_at IS NOT NULL AND p.amount_minor=? AND p.currency='KZT'`)
          .bind(currentOrder.id, currentOrder.total_minor)
          .first())
      )
        return null
      ticketIds = canonicalIds
      for (const ticketId of ticketIds) {
        const pdf = await loadTicketPdfSource(
          db,
          env.APP_ORIGIN,
          row.recipient_id,
          ticketId,
          locale
        )
        // Ciphertext is never included in the frozen message or log; changes still invalidate its PDF proof.
        pdfVersions.push({
          data: pdf.data,
          tokenHash: pdf.tokenHash,
          ciphertextHash: await deliveryDigest(pdf.ciphertext),
        })
      }
      authority = { order: currentOrder, ticketStates: tickets }
      input = {
        kind: row.kind,
        ...eventFields(currentEvent),
        orderId: currentOrder.id,
        amountMinor: currentOrder.total_minor,
        ticketCount: counts.total,
        attachmentCount: ticketIds.length,
        part: selected.part,
        parts: selected.parts,
      }
    } else if (
      row.kind === "payment.failed" ||
      row.kind === "activation.completed" ||
      row.kind === "refund.completed"
    ) {
      if (!emptyMetadata.safeParse(metadata).success || !currentEvent)
        return null
      let currentPayment: Payment | null
      let refund: {
        id: string
        payment_attempt_id: string
        state: string
        amount_minor: number
        confirmed_at: number | null
      } | null = null
      if (row.kind === "refund.completed") {
        if (
          !sourceMatches("refund.changed", row.entity_id) ||
          payload.refundId !== row.entity_id ||
          payload.state !== "succeeded"
        )
          return null
        refund = await db
          .prepare(
            "SELECT id,payment_attempt_id,state,amount_minor,confirmed_at FROM refunds WHERE id=?"
          )
          .bind(row.entity_id)
          .first()
        if (
          !refund ||
          refund.state !== "succeeded" ||
          refund.confirmed_at === null ||
          payload.paymentAttemptId !== refund.payment_attempt_id
        )
          return null
        currentPayment = await payment(refund.payment_attempt_id)
      } else currentPayment = await payment(row.entity_id)
      if (
        !currentPayment ||
        currentPayment.actor_id !== row.recipient_id ||
        currentPayment.currency !== "KZT"
      )
        return null
      const currentOrder =
        currentPayment.purpose === "ticket_order"
          ? await order(currentPayment.subject_id)
          : null
      if (
        currentPayment.purpose === "ticket_order"
          ? !currentOrder ||
            currentOrder.event_id !== currentEvent.id ||
            currentOrder.account_id !== row.recipient_id
          : currentPayment.subject_id !== currentEvent.id ||
            currentEvent.organizer_id !== row.recipient_id
      )
        return null
      if (row.kind === "payment.failed") {
        if (
          !sourceMatches("payment.failed", currentPayment.id) ||
          payload.paymentAttemptId !== currentPayment.id ||
          currentPayment.state !== "failed" ||
          currentPayment.succeeded_at !== null ||
          currentOrder?.completed_at != null
        )
          return null
        if (
          await db
            .prepare(
              "SELECT 1 FROM payment_attempts WHERE purpose=? AND subject_id=? AND state='succeeded'"
            )
            .bind(currentPayment.purpose, currentPayment.subject_id)
            .first()
        )
          return null
        input = {
          kind: row.kind,
          ...eventFields(currentEvent),
          paymentAttemptId: currentPayment.id,
          amountMinor: currentPayment.amount_minor,
        }
      } else if (row.kind === "activation.completed") {
        if (
          !sourceMatches("activation.completed", currentEvent.id) ||
          payload.eventId !== currentEvent.id ||
          payload.paymentAttemptId !== currentPayment.id ||
          currentPayment.purpose !== "event_activation" ||
          currentPayment.state !== "succeeded" ||
          currentPayment.succeeded_at === null ||
          currentEvent.paid_sales_state !== "active" ||
          currentEvent.cancelled_at !== null ||
          currentEvent.suspended_at !== null
        )
          return null
        if (
          !(await db
            .prepare(`SELECT 1 FROM event_activations a WHERE a.event_id=? AND a.successful_payment_attempt_id=?
          AND a.activated_at IS NOT NULL AND a.suspended_at IS NULL
          AND EXISTS (SELECT 1 FROM payment_attempts confirmed WHERE confirmed.id=a.successful_payment_attempt_id AND confirmed.last_error_code IS NULL)
          AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.payment_attempt_id=?)`)
            .bind(currentEvent.id, currentPayment.id, currentPayment.id)
            .first())
        )
          return null
        input = {
          kind: row.kind,
          ...eventFields(currentEvent),
          feeMinor: currentPayment.amount_minor,
        }
      } else {
        if (
          !refund ||
          currentPayment.state !== "succeeded" ||
          currentPayment.succeeded_at === null ||
          refund.amount_minor !== currentPayment.amount_minor
        )
          return null
        input = {
          kind: row.kind,
          ...eventFields(currentEvent),
          paymentAttemptId: currentPayment.id,
          amountMinor: refund.amount_minor,
        }
      }
      authority = { payment: currentPayment, order: currentOrder, refund }
    } else if (row.kind === "event.updated" || row.kind === "event.cancelled") {
      if (
        !emptyMetadata.safeParse(metadata).success ||
        !currentEvent ||
        currentEvent.id !== row.entity_id ||
        !sourceMatches("event.changed", currentEvent.id) ||
        payload.eventId !== currentEvent.id ||
        payload.resourceId !== currentEvent.id ||
        payload.action !== row.kind ||
        !Number.isSafeInteger(payload.revision)
      )
        return null
      if (
        row.kind === "event.updated"
          ? currentEvent.cancelled_at !== null ||
            currentEvent.suspended_at !== null
          : currentEvent.cancelled_at === null
      )
        return null
      if (
        await db
          .prepare(`SELECT 1 FROM outbox WHERE kind='event.changed' AND entity_id=? AND json_valid(payload_json)
        AND json_extract(payload_json,'$.action') IN ('event.updated','event.cancelled') AND json_extract(payload_json,'$.revision')>?`)
          .bind(currentEvent.id, payload.revision)
          .first()
      )
        return null
      const relevant = await db
        .prepare(`SELECT id FROM orders WHERE event_id=? AND account_id=? AND completed_at IS NOT NULL AND completed_at<=?
        ${row.kind === "event.updated" ? "AND state='completed' AND admission_blocked_at IS NULL" : ""} ORDER BY id LIMIT 1`)
        .bind(currentEvent.id, row.recipient_id, source.created_at)
        .first<{ id: string }>()
      if (!relevant) return null
      authority = {
        orderId: relevant.id,
        cancelledAt: currentEvent.cancelled_at,
      }
      input = { kind: row.kind, ...eventFields(currentEvent) }
    } else if (row.kind === "payout.status") {
      const parsed = payoutMetadata.safeParse(metadata)
      if (
        !parsed.success ||
        !currentEvent ||
        currentEvent.organizer_id !== row.recipient_id
      )
        return null
      const payout = await db
        .prepare(
          "SELECT id,event_id,organizer_id,amount_minor,currency FROM simulated_payouts WHERE id=?"
        )
        .bind(row.entity_id)
        .first<{
          id: string
          event_id: string
          organizer_id: string
          amount_minor: number
          currency: string
        }>()
      if (
        !payout ||
        payout.event_id !== currentEvent.id ||
        payout.organizer_id !== row.recipient_id ||
        payout.currency !== "KZT" ||
        payload.payoutId !== payout.id ||
        payload.eventId !== currentEvent.id ||
        payload.simulation !== true
      )
        return null
      const adjustmentId = parsed.data.adjustmentId
      if (adjustmentId) {
        if (!sourceMatches("payout.adjusted", adjustmentId)) return null
        const adjustment = await db
          .prepare(`SELECT a.id,a.amount_minor,a.refund_id FROM simulated_payout_adjustments a
          JOIN simulated_payout_items i ON i.id=a.payout_item_id JOIN refunds r ON r.id=a.refund_id
          WHERE a.id=? AND i.payout_id=? AND r.state='succeeded' AND r.confirmed_at IS NOT NULL`)
          .bind(adjustmentId, payout.id)
          .first<{ id: string; amount_minor: number; refund_id: string }>()
        if (!adjustment || payload.refundId !== adjustment.refund_id)
          return null
        input = {
          kind: row.kind,
          ...eventFields(currentEvent),
          status: "adjusted",
          amountMinor: adjustment.amount_minor,
        }
        authority = { payout, adjustment }
      } else {
        if (!sourceMatches("payout.simulated", payout.id)) return null
        input = {
          kind: row.kind,
          ...eventFields(currentEvent),
          status: "completed",
          amountMinor: payout.amount_minor,
        }
        authority = payout
      }
    } else if (row.kind === "support.changed") {
      const parsed = supportMetadata.safeParse(metadata)
      if (
        !parsed.success ||
        !sourceMatches("support.notify", row.entity_id) ||
        payload.caseId !== row.entity_id ||
        payload.changeId !== parsed.data.changeId
      )
        return null
      const support = await db
        .prepare(`SELECT c.id,c.event_id,c.requester_id,c.assignee_id,c.status,c.last_sequence,
        change.id AS change_id,change.actor_id,change.kind,change.sequence,change.after_json
        FROM support_cases c JOIN support_case_changes change ON change.case_id=c.id AND change.id=?
        WHERE c.id=? AND c.event_id IS ? AND ${supportAccessExpression("c")}
          AND change.actor_id<>? AND (c.requester_id=? OR c.assignee_id=? OR NOT (${currentSupportAssigneeSql()}))`)
        .bind(
          parsed.data.changeId,
          row.entity_id,
          row.event_id,
          row.recipient_id,
          row.recipient_id,
          row.recipient_id,
          row.recipient_id
        )
        .first<{
          id: string
          event_id: string | null
          requester_id: string
          assignee_id: string | null
          status: "open" | "in_progress" | "waiting_for_customer" | "resolved"
          last_sequence: number
          change_id: string
          actor_id: string
          kind: "created" | "message" | "assignment" | "status"
          sequence: number
          after_json: string
        }>()
      if (!support || payload.sequence !== support.sequence) return null
      const after = object(support.after_json)
      if (
        !after ||
        (support.kind === "status" && after.status !== support.status) ||
        (support.kind === "assignment" &&
          after.assigneeId !== support.assignee_id)
      )
        return null
      input = {
        kind: row.kind,
        caseId: support.id,
        action: support.kind,
        ...(support.kind === "status" ? { status: support.status } : {}),
      }
      authority = support
    } else if (row.kind === "order.cancelled") {
      if (
        !emptyMetadata.safeParse(metadata).success ||
        !currentEvent ||
        !sourceMatches("registration.cancelled", row.entity_id) ||
        payload.orderId !== row.entity_id
      )
        return null
      const currentOrder = await order(row.entity_id)
      if (
        !currentOrder ||
        currentOrder.event_id !== currentEvent.id ||
        currentOrder.account_id !== row.recipient_id ||
        currentOrder.state !== "cancelled" ||
        currentOrder.total_minor !== 0 ||
        currentOrder.completed_at === null ||
        currentOrder.admission_blocked_at === null
      )
        return null
      input = {
        kind: row.kind,
        ...eventFields(currentEvent),
        orderId: currentOrder.id,
      }
      authority = currentOrder
    } else return null
    if (!input) return null
    const text = renderNotification(input, {
      appOrigin: env.APP_ORIGIN,
      locale,
    })
    const version = await deliveryDigest(
      JSON.stringify({
        schema: "canonical-email-v1",
        delivery: {
          id: row.id,
          sourceId: row.source_id,
          kind: row.kind,
          entityId: row.entity_id,
          eventId: row.event_id,
          recipientId: row.recipient_id,
          partKey: row.part_key,
          metadata,
        },
        from: env.EMAIL_FROM,
        recipient: source.email,
        locale,
        appOrigin: env.APP_ORIGIN,
        text,
        authority,
        pdf: ticketIds.length
          ? {
              renderer: TICKET_PDF_VERSION,
              font: await fontHash,
              sources: pdfVersions,
            }
          : null,
      })
    )
    return {
      current: { version, recipient: source.email },
      locale,
      text,
      ticketIds,
    }
  }

  async function readCurrent(
    row: DeliveryRow
  ): Promise<CurrentDelivery | null> {
    try {
      return (await load(row))?.current ?? null
    } catch (error) {
      if (
        (error instanceof ApiFailure || error instanceof HTTPException) &&
        [401, 403, 404].includes(error.status)
      )
        return null
      throw error
    }
  }
  async function prepare(
    row: DeliveryRow,
    current: CurrentDelivery
  ): Promise<EmailRequest> {
    const canonical = await load(row)
    if (
      !canonical ||
      canonical.current.version !== current.version ||
      canonical.current.recipient !== current.recipient
    )
      throw unavailable()
    const attachments: EmailPdfAttachment[] = []
    for (const [index, ticketId] of canonical.ticketIds.entries()) {
      const response = await downloadTicketPdf(
        env,
        row.recipient_id,
        ticketId,
        canonical.locale,
        font
      )
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > emailLimits.attachmentDecodedBytes)
        throw new EmailTransportError("INVALID_REQUEST", "permanent")
      // Chunk conversion avoids spreading a multi-megabyte buffer onto the Worker stack.
      let binary = ""
      for (let offset = 0; offset < bytes.length; offset += 16384)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384))
      attachments.push({
        filename: `elc-ticket-${index + 1}-${canonical.locale}.pdf`,
        content: btoa(binary),
      })
    }
    const final = await readCurrent(row)
    if (
      !final ||
      final.version !== current.version ||
      final.recipient !== current.recipient
    )
      throw unavailable()
    return freezeEmailRequest({
      deliveryId: row.id,
      idempotencyKey: `elc-email/${row.id}`,
      from: env.EMAIL_FROM,
      to: current.recipient,
      ...canonical.text,
      attachments,
    })
  }
  return { readCurrent, prepare }
}
