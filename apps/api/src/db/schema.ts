import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import { user } from "./auth-schema"

export * from "./auth-schema"

export const profiles = sqliteTable("profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id),
  locale: text("locale", { enum: ["kk", "ru", "en"] })
    .notNull()
    .default("kk"),
  legalName: text("legal_name"),
  contact: text("contact"),
  dummyPayoutReference: text("dummy_payout_reference"),
  suspendedAt: integer("suspended_at"),
  updatedAt: integer("updated_at").notNull(),
})

export const platformGrants = sqliteTable(
  "platform_grants",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    permission: text("permission").notNull(),
    grantedAt: integer("granted_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.permission] })]
)

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    organizerId: text("organizer_id")
      .notNull()
      .references(() => user.id),
    title: text("title").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    venueName: text("venue_name").notNull(),
    venueAddress: text("venue_address").notNull(),
    refundInstructions: text("refund_instructions").notNull().default(""),
    timeZone: text("time_zone").notNull().default("Asia/Almaty"),
    startsAt: integer("starts_at").notNull(),
    endsAt: integer("ends_at").notNull(),
    registrationOpensAt: integer("registration_opens_at").notNull(),
    registrationClosesAt: integer("registration_closes_at").notNull(),
    capacity: integer("capacity").notNull(),
    maxTicketsPerOrder: integer("max_tickets_per_order").notNull().default(6),
    visibility: text("visibility", { enum: ["public", "unlisted", "private"] })
      .notNull()
      .default("public"),
    publicationState: text("publication_state", {
      enum: ["draft", "published", "unpublished"],
    })
      .notNull()
      .default("draft"),
    paidSalesState: text("paid_sales_state", {
      enum: ["pending", "active", "suspended"],
    })
      .notNull()
      .default("pending"),
    seatingMode: text("seating_mode", {
      enum: ["general_admission", "assigned"],
    })
      .notNull()
      .default("general_admission"),
    venueLayoutId: text("venue_layout_id"),
    calendarUid: text("calendar_uid").notNull().unique(),
    calendarSequence: integer("calendar_sequence").notNull().default(0),
    revision: integer("revision").notNull().default(0),
    reportingId: text("reporting_id").notNull().unique(),
    suspendedAt: integer("suspended_at"),
    cancelledAt: integer("cancelled_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("events_organizer_start").on(t.organizerId, t.startsAt),
    index("events_discovery").on(t.visibility, t.publicationState, t.startsAt),
    check(
      "event_dates",
      sql`${t.endsAt} > ${t.startsAt} AND ${t.registrationClosesAt} > ${t.registrationOpensAt}`
    ),
    check(
      "event_capacity",
      sql`${t.capacity} > 0 AND ${t.maxTicketsPerOrder} > 0 AND ${t.maxTicketsPerOrder} <= ${t.capacity}`
    ),
  ]
)

export const eventPermissions = sqliteTable(
  "event_permissions",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    permission: text("permission").notNull(),
    grantedAt: integer("granted_at").notNull(),
    revokedAt: integer("revoked_at"),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.userId, t.permission] }),
    index("event_permissions_user").on(t.userId, t.eventId),
  ]
)

export const invitations = sqliteTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
    acceptedBy: text("accepted_by").references(() => user.id),
    acceptedAt: integer("accepted_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("invitation_access").on(t.eventId, t.acceptedBy)]
)

export const ticketTypes = sqliteTable(
  "ticket_types",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    kind: text("kind", { enum: ["free", "paid"] }).notNull(),
    priceMinor: integer("price_minor").notNull(),
    quantity: integer("quantity").notNull(),
    salesStartAt: integer("sales_start_at").notNull(),
    salesEndAt: integer("sales_end_at").notNull(),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("ticket_types_event").on(t.eventId),
    check(
      "ticket_type_price",
      sql`(${t.kind} = 'free' AND ${t.priceMinor} = 0) OR (${t.kind} = 'paid' AND ${t.priceMinor} > 0)`
    ),
    check("ticket_type_quantity", sql`${t.quantity} > 0`),
    check("ticket_type_dates", sql`${t.salesEndAt} > ${t.salesStartAt}`),
  ]
)

export const campaigns = sqliteTable(
  "campaigns",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    name: text("name").notNull(),
    code: text("code").notNull().unique(),
    tokenHash: text("token_hash").notNull().unique(),
    reportingId: text("reporting_id").notNull().unique(),
    discountKind: text("discount_kind", {
      enum: ["percentage", "fixed"],
    }).notNull(),
    discountValue: integer("discount_value").notNull(),
    startsAt: integer("starts_at").notNull(),
    endsAt: integer("ends_at").notNull(),
    maxRedemptions: integer("max_redemptions").notNull().default(100),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("campaigns_event").on(t.eventId),
    check("campaign_limit", sql`${t.maxRedemptions} > 0`),
    check(
      "campaign_discount",
      sql`(${t.discountKind} = 'fixed' AND ${t.discountValue} > 0) OR (${t.discountKind} = 'percentage' AND ${t.discountValue} BETWEEN 100 AND 10000)`
    ),
  ]
)

