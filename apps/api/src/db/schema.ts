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

export const ga4Reports = sqliteTable(
  "ga4_reports",
  {
    cacheKey: text("cache_key").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    resultJson: text("result_json"),
    fetchedAt: integer("fetched_at"),
    expiresAt: integer("expires_at").notNull(),
    leaseToken: text("lease_token"),
    leaseUntil: integer("lease_until").notNull().default(0),
    touchedAt: integer("touched_at").notNull(),
  },
  (t) => [
    index("ga4_reports_event").on(t.eventId, t.touchedAt, t.cacheKey),
    index("ga4_reports_cleanup").on(t.touchedAt),
    check(
      "ga4_reports_payload_size",
      sql`${t.resultJson} IS NULL OR length(${t.resultJson}) <= 262144`
    ),
  ]
)

export const platformGrants = sqliteTable(
  "platform_grants",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    permission: text("permission").notNull(),
    grantedAt: integer("granted_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.permission] }),
    index("platform_grants_delivery").on(t.permission, t.userId),
  ]
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
    index("event_permissions_delivery").on(t.eventId, t.permission, t.userId),
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
    index("orders_delivery_recipients").on(t.eventId, t.completedAt, t.id),
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
    providerOrderId: text("provider_order_id"),
    actorId: text("actor_id").references(() => user.id),
    requestHash: text("request_hash"),
    requestJson: text("request_json"),
    checkoutUrl: text("checkout_url"),
    dispatchState: text("dispatch_state", {
      enum: ["prepared", "dispatched", "uncertain", "reconciled"],
    })
      .notNull()
      .default("prepared"),
    lastErrorCode: text("last_error_code"),
    updatedAt: integer("updated_at").notNull().default(0),
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
    uniqueIndex("provider_order_identity").on(t.provider, t.providerOrderId),
    index("payment_subject_reporting").on(
      t.purpose,
      t.subjectId,
      t.succeededAt
    ),
    check(
      "payment_amount",
      sql`${t.amountMinor} > 0 AND ${t.currency} = 'KZT'`
    ),
  ]
)

export const activationSettings = sqliteTable(
  "activation_settings",
  {
    id: text("id").primaryKey(),
    feeMinor: integer("fee_minor").notNull().default(500_000),
    currency: text("currency").notNull().default("KZT"),
    revision: integer("revision").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
    updatedBy: text("updated_by"),
  },
  (t) => [
    check(
      "activation_settings_values",
      sql`${t.id} = 'default' AND ${t.feeMinor} >= 30000 AND ${t.feeMinor} <= 100000000 AND ${t.currency} = 'KZT' AND ${t.revision} >= 0`
    ),
  ]
)

export const eventActivations = sqliteTable(
  "event_activations",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => events.id),
    revision: integer("revision").notNull().default(0),
    displayName: text("display_name").notNull(),
    legalName: text("legal_name").notNull(),
    contact: text("contact").notNull(),
    dummyPayoutReference: text("dummy_payout_reference").notNull(),
    profileUpdatedAt: integer("profile_updated_at").notNull(),
    emailCheckedAt: integer("email_checked_at").notNull(),
    identityCheck: text("identity_check", {
      enum: ["pending", "passed", "failed"],
    })
      .notNull()
      .default("pending"),
    identityCheckedAt: integer("identity_checked_at"),
    payoutCheck: text("payout_check", { enum: ["pending", "passed", "failed"] })
      .notNull()
      .default("pending"),
    payoutCheckedAt: integer("payout_checked_at"),
    termsVersion: text("terms_version"),
    termsAcceptedAt: integer("terms_accepted_at"),
    successfulPaymentAttemptId: text("successful_payment_attempt_id")
      .unique()
      .references(() => paymentAttempts.id),
    activatedAt: integer("activated_at"),
    suspendedAt: integer("suspended_at"),
    suspensionReason: text("suspension_reason"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    check(
      "activation_values",
      sql`${t.revision} >= 0 AND ${t.identityCheck} IN ('pending', 'passed', 'failed') AND ${t.payoutCheck} IN ('pending', 'passed', 'failed') AND (${t.successfulPaymentAttemptId} IS NULL) = (${t.activatedAt} IS NULL) AND (${t.termsVersion} IS NULL) = (${t.termsAcceptedAt} IS NULL)`
    ),
  ]
)