export const campaignTicketTypes = sqliteTable(
  "campaign_ticket_types",
  {
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    ticketTypeId: text("ticket_type_id")
      .notNull()
      .references(() => ticketTypes.id),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.ticketTypeId] })]
)

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => user.id),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    state: text("state", {
      enum: [
        "pending",
        "completed",
        "expired",
        "abandoned",
        "cancelled",
        "refunded",
      ],
    })
      .notNull()
      .default("pending"),
    currency: text("currency").notNull().default("KZT"),
    subtotalMinor: integer("subtotal_minor").notNull(),
    discountMinor: integer("discount_minor").notNull(),
    totalMinor: integer("total_minor").notNull(),
    processingFeeBasisPoints: integer("processing_fee_basis_points")
      .notNull()
      .default(300),
    processingFeeMinor: integer("processing_fee_minor").notNull(),
    campaignId: text("campaign_id").references(() => campaigns.id),
    refundPolicyVersion: text("refund_policy_version").notNull(),
    refundPolicyJson: text("refund_policy_json")
      .notNull()
      .default('{"version":"academic-v1","instructions":""}'),
    revision: integer("revision").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    completedAt: integer("completed_at"),
    admissionBlockedAt: integer("admission_blocked_at"),
  },
  (t) => [
    index("orders_account").on(t.accountId, t.createdAt),
    index("orders_reporting").on(t.eventId, t.completedAt),
    check(
      "order_amounts",
      sql`${t.currency} = 'KZT' AND ${t.subtotalMinor} >= 0 AND ${t.discountMinor} BETWEEN 0 AND ${t.subtotalMinor} AND ${t.totalMinor} = ${t.subtotalMinor} - ${t.discountMinor} AND ${t.processingFeeMinor} BETWEEN 0 AND ${t.totalMinor}`
    ),
  ]
)

export const reservations = sqliteTable(
  "reservations",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .unique()
      .references(() => orders.id),
    accountId: text("account_id")
      .notNull()
      .references(() => user.id),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    state: text("state", {
      enum: ["active", "consumed", "expired", "abandoned"],
    })
      .notNull()
      .default("active"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    paymentAttemptId: text("payment_attempt_id"),
  },
  (t) => [
    uniqueIndex("one_active_reservation")
      .on(t.accountId, t.eventId)
      .where(sql`${t.state} = 'active'`),
    index("reservation_expiry").on(t.state, t.expiresAt),
    check(
      "reservation_deadline",
      sql`${t.expiresAt} = ${t.createdAt} + 600000`
    ),
  ]
)

// Each row is one place in event inventory, whether general admission or a seat.
// A seat's event-specific ID is never reused across duplicated events.
export const inventory = sqliteTable(
  "inventory",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    ticketTypeId: text("ticket_type_id")
      .notNull()
      .references(() => ticketTypes.id),
    section: text("section"),
    row: text("row"),
    number: text("number"),
    accessible: integer("accessible", { mode: "boolean" })
      .notNull()
      .default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    reservationId: text("reservation_id").references(() => reservations.id),
    orderId: text("order_id").references(() => orders.id),
  },
  (t) => [
    uniqueIndex("one_event_seat").on(t.eventId, t.section, t.row, t.number),
    index("inventory_availability").on(
      t.eventId,
      t.ticketTypeId,
      t.enabled,
      t.orderId,
      t.reservationId
    ),
  ]
)

export const orderItems = sqliteTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    ticketTypeId: text("ticket_type_id")
      .notNull()
      .references(() => ticketTypes.id),
    ticketTypeName: text("ticket_type_name").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceMinor: integer("unit_price_minor").notNull(),
    subtotalMinor: integer("subtotal_minor").notNull(),
    discountMinor: integer("discount_minor").notNull(),
    totalMinor: integer("total_minor").notNull(),
    attendeesJson: text("attendees_json").notNull(),
    seatsJson: text("seats_json").notNull(),
  },
  (t) => [
    index("order_items_order").on(t.orderId),
    check(
      "item_totals",
      sql`${t.quantity} > 0 AND ${t.unitPriceMinor} >= 0 AND ${t.subtotalMinor} = ${t.quantity} * ${t.unitPriceMinor} AND ${t.discountMinor} BETWEEN 0 AND ${t.subtotalMinor} AND ${t.totalMinor} = ${t.subtotalMinor} - ${t.discountMinor}`
    ),
  ]
)