export const activationChecklistHistory = sqliteTable(
  "activation_checklist_history",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => eventActivations.eventId),
    revision: integer("revision").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    checklistJson: text("checklist_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.revision] }),
    check(
      "activation_history_values",
      sql`${t.revision} > 0 AND json_valid(${t.checklistJson}) = 1`
    ),
  ]
)

export const activationAttempts = sqliteTable(
  "activation_attempts",
  {
    paymentAttemptId: text("payment_attempt_id")
      .primaryKey()
      .references(() => paymentAttempts.id),
    eventId: text("event_id")
      .notNull()
      .references(() => eventActivations.eventId),
    checklistRevision: integer("checklist_revision").notNull(),
    feeSettingsRevision: integer("fee_settings_revision").notNull(),
    feeMinor: integer("fee_minor").notNull(),
    currency: text("currency").notNull().default("KZT"),
    checklistSnapshotJson: text("checklist_snapshot_json").notNull(),
    termsVersion: text("terms_version").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("activation_event_attempts").on(t.eventId, t.createdAt),
    check(
      "activation_attempt_values",
      sql`${t.checklistRevision} >= 0 AND ${t.feeSettingsRevision} >= 0 AND ${t.feeMinor} >= 30000 AND ${t.currency} = 'KZT' AND json_valid(${t.checklistSnapshotJson}) = 1`
    ),
  ]
)

export const refunds = sqliteTable(
  "refunds",
  {
    requestedBy: text("requested_by").references(() => user.id),
    supportCaseId: text("support_case_id").references(() => supportCases.id),
    authorizationReason: text("authorization_reason"),
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
    dispatchState: text("dispatch_state", {
      enum: ["prepared", "dispatched", "uncertain", "reconciled"],
    })
      .notNull()
      .default("prepared"),
    requestJson: text("request_json"),
    lastErrorCode: text("last_error_code"),
    updatedAt: integer("updated_at").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    confirmedAt: integer("confirmed_at"),
  },
  (t) => [
    index("refund_confirmation_reporting").on(
      t.state,
      t.confirmedAt,
      t.paymentAttemptId
    ),
  ]
)

export const simulatedPayouts = sqliteTable(
  "simulated_payouts",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    organizerId: text("organizer_id")
      .notNull()
      .references(() => user.id),
    currency: text("currency").notNull().default("KZT"),
    amountMinor: integer("amount_minor").notNull(),
    orderCount: integer("order_count").notNull(),
    eligibleAt: integer("eligible_at").notNull(),
    completedAt: integer("completed_at").notNull(),
  },
  (t) => [
    index("payout_event_time").on(t.eventId, t.completedAt),
    check(
      "payout_amounts",
      sql`${t.currency} = 'KZT' AND ${t.amountMinor} >= 0 AND ${t.orderCount} BETWEEN 1 AND 20 AND ${t.completedAt} >= ${t.eligibleAt}`
    ),
  ]
)

export const simulatedPayoutItems = sqliteTable(
  "simulated_payout_items",
  {
    id: text("id").primaryKey(),
    payoutId: text("payout_id")
      .notNull()
      .references(() => simulatedPayouts.id),
    orderId: text("order_id")
      .notNull()
      .unique()
      .references(() => orders.id),
    paymentAttemptId: text("payment_attempt_id")
      .notNull()
      .unique()
      .references(() => paymentAttempts.id),
    paidMinor: integer("paid_minor").notNull(),
    processingFeeMinor: integer("processing_fee_minor").notNull(),
    contributionMinor: integer("contribution_minor").notNull(),
  },
  (t) => [
    index("payout_items_run").on(t.payoutId),
    check(
      "payout_item_amounts",
      sql`${t.paidMinor} > 0 AND ${t.processingFeeMinor} BETWEEN 0 AND ${t.paidMinor} AND ${t.contributionMinor} = ${t.paidMinor} - ${t.processingFeeMinor}`
    ),
  ]
)