export const promoAllocations = sqliteTable(
  "promo_allocations",
  {
    orderId: text("order_id")
      .primaryKey()
      .references(() => orders.id),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    reservationId: text("reservation_id")
      .notNull()
      .references(() => reservations.id),
    committedAt: integer("committed_at"),
    releasedAt: integer("released_at"),
  },
  (t) => [index("promo_usage").on(t.campaignId, t.releasedAt)]
)

export const paymentAttempts = sqliteTable(
  "payment_attempts",
  {
    id: text("id").primaryKey(),
    purpose: text("purpose", {
      enum: ["ticket_order", "event_activation"],
    }).notNull(),
    subjectId: text("subject_id").notNull(),
    state: text("state", {
      enum: ["pending", "succeeded", "failed", "cancelled"],
    })
      .notNull()
      .default("pending"),
    provider: text("provider", {
      enum: ["polar_sandbox", "simulation"],
    }).notNull(),
    providerPaymentId: text("provider_payment_id"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull().default("KZT"),
    createdAt: integer("created_at").notNull(),
    succeededAt: integer("succeeded_at"),
  },
  (t) => [
    uniqueIndex("provider_payment_identity").on(
      t.provider,
      t.providerPaymentId
    ),
    check(
      "payment_amount",
      sql`${t.amountMinor} > 0 AND ${t.currency} = 'KZT'`
    ),
  ]
)

export const refunds = sqliteTable("refunds", {
  id: text("id").primaryKey(),
  paymentAttemptId: text("payment_attempt_id")
    .notNull()
    .unique()
    .references(() => paymentAttempts.id),
  reason: text("reason").notNull(),
  state: text("state", { enum: ["pending", "succeeded", "failed"] })
    .notNull()
    .default("pending"),
  amountMinor: integer("amount_minor").notNull(),
  providerRefundId: text("provider_refund_id"),
  createdAt: integer("created_at").notNull(),
  confirmedAt: integer("confirmed_at"),
})

export const tickets = sqliteTable(
  "tickets",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    orderItemId: text("order_item_id")
      .notNull()
      .references(() => orderItems.id),
    inventoryId: text("inventory_id")
      .notNull()
      .references(() => inventory.id),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    ticketTypeId: text("ticket_type_id")
      .notNull()
      .references(() => ticketTypes.id),
    attendeeName: text("attendee_name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    credentialCiphertext: text("credential_ciphertext").notNull(),
    seatJson: text("seat_json"),
    state: text("state", {
      enum: ["valid", "checked_in", "cancelled", "refunded"],
    })
      .notNull()
      .default("valid"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("tickets_event_order").on(t.eventId, t.orderId),
    uniqueIndex("ticket_inventory_per_order").on(t.inventoryId, t.orderId),
  ]
)

export const checkins = sqliteTable(
  "checkins",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    operationId: text("operation_id").notNull().unique(),
    deviceId: text("device_id"),
    capturedAt: integer("captured_at").notNull(),
    committedAt: integer("committed_at").notNull(),
    reversedAt: integer("reversed_at"),
    reversedBy: text("reversed_by").references(() => user.id),
    reversalReason: text("reversal_reason"),
  },
  (t) => [
    uniqueIndex("one_active_admission")
      .on(t.ticketId)
      .where(sql`${t.reversedAt} IS NULL`),
  ]
)

export const auditEntries = sqliteTable(
  "audit_entries",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").references(() => events.id),
    actorId: text("actor_id"),
    scope: text("scope", { enum: ["event", "account", "platform"] }).notNull(),
    action: text("action").notNull(),
    entityId: text("entity_id").notNull(),
    description: text("description").notNull(),
    correlationId: text("correlation_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("audit_event_time").on(t.eventId, t.createdAt)]
)

export const outbox = sqliteTable(
  "outbox",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    entityId: text("entity_id").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at").notNull(),
    dispatchedAt: integer("dispatched_at"),
    completedAt: integer("completed_at"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull(),
  },
  (t) => [index("outbox_pending").on(t.completedAt, t.nextAttemptAt)]
)

export const requestReceipts = sqliteTable(
  "request_receipts",
  {
    actorId: text("actor_id").notNull(),
    requestId: text("request_id").notNull(),
    inputHash: text("input_hash").notNull(),
    resourceId: text("resource_id").notNull(),
    responseJson: text("response_json"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.requestId] })]
)

// Conditional zero-row updates do not fail D1 batches. A failed guard explicitly
// raises a CHECK error and rolls back the entire transition, including its audit.
export const transitionGuards = sqliteTable(
  "transition_guards",
  {
    id: text("id").primaryKey(),
    valid: integer("valid").notNull(),
  },
  (t) => [check("transition_guard_valid", sql`${t.valid} = 1`)]
)

// Only local development injects this transport. There is no public mailbox API.
export const developmentMail = sqliteTable("development_mail", {
  id: text("id").primaryKey(),
  recipient: text("recipient").notNull(),
  kind: text("kind").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
})