export const simulatedPayoutAdjustments = sqliteTable(
  "simulated_payout_adjustments",
  {
    id: text("id").primaryKey(),
    payoutItemId: text("payout_item_id")
      .notNull()
      .references(() => simulatedPayoutItems.id),
    refundId: text("refund_id")
      .notNull()
      .unique()
      .references(() => refunds.id),
    amountMinor: integer("amount_minor").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("payout_adjustments_item").on(t.payoutItemId),
    check("payout_adjustment_amount", sql`${t.amountMinor} <= 0`),
  ]
)

export const providerEvents = sqliteTable(
  "provider_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    inputHash: text("input_hash").notNull(),
    paymentAttemptId: text("payment_attempt_id").notNull(),
    payloadJson: text("payload_json").notNull(),
    receivedAt: integer("received_at").notNull(),
    processedAt: integer("processed_at"),
  },
  (t) => [
    uniqueIndex("provider_event_identity").on(t.provider, t.providerEventId),
  ]
)

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
    index("tickets_delivery_parts").on(t.eventId, t.orderId, t.id),
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

export const offlineDevices = sqliteTable(
  "offline_devices",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => user.id),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    label: text("label").notNull(),
    revision: integer("revision").notNull().default(0),
    registeredAt: integer("registered_at").notNull(),
    revokedAt: integer("revoked_at"),
    revokedBy: text("revoked_by").references(() => user.id),
    revocationReason: text("revocation_reason"),
    lossReported: integer("loss_reported", { mode: "boolean" })
      .notNull()
      .default(false),
    lastSyncAt: integer("last_sync_at"),
  },
  (t) => [
    index("offline_devices_event_account").on(t.eventId, t.accountId, t.id),
  ]
)

export const offlineSnapshots = sqliteTable(
  "offline_snapshots",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => user.id),
    deviceId: text("device_id")
      .notNull()
      .references(() => offlineDevices.id),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    issuedAt: integer("issued_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    eventEndsAt: integer("event_ends_at").notNull(),
    ticketCount: integer("ticket_count").notNull(),
    keyId: text("key_id").notNull(),
    manifestJson: text("manifest_json"),
  },
  (t) => [
    index("offline_snapshots_expiry").on(t.expiresAt),
    index("offline_snapshots_device").on(t.deviceId, t.issuedAt),
  ]
)

export const offlineSnapshotTickets = sqliteTable(
  "offline_snapshot_tickets",
  {
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => offlineSnapshots.id),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id),
    ordinal: integer("ordinal").notNull(),
    tokenHash: text("token_hash").notNull(),
    payloadJson: text("payload_json").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.snapshotId, t.ticketId] }),
    uniqueIndex("offline_snapshot_page_order").on(t.snapshotId, t.ordinal),
  ]
)

export const offlineOperations = sqliteTable(
  "offline_operations",
  {
    operationId: text("operation_id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => user.id),
    deviceId: text("device_id")
      .notNull()
      .references(() => offlineDevices.id),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    snapshotId: text("snapshot_id").notNull(),
    kind: text("kind", { enum: ["scan", "undo"] }).notNull(),
    originalOperationId: text("original_operation_id"),
    deviceSequence: integer("device_sequence").notNull(),
    capturedAt: integer("captured_at").notNull(),
    reportedAt: integer("reported_at").notNull(),
    inputHash: text("input_hash").notNull(),
    unitHash: text("unit_hash").notNull(),
    result: text("result").notNull(),
    checkinId: text("checkin_id").references(() => checkins.id),
    ticketId: text("ticket_id").references(() => tickets.id),
    orderId: text("order_id").references(() => orders.id),
  },
  (t) => [
    uniqueIndex("offline_device_sequence").on(t.deviceId, t.deviceSequence),
    index("offline_operations_event").on(t.eventId, t.operationId),
  ]
)

export const offlineAdmissionReports = sqliteTable(
  "offline_admission_reports",
  {
    operationId: text("operation_id")
      .primaryKey()
      .references(() => offlineOperations.operationId),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id),
    revision: integer("revision").notNull().default(0),
    reviewState: text("review_state", { enum: ["unresolved", "resolved"] })
      .notNull()
      .default("unresolved"),
    resolution: text("resolution", {
      enum: ["no_admission", "admission_confirmed"],
    }),
    reviewedAt: integer("reviewed_at"),
    reviewedBy: text("reviewed_by").references(() => user.id),
    reason: text("reason"),
  },
  (t) => [index("offline_unresolved_order").on(t.orderId, t.reviewState)]
)

export const offlineAdmissionReviews = sqliteTable(
  "offline_admission_reviews",
  {
    id: text("id").primaryKey(),
    operationId: text("operation_id")
      .notNull()
      .references(() => offlineOperations.operationId),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    resolution: text("resolution", {
      enum: ["no_admission", "admission_confirmed"],
    }).notNull(),
    reason: text("reason").notNull(),
    checkinId: text("checkin_id").references(() => checkins.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("offline_one_review").on(t.operationId)]
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
  (t) => [
    index("audit_event_time").on(t.eventId, t.createdAt),
    index("audit_scope_event_time").on(t.scope, t.eventId, t.createdAt, t.id),
  ]
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
  (t) => [
    index("outbox_pending").on(t.completedAt, t.nextAttemptAt),
    index("outbox_delivery_source").on(t.kind, t.entityId, t.createdAt, t.id),
    index("outbox_kind_pending").on(
      t.kind,
      t.completedAt,
      t.nextAttemptAt,
      t.id
    ),
  ]
)

export const emailDeliveries = sqliteTable(
  "email_deliveries",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull(),
    kind: text("kind").notNull(),
    entityId: text("entity_id").notNull(),
    eventId: text("event_id").references(() => events.id),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => user.id),
    partKey: text("part_key").notNull().default(""),
    metadataJson: text("metadata_json").notNull(),
    pdfState: text("pdf_state").notNull().default("not_required"),
    emailState: text("email_state").notNull().default("pending"),
    payloadKey: text("payload_key"),
    payloadHash: text("payload_hash"),
    providerId: text("provider_id"),
    providerStatus: text("provider_status"),
    firstAttemptAt: integer("first_attempt_at"),
    lastAttemptAt: integer("last_attempt_at"),
    attempts: integer("attempts").notNull().default(0),
    failures: integer("failures").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: integer("next_attempt_at").notNull(),
    leaseToken: text("lease_token"),
    leaseUntil: integer("lease_until"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (t) => [
    uniqueIndex("email_delivery_source_part").on(
      t.sourceId,
      t.recipientId,
      t.partKey
    ),
    index("email_delivery_pending").on(t.emailState, t.nextAttemptAt),
    index("email_delivery_event").on(t.eventId, t.createdAt),
    index("email_delivery_state_cursor").on(t.emailState, t.id),
    index("email_delivery_event_cursor").on(t.eventId, t.id),
    index("email_delivery_pdf_cursor").on(t.pdfState, t.id),
    index("email_delivery_kind_cursor").on(t.kind, t.id),
    check(
      "email_delivery_states",
      sql`${t.pdfState} IN ('not_required', 'pending', 'ready', 'failed') AND ${t.emailState} IN ('pending', 'accepted', 'delivered', 'bounced', 'failed', 'suppressed', 'review_needed') AND ${t.attempts} >= 0 AND ${t.failures} >= 0 AND (${t.payloadKey} IS NULL) = (${t.payloadHash} IS NULL) AND (${t.firstAttemptAt} IS NULL OR (${t.payloadKey} IS NOT NULL AND ${t.lastAttemptAt} >= ${t.firstAttemptAt})) AND (${t.providerId} IS NULL OR ${t.firstAttemptAt} IS NOT NULL) AND json_valid(${t.metadataJson})`
    ),
  ]
)

export const deliveryFanout = sqliteTable("delivery_fanout", {
  sourceId: text("source_id").primaryKey(),
  cursor: text("cursor").notNull().default(""),
  completedAt: integer("completed_at"),
  createdAt: integer("created_at").notNull(),
})

export const deliveryPayloadObjects = sqliteTable(
  "delivery_payload_objects",
  {
    key: text("key").primaryKey(),
    deliveryId: text("delivery_id").notNull(),
    hash: text("hash").notNull(),
    state: text("state").notNull().default("staged"),
    deleteAfter: integer("delete_after").notNull(),
    lastSweptAt: integer("last_swept_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("delivery_payload_cleanup").on(t.deleteAfter, t.lastSweptAt),
    index("delivery_payload_owner").on(t.deliveryId),
    check(
      "delivery_payload_state",
      sql`${t.state} IN ('staged','deleting','deleted') AND ${t.deleteAfter} > ${t.createdAt} AND length(${t.hash})=64`
    ),
  ]
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

export const supportCases = sqliteTable(
  "support_cases",
  {
    id: text("id").primaryKey(),
    requesterId: text("requester_id")
      .notNull()
      .references(() => user.id),
    audience: text("audience", {
      enum: ["attendee", "organizer_platform"],
    }).notNull(),
    category: text("category", {
      enum: [
        "ticket_delivery",
        "payment",
        "refund",
        "seating",
        "event_information",
        "check_in",
        "account",
        "activation",
        "technical",
        "dispute",
        "compensation",
      ],
    }).notNull(),
    subject: text("subject").notNull(),
    eventId: text("event_id").references(() => events.id),
    orderId: text("order_id").references(() => orders.id),
    ticketId: text("ticket_id").references(() => tickets.id),
    assigneeId: text("assignee_id").references(() => user.id),
    status: text("status", {
      enum: ["open", "in_progress", "waiting_for_customer", "resolved"],
    })
      .notNull()
      .default("open"),
    revision: integer("revision").notNull().default(1),
    lastSequence: integer("last_sequence").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (t) => [
    index("support_requester_created").on(t.requesterId, t.createdAt, t.id),
    index("support_event_created").on(t.eventId, t.createdAt, t.id),
    index("support_assignee_created").on(t.assigneeId, t.createdAt, t.id),
    index("support_order_resolution").on(t.orderId, t.status, t.category),
    check(
      "support_case_domain",
      sql`${t.audience} IN ('attendee', 'organizer_platform') AND ${t.status} IN ('open', 'in_progress', 'waiting_for_customer', 'resolved') AND ${t.category} IN ('ticket_delivery', 'payment', 'refund', 'seating', 'event_information', 'check_in', 'account', 'activation', 'technical', 'dispute', 'compensation') AND length(trim(${t.subject})) BETWEEN 1 AND 160 AND ${t.revision} >= 1 AND ${t.lastSequence} = ${t.revision} AND ${t.updatedAt} >= ${t.createdAt} AND (${t.status} = 'resolved') = (${t.resolvedAt} IS NOT NULL) AND (${t.resolvedAt} IS NULL OR ${t.resolvedAt} BETWEEN ${t.createdAt} AND ${t.updatedAt})`
    ),
    check(
      "support_case_context",
      sql`(${t.ticketId} IS NULL OR ${t.orderId} IS NOT NULL) AND (${t.orderId} IS NULL OR ${t.eventId} IS NOT NULL) AND (${t.audience} <> 'attendee' OR ${t.eventId} IS NOT NULL) AND (${t.category} NOT IN ('refund', 'dispute', 'compensation') OR ${t.orderId} IS NOT NULL)`
    ),
  ]
)

export const supportMessages = sqliteTable(
  "support_messages",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => supportCases.id),
    sequence: integer("sequence").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("support_message_sequence").on(t.caseId, t.sequence),
    check(
      "support_message_values",
      sql`${t.sequence} >= 1 AND length(trim(${t.body})) BETWEEN 1 AND 8000 AND length(${t.authorName}) BETWEEN 1 AND 256`
    ),
  ]
)

export const supportCaseChanges = sqliteTable(
  "support_case_changes",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => supportCases.id),
    sequence: integer("sequence").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    kind: text("kind", {
      enum: ["created", "message", "assignment", "status"],
    }).notNull(),
    messageId: text("message_id")
      .unique()
      .references(() => supportMessages.id),
    beforeJson: text("before_json").notNull(),
    afterJson: text("after_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("support_change_sequence").on(t.caseId, t.sequence),
    check(
      "support_change_values",
      sql`${t.sequence} >= 1 AND ${t.kind} IN ('created', 'message', 'assignment', 'status') AND json_valid(${t.beforeJson}) = 1 AND json_valid(${t.afterJson}) = 1 AND json_type(${t.beforeJson}) = 'object' AND json_type(${t.afterJson}) = 'object' AND (${t.kind} IN ('created', 'message')) = (${t.messageId} IS NOT NULL)`
    ),
  ]
)

export const supportAttachments = sqliteTable(
  "support_attachments",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => supportCases.id),
    uploaderId: text("uploader_id")
      .notNull()
      .references(() => user.id),
    messageId: text("message_id").references(() => supportMessages.id),
    position: integer("position"),
    uploadRequestId: text("upload_request_id").notNull(),
    inputHash: text("input_hash").notNull(),
    safeFilename: text("safe_filename").notNull(),
    declaredType: text("declared_type").notNull(),
    originalSize: integer("original_size").notNull(),
    originalSha256: text("original_sha256").notNull(),
    quarantineKey: text("quarantine_key").notNull().unique(),
    objectKey: text("object_key").notNull().unique(),
    contentType: text("content_type"),
    contentSize: integer("content_size"),
    contentSha256: text("content_sha256"),
    validatorVersion: text("validator_version").notNull(),
    status: text("status", {
      enum: [
        "quarantined",
        "ready",
        "attached",
        "rejected",
        "deleting",
        "deleted",
      ],
    }).notNull(),
    rejectionCode: text("rejection_code"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    validatedAt: integer("validated_at"),
    attachedAt: integer("attached_at"),
    deletedAt: integer("deleted_at"),
    cleanupAfter: integer("cleanup_after"),
  },
  (t) => [
    uniqueIndex("support_upload_request").on(t.uploaderId, t.uploadRequestId),
    uniqueIndex("support_attachment_position")
      .on(t.messageId, t.position)
      .where(sql`${t.messageId} IS NOT NULL`),
    index("support_upload_cleanup").on(t.cleanupAfter, t.status),
    index("support_attachment_message").on(t.caseId, t.messageId),
    index("support_upload_uploader").on(t.uploaderId, t.status),
    check(
      "support_attachment_domain",
      sql`${t.status} IN ('quarantined','ready','attached','rejected','deleting','deleted') AND ${t.declaredType} IN ('image/jpeg','image/png','application/pdf') AND ${t.originalSize} BETWEEN 1 AND 5242880 AND length(${t.safeFilename}) BETWEEN 1 AND 160 AND length(${t.inputHash}) = 64 AND length(${t.originalSha256}) = 64 AND ${t.expiresAt} > ${t.createdAt} AND ${t.expiresAt} <= ${t.createdAt} + 86400000 AND (${t.contentType} IS NULL OR ${t.contentType} = ${t.declaredType}) AND (${t.contentSize} IS NULL OR ${t.contentSize} BETWEEN 1 AND 5242880) AND (${t.contentSha256} IS NULL OR length(${t.contentSha256}) = 64)`
    ),
    check(
      "support_attachment_ready",
      sql`${t.status} NOT IN ('ready','attached') OR (${t.contentType} IS NOT NULL AND ${t.contentSize} IS NOT NULL AND ${t.contentSha256} IS NOT NULL AND ${t.validatedAt} IS NOT NULL AND ${t.rejectionCode} IS NULL)`
    ),
    check(
      "support_attachment_link",
      sql`(${t.messageId} IS NULL AND ${t.position} IS NULL AND ${t.attachedAt} IS NULL AND ${t.status} <> 'attached') OR (${t.messageId} IS NOT NULL AND ${t.position} IS NOT NULL AND ${t.position} BETWEEN 0 AND 2 AND ${t.attachedAt} IS NOT NULL AND ${t.status} = 'attached')`
    ),
    check(
      "support_attachment_deleted",
      sql`(${t.status} = 'deleted') = (${t.deletedAt} IS NOT NULL)`
    ),
  ]
)
