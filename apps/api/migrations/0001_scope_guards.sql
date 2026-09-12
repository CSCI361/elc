-- Database-local identity, scope and static snapshot guards.
-- These complement 0000_third_firebird.sql; they do not replace the API's
-- conditional transition guards for eligibility, expiry, counts or authorization.
--
-- Write ordering within a single D1 batch:
-- 1. Insert an order, then its reservation/items, then hold inventory and a promo.
-- 2. Insert a payment attempt before attaching its ID to a reservation.
-- 3. Assign inventory.order_id before inserting/updating an active ticket.
-- 4. Invalidate active tickets before clearing or transferring inventory ownership.
-- 5. Remove an uncommitted promo allocation before changing orders.campaign_id.
-- Existing cancelled/refunded tickets keep their immutable historical slot links.
-- No guard requires a parent's business state to change before its children's
-- state, so completion, refund and admission can use one atomic multi-step batch.

CREATE UNIQUE INDEX `ticket_active_inventory` ON `tickets` (`inventory_id`)
WHERE `state` IN ('valid', 'checked_in');
--> statement-breakpoint

-- Locale enums declared in TypeScript are not SQLite constraints.

CREATE TRIGGER `domain_profile_insert`
BEFORE INSERT ON `profiles`
FOR EACH ROW
WHEN COALESCE((NEW.locale IN ('kk', 'ru', 'en')), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: domain_profile');
END;
--> statement-breakpoint

CREATE TRIGGER `domain_profile_update`
BEFORE UPDATE ON `profiles`
FOR EACH ROW
WHEN COALESCE((NEW.locale IN ('kk', 'ru', 'en')), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: domain_profile');
END;
--> statement-breakpoint

-- Only supported platform permissions can be persisted.

CREATE TRIGGER `domain_platform_grant_insert`
BEFORE INSERT ON `platform_grants`
FOR EACH ROW
WHEN COALESCE((NEW.permission IN ('platform:moderate', 'platform:support', 'platform:configure', 'platform:recover')), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: domain_platform_grant');
END;
--> statement-breakpoint

CREATE TRIGGER `domain_platform_grant_update`
BEFORE UPDATE ON `platform_grants`
FOR EACH ROW
WHEN COALESCE((NEW.permission IN ('platform:moderate', 'platform:support', 'platform:configure', 'platform:recover')), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: domain_platform_grant');
END;
--> statement-breakpoint

-- Only supported event permissions can be persisted.

CREATE TRIGGER `domain_event_permission_insert`
BEFORE INSERT ON `event_permissions`
FOR EACH ROW
WHEN COALESCE((NEW.permission IN ('event:manage', 'support:manage', 'refund:initiate', 'ticket:scan', 'checkin:reverse', 'checkin:review', 'analytics:read', 'history:read')), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: domain_event_permission');
END;
--> statement-breakpoint

CREATE TRIGGER `domain_event_permission_update`
BEFORE UPDATE ON `event_permissions`
FOR EACH ROW
WHEN COALESCE((NEW.permission IN ('event:manage', 'support:manage', 'refund:initiate', 'ticket:scan', 'checkin:reverse', 'checkin:review', 'analytics:read', 'history:read')), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: domain_event_permission');
END;
--> statement-breakpoint

-- Event state domains and seating configuration must have a valid representation.

CREATE TRIGGER `domain_event_insert`
BEFORE INSERT ON `events`
FOR EACH ROW
WHEN COALESCE((
  NEW.visibility IN ('public', 'unlisted', 'private')
  AND NEW.publication_state IN ('draft', 'published', 'unpublished')
  AND NEW.paid_sales_state IN ('pending', 'active', 'suspended')
  AND NEW.seating_mode IN ('general_admission', 'assigned')
  AND NEW.calendar_sequence >= 0
  AND (
    (NEW.seating_mode = 'general_admission' AND NEW.venue_layout_id IS NULL)
    OR (NEW.seating_mode = 'assigned' AND length(trim(NEW.venue_layout_id)) > 0)
  )), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: domain_event');
END;
--> statement-breakpoint

CREATE TRIGGER `domain_event_update`
BEFORE UPDATE ON `events`
FOR EACH ROW
WHEN COALESCE((
  NEW.visibility IN ('public', 'unlisted', 'private')
  AND NEW.publication_state IN ('draft', 'published', 'unpublished')
  AND NEW.paid_sales_state IN ('pending', 'active', 'suspended')
  AND NEW.seating_mode IN ('general_admission', 'assigned')
  AND NEW.calendar_sequence >= 0
  AND (
    (NEW.seating_mode = 'general_admission' AND NEW.venue_layout_id IS NULL)
    OR (NEW.seating_mode = 'assigned' AND length(trim(NEW.venue_layout_id)) > 0)
  )), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: domain_event');
END;
--> statement-breakpoint

-- Accepted invitation identity and timestamp are recorded together.

CREATE TRIGGER `domain_invitation_insert`
BEFORE INSERT ON `invitations`
FOR EACH ROW
WHEN COALESCE((
  NEW.expires_at > NEW.created_at
  AND (
    (NEW.accepted_by IS NULL AND NEW.accepted_at IS NULL)
    OR (NEW.accepted_by IS NOT NULL AND NEW.accepted_at IS NOT NULL)
  )), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: domain_invitation');
END;
--> statement-breakpoint

CREATE TRIGGER `domain_invitation_update`
BEFORE UPDATE ON `invitations`
FOR EACH ROW
WHEN COALESCE((
  NEW.expires_at > NEW.created_at
  AND (
    (NEW.accepted_by IS NULL AND NEW.accepted_at IS NULL)
    OR (NEW.accepted_by IS NOT NULL AND NEW.accepted_at IS NOT NULL)
  )), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: domain_invitation');
END;
--> statement-breakpoint

-- Boolean storage is limited to zero or one; price/kind/dates are guarded by 0000.

CREATE TRIGGER `domain_ticket_type_insert`
BEFORE INSERT ON `ticket_types`
FOR EACH ROW
WHEN COALESCE((NEW.hidden IN (0, 1)), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: domain_ticket_type');
END;
--> statement-breakpoint

CREATE TRIGGER `domain_ticket_type_update`
BEFORE UPDATE ON `ticket_types`
FOR EACH ROW
WHEN COALESCE((NEW.hidden IN (0, 1)), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: domain_ticket_type');
END;
--> statement-breakpoint

-- Campaign dates must form a positive window.

CREATE TRIGGER `domain_campaign_insert`
BEFORE INSERT ON `campaigns`
FOR EACH ROW
WHEN COALESCE((
  NEW.enabled IN (0, 1)
  AND NEW.ends_at > NEW.starts_at), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: domain_campaign');
END;
--> statement-breakpoint

CREATE TRIGGER `domain_campaign_update`
BEFORE UPDATE ON `campaigns`
FOR EACH ROW
WHEN COALESCE((
  NEW.enabled IN (0, 1)
  AND NEW.ends_at > NEW.starts_at), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: domain_campaign');
END;
--> statement-breakpoint

-- An order's optional campaign and any existing promo allocation must agree.

CREATE TRIGGER `scope_order_insert`
BEFORE INSERT ON `orders`
FOR EACH ROW
WHEN COALESCE((
  NEW.state IN ('pending', 'completed', 'expired', 'abandoned', 'cancelled', 'refunded')
  AND NEW.processing_fee_basis_points BETWEEN 0 AND 10000
  AND (
    NEW.campaign_id IS NULL
    OR EXISTS (
      SELECT 1 FROM campaigns c
      WHERE c.id = NEW.campaign_id AND c.event_id = NEW.event_id
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM promo_allocations p
    WHERE p.order_id = NEW.id AND p.campaign_id IS NOT NEW.campaign_id
  )), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: scope_order');
END;
--> statement-breakpoint

CREATE TRIGGER `scope_order_update`
BEFORE UPDATE ON `orders`
FOR EACH ROW
WHEN COALESCE((
  NEW.state IN ('pending', 'completed', 'expired', 'abandoned', 'cancelled', 'refunded')
  AND NEW.processing_fee_basis_points BETWEEN 0 AND 10000
  AND (
    NEW.campaign_id IS NULL
    OR EXISTS (
      SELECT 1 FROM campaigns c
      WHERE c.id = NEW.campaign_id AND c.event_id = NEW.event_id
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM promo_allocations p
    WHERE p.order_id = NEW.id AND p.campaign_id IS NOT NEW.campaign_id
  )), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: scope_order');
END;
--> statement-breakpoint

-- Reservation account/event must equal its order, and an attached payment must fund that order.

CREATE TRIGGER `scope_reservation_insert`
BEFORE INSERT ON `reservations`
FOR EACH ROW
WHEN COALESCE((
  NEW.state IN ('active', 'consumed', 'expired', 'abandoned')
  AND EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = NEW.order_id
      AND o.account_id = NEW.account_id
      AND o.event_id = NEW.event_id
  )
  AND (
    NEW.payment_attempt_id IS NULL
    OR EXISTS (
      SELECT 1 FROM payment_attempts p
      WHERE p.id = NEW.payment_attempt_id
        AND p.purpose = 'ticket_order'
        AND p.subject_id = NEW.order_id
    )
  )), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: scope_reservation');
END;
--> statement-breakpoint

CREATE TRIGGER `scope_reservation_update`
BEFORE UPDATE ON `reservations`
FOR EACH ROW
WHEN COALESCE((
  NEW.state IN ('active', 'consumed', 'expired', 'abandoned')
  AND EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = NEW.order_id
      AND o.account_id = NEW.account_id
      AND o.event_id = NEW.event_id
  )
  AND (
    NEW.payment_attempt_id IS NULL
    OR EXISTS (
      SELECT 1 FROM payment_attempts p
      WHERE p.id = NEW.payment_attempt_id
        AND p.purpose = 'ticket_order'
        AND p.subject_id = NEW.order_id
    )
  )), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: scope_reservation');
END;
--> statement-breakpoint

-- Inventory links remain in one event; simultaneous hold/sale links name the same order. Active tickets prevent transfer.

CREATE TRIGGER `scope_inventory_insert`
BEFORE INSERT ON `inventory`
FOR EACH ROW
WHEN COALESCE((
  NEW.enabled IN (0, 1)
  AND NEW.accessible IN (0, 1)
  AND (
    (NEW.section IS NULL AND NEW.row IS NULL AND NEW.number IS NULL)
    OR (length(trim(NEW.section)) > 0 AND length(trim(NEW.row)) > 0 AND length(trim(NEW.number)) > 0)
  )
  AND EXISTS (
    SELECT 1 FROM ticket_types t
    WHERE t.id = NEW.ticket_type_id AND t.event_id = NEW.event_id
  )
  AND (
    NEW.reservation_id IS NULL
    OR EXISTS (
      SELECT 1 FROM reservations r
      WHERE r.id = NEW.reservation_id AND r.event_id = NEW.event_id
        AND (NEW.order_id IS NULL OR r.order_id = NEW.order_id)
    )
  )
  AND (
    NEW.order_id IS NULL
    OR EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = NEW.order_id AND o.event_id = NEW.event_id
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM tickets t
    WHERE t.inventory_id = NEW.id
      AND t.state IN ('valid', 'checked_in')
      AND (
        t.order_id IS NOT NEW.order_id
        OR t.event_id IS NOT NEW.event_id
        OR t.ticket_type_id IS NOT NEW.ticket_type_id
      )
  )), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: scope_inventory');
END;
--> statement-breakpoint

CREATE TRIGGER `scope_inventory_update`
BEFORE UPDATE ON `inventory`
FOR EACH ROW
WHEN COALESCE((
  NEW.enabled IN (0, 1)
  AND NEW.accessible IN (0, 1)
  AND (
    (NEW.section IS NULL AND NEW.row IS NULL AND NEW.number IS NULL)
    OR (length(trim(NEW.section)) > 0 AND length(trim(NEW.row)) > 0 AND length(trim(NEW.number)) > 0)
  )
  AND EXISTS (
    SELECT 1 FROM ticket_types t
    WHERE t.id = NEW.ticket_type_id AND t.event_id = NEW.event_id
  )
  AND (
    NEW.reservation_id IS NULL
    OR EXISTS (
      SELECT 1 FROM reservations r
      WHERE r.id = NEW.reservation_id AND r.event_id = NEW.event_id
        AND (NEW.order_id IS NULL OR r.order_id = NEW.order_id)
    )
  )
  AND (
    NEW.order_id IS NULL
    OR EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = NEW.order_id AND o.event_id = NEW.event_id
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM tickets t
    WHERE t.inventory_id = NEW.id
      AND t.state IN ('valid', 'checked_in')
      AND (
        t.order_id IS NOT NEW.order_id
        OR t.event_id IS NOT NEW.event_id
        OR t.ticket_type_id IS NOT NEW.ticket_type_id
      )
  )), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: scope_inventory');
END;
--> statement-breakpoint

-- Items must use their order's event and store well-formed quantity-aligned attendee/seat arrays.

CREATE TRIGGER `scope_order_item_insert`
BEFORE INSERT ON `order_items`
FOR EACH ROW
WHEN COALESCE((
  EXISTS (
    SELECT 1 FROM orders o JOIN ticket_types t ON t.event_id = o.event_id
    WHERE o.id = NEW.order_id AND t.id = NEW.ticket_type_id
  )
  AND CASE WHEN json_valid(NEW.attendees_json) THEN
    json_type(NEW.attendees_json) = 'array'
    AND json_array_length(NEW.attendees_json) = NEW.quantity
    AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.attendees_json) a
      WHERE a.type <> 'text' OR length(trim(a.value)) = 0 OR length(a.value) > 200
    )
  ELSE 0 END
  AND CASE WHEN json_valid(NEW.seats_json) THEN
    json_type(NEW.seats_json) = 'array'
    AND json_array_length(NEW.seats_json) IN (0, NEW.quantity)
  ELSE 0 END), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: scope_order_item');
END;
--> statement-breakpoint

CREATE TRIGGER `scope_order_item_update`
BEFORE UPDATE ON `order_items`
FOR EACH ROW
WHEN COALESCE((
  EXISTS (
    SELECT 1 FROM orders o JOIN ticket_types t ON t.event_id = o.event_id
    WHERE o.id = NEW.order_id AND t.id = NEW.ticket_type_id
  )
  AND CASE WHEN json_valid(NEW.attendees_json) THEN
    json_type(NEW.attendees_json) = 'array'
    AND json_array_length(NEW.attendees_json) = NEW.quantity
    AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.attendees_json) a
      WHERE a.type <> 'text' OR length(trim(a.value)) = 0 OR length(a.value) > 200
    )
  ELSE 0 END
  AND CASE WHEN json_valid(NEW.seats_json) THEN
    json_type(NEW.seats_json) = 'array'
    AND json_array_length(NEW.seats_json) IN (0, NEW.quantity)
  ELSE 0 END), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: scope_order_item');
END;
--> statement-breakpoint

-- Campaign applicability cannot include a ticket type from another event.

CREATE TRIGGER `scope_campaign_ticket_type_insert`
BEFORE INSERT ON `campaign_ticket_types`
FOR EACH ROW
WHEN COALESCE((
  EXISTS (
    SELECT 1 FROM campaigns c JOIN ticket_types t ON t.event_id = c.event_id
    WHERE c.id = NEW.campaign_id AND t.id = NEW.ticket_type_id
  )), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: scope_campaign_ticket_type');
END;
--> statement-breakpoint

CREATE TRIGGER `scope_campaign_ticket_type_update`
BEFORE UPDATE ON `campaign_ticket_types`
FOR EACH ROW
WHEN COALESCE((
  EXISTS (
    SELECT 1 FROM campaigns c JOIN ticket_types t ON t.event_id = c.event_id
    WHERE c.id = NEW.campaign_id AND t.id = NEW.ticket_type_id
  )), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: scope_campaign_ticket_type');
END;
--> statement-breakpoint

-- A promo names its order's campaign and reservation; completed redemptions cannot also be released.

CREATE TRIGGER `scope_promo_allocation_insert`
BEFORE INSERT ON `promo_allocations`
FOR EACH ROW
WHEN COALESCE((
  NOT (NEW.committed_at IS NOT NULL AND NEW.released_at IS NOT NULL)
  AND EXISTS (
    SELECT 1 FROM orders o
    JOIN reservations r ON r.order_id = o.id AND r.event_id = o.event_id
      AND r.account_id = o.account_id
    JOIN campaigns c ON c.event_id = o.event_id AND c.id = o.campaign_id
    WHERE o.id = NEW.order_id
      AND r.id = NEW.reservation_id
      AND c.id = NEW.campaign_id
  )), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: scope_promo_allocation');
END;
--> statement-breakpoint

CREATE TRIGGER `scope_promo_allocation_update`
BEFORE UPDATE ON `promo_allocations`
FOR EACH ROW
WHEN COALESCE((
  NOT (NEW.committed_at IS NOT NULL AND NEW.released_at IS NOT NULL)
  AND EXISTS (
    SELECT 1 FROM orders o
    JOIN reservations r ON r.order_id = o.id AND r.event_id = o.event_id
      AND r.account_id = o.account_id
    JOIN campaigns c ON c.event_id = o.event_id AND c.id = o.campaign_id
    WHERE o.id = NEW.order_id
      AND r.id = NEW.reservation_id
      AND c.id = NEW.campaign_id
  )), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: scope_promo_allocation');
END;
--> statement-breakpoint

-- Polymorphic payment subjects must exist; ticket payments match the order's snapshotted total/currency.

CREATE TRIGGER `scope_payment_attempt_insert`
BEFORE INSERT ON `payment_attempts`
FOR EACH ROW
WHEN COALESCE((
  NEW.purpose IN ('ticket_order', 'event_activation')
  AND NEW.state IN ('pending', 'succeeded', 'failed', 'cancelled')
  AND NEW.provider IN ('polar_sandbox', 'simulation')
  AND (
    (NEW.purpose = 'ticket_order' AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = NEW.subject_id
        AND o.total_minor = NEW.amount_minor
        AND o.currency = NEW.currency
    ))
    OR (NEW.purpose = 'event_activation' AND EXISTS (
      SELECT 1 FROM events e WHERE e.id = NEW.subject_id
    ))
  )), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: scope_payment_attempt');
END;
--> statement-breakpoint

CREATE TRIGGER `scope_payment_attempt_update`
BEFORE UPDATE ON `payment_attempts`
FOR EACH ROW
WHEN COALESCE((
  NEW.purpose IN ('ticket_order', 'event_activation')
  AND NEW.state IN ('pending', 'succeeded', 'failed', 'cancelled')
  AND NEW.provider IN ('polar_sandbox', 'simulation')
  AND (
    (NEW.purpose = 'ticket_order' AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = NEW.subject_id
        AND o.total_minor = NEW.amount_minor
        AND o.currency = NEW.currency
    ))
    OR (NEW.purpose = 'event_activation' AND EXISTS (
      SELECT 1 FROM events e WHERE e.id = NEW.subject_id
    ))
  )), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: scope_payment_attempt');
END;
--> statement-breakpoint

-- Academic refunds are full-amount, purpose-compatible and identify one refund per provider; admission/eligibility remain transition checks.

CREATE TRIGGER `scope_refund_insert`
BEFORE INSERT ON `refunds`
FOR EACH ROW
WHEN COALESCE((
  NEW.state IN ('pending', 'succeeded', 'failed')
  AND NEW.amount_minor > 0
  AND EXISTS (
    SELECT 1 FROM payment_attempts p
    WHERE p.id = NEW.payment_attempt_id AND p.amount_minor = NEW.amount_minor
      AND (
        (p.purpose = 'ticket_order'
          AND NEW.reason IN ('voluntary', 'event_cancelled', 'technical_compensation'))
        OR (p.purpose = 'event_activation'
          AND NEW.reason IN ('activation_failed', 'technical_compensation'))
      )
      AND (
        NEW.provider_refund_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM refunds other
          JOIN payment_attempts other_payment ON other_payment.id = other.payment_attempt_id
          WHERE other.id <> NEW.id
            AND other.provider_refund_id = NEW.provider_refund_id
            AND other_payment.provider = p.provider
        )
      )
  )), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: scope_refund');
END;
--> statement-breakpoint

CREATE TRIGGER `scope_refund_update`
BEFORE UPDATE ON `refunds`
FOR EACH ROW
WHEN COALESCE((
  NEW.state IN ('pending', 'succeeded', 'failed')
  AND NEW.amount_minor > 0
  AND EXISTS (
    SELECT 1 FROM payment_attempts p
    WHERE p.id = NEW.payment_attempt_id AND p.amount_minor = NEW.amount_minor
      AND (
        (p.purpose = 'ticket_order'
          AND NEW.reason IN ('voluntary', 'event_cancelled', 'technical_compensation'))
        OR (p.purpose = 'event_activation'
          AND NEW.reason IN ('activation_failed', 'technical_compensation'))
      )
      AND (
        NEW.provider_refund_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM refunds other
          JOIN payment_attempts other_payment ON other_payment.id = other.payment_attempt_id
          WHERE other.id <> NEW.id
            AND other.provider_refund_id = NEW.provider_refund_id
            AND other_payment.provider = p.provider
        )
      )
  )), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: scope_refund');
END;
--> statement-breakpoint

-- Ticket order/item/event/type/slot agree; active tickets require current slot ownership, while retired tickets preserve history.

CREATE TRIGGER `scope_ticket_insert`
BEFORE INSERT ON `tickets`
FOR EACH ROW
WHEN COALESCE((
  NEW.state IN ('valid', 'checked_in', 'cancelled', 'refunded')
  AND EXISTS (
    SELECT 1 FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN inventory i ON i.event_id = o.event_id
    JOIN ticket_types tt ON tt.id = oi.ticket_type_id AND tt.event_id = o.event_id
    WHERE o.id = NEW.order_id
      AND oi.id = NEW.order_item_id
      AND oi.ticket_type_id = NEW.ticket_type_id
      AND o.event_id = NEW.event_id
      AND i.id = NEW.inventory_id
      AND i.ticket_type_id = NEW.ticket_type_id
      AND (NEW.state IN ('cancelled', 'refunded') OR i.order_id = NEW.order_id)
  )
  AND CASE WHEN NEW.seat_json IS NULL THEN 1
    WHEN json_valid(NEW.seat_json) THEN json_type(NEW.seat_json) = 'object'
    ELSE 0 END), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: scope_ticket');
END;
--> statement-breakpoint

CREATE TRIGGER `scope_ticket_update`
BEFORE UPDATE ON `tickets`
FOR EACH ROW
WHEN COALESCE((
  NEW.state IN ('valid', 'checked_in', 'cancelled', 'refunded')
  AND EXISTS (
    SELECT 1 FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN inventory i ON i.event_id = o.event_id
    JOIN ticket_types tt ON tt.id = oi.ticket_type_id AND tt.event_id = o.event_id
    WHERE o.id = NEW.order_id
      AND oi.id = NEW.order_item_id
      AND oi.ticket_type_id = NEW.ticket_type_id
      AND o.event_id = NEW.event_id
      AND i.id = NEW.inventory_id
      AND i.ticket_type_id = NEW.ticket_type_id
      AND (NEW.state IN ('cancelled', 'refunded') OR i.order_id = NEW.order_id)
  )
  AND CASE WHEN NEW.seat_json IS NULL THEN 1
    WHEN json_valid(NEW.seat_json) THEN json_type(NEW.seat_json) = 'object'
    ELSE 0 END), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: scope_ticket');
END;
--> statement-breakpoint

-- A reversal records actor, reason and timestamp together without imposing ticket-state write ordering.

CREATE TRIGGER `domain_checkin_insert`
BEFORE INSERT ON `checkins`
FOR EACH ROW
WHEN COALESCE((
  (
    NEW.reversed_at IS NULL AND NEW.reversed_by IS NULL AND NEW.reversal_reason IS NULL
  ) OR (
    NEW.reversed_at IS NOT NULL AND NEW.reversed_by IS NOT NULL
    AND length(trim(NEW.reversal_reason)) > 0
    AND NEW.reversed_at >= NEW.committed_at
  )), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: domain_checkin');
END;
--> statement-breakpoint

CREATE TRIGGER `domain_checkin_update`
BEFORE UPDATE ON `checkins`
FOR EACH ROW
WHEN COALESCE((
  (
    NEW.reversed_at IS NULL AND NEW.reversed_by IS NULL AND NEW.reversal_reason IS NULL
  ) OR (
    NEW.reversed_at IS NOT NULL AND NEW.reversed_by IS NOT NULL
    AND length(trim(NEW.reversal_reason)) > 0
    AND NEW.reversed_at >= NEW.committed_at
  )), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: domain_checkin');
END;
--> statement-breakpoint

-- Event-scoped audit entries retain an event link.

CREATE TRIGGER `domain_audit_insert`
BEFORE INSERT ON `audit_entries`
FOR EACH ROW
WHEN COALESCE((
  NEW.scope IN ('event', 'account', 'platform')
  AND (NEW.scope <> 'event' OR NEW.event_id IS NOT NULL)), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: domain_audit');
END;
--> statement-breakpoint

CREATE TRIGGER `domain_audit_update`
BEFORE UPDATE ON `audit_entries`
FOR EACH ROW
WHEN COALESCE((
  NEW.scope IN ('event', 'account', 'platform')
  AND (NEW.scope <> 'event' OR NEW.event_id IS NOT NULL)), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: domain_audit');
END;
--> statement-breakpoint

-- Outbox payloads are valid JSON and retry counts cannot be negative.

CREATE TRIGGER `domain_outbox_insert`
BEFORE INSERT ON `outbox`
FOR EACH ROW
WHEN COALESCE((
  NEW.attempts >= 0 AND json_valid(NEW.payload_json)), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: domain_outbox');
END;
--> statement-breakpoint

CREATE TRIGGER `domain_outbox_update`
BEFORE UPDATE ON `outbox`
FOR EACH ROW
WHEN COALESCE((
  NEW.attempts >= 0 AND json_valid(NEW.payload_json)), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: domain_outbox');
END;
--> statement-breakpoint

-- Prevent parent-side changes from bypassing child scope guards on events.

CREATE TRIGGER `immutable_events`
BEFORE UPDATE ON `events`
FOR EACH ROW
WHEN (NEW.`id` IS NOT OLD.`id`)
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: immutable_events');
END;
--> statement-breakpoint

-- Prevent parent-side changes from bypassing child scope guards on ticket_types.

CREATE TRIGGER `immutable_ticket_types`
BEFORE UPDATE ON `ticket_types`
FOR EACH ROW
WHEN (NEW.`id` IS NOT OLD.`id` OR NEW.`event_id` IS NOT OLD.`event_id`)
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: immutable_ticket_types');
END;
--> statement-breakpoint

-- Prevent parent-side changes from bypassing child scope guards on campaigns.

CREATE TRIGGER `immutable_campaigns`
BEFORE UPDATE ON `campaigns`
FOR EACH ROW
WHEN (NEW.`id` IS NOT OLD.`id` OR NEW.`event_id` IS NOT OLD.`event_id`)
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: immutable_campaigns');
END;
--> statement-breakpoint

-- Prevent parent-side changes from bypassing child scope guards on orders.

CREATE TRIGGER `immutable_orders`
BEFORE UPDATE ON `orders`
FOR EACH ROW
WHEN (NEW.`id` IS NOT OLD.`id` OR NEW.`account_id` IS NOT OLD.`account_id` OR NEW.`event_id` IS NOT OLD.`event_id`)
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: immutable_orders');
END;
--> statement-breakpoint

-- Reservation identity and original deadline survive checkout edits and retries.

CREATE TRIGGER `immutable_reservations`
BEFORE UPDATE ON `reservations`
FOR EACH ROW
WHEN (NEW.`id` IS NOT OLD.`id` OR NEW.`order_id` IS NOT OLD.`order_id` OR NEW.`account_id` IS NOT OLD.`account_id` OR NEW.`event_id` IS NOT OLD.`event_id` OR NEW.`created_at` IS NOT OLD.`created_at` OR NEW.`expires_at` IS NOT OLD.`expires_at`)
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: immutable_reservations');
END;
--> statement-breakpoint

-- Prevent parent-side changes from bypassing child scope guards on inventory.

CREATE TRIGGER `immutable_inventory`
BEFORE UPDATE ON `inventory`
FOR EACH ROW
WHEN (NEW.`id` IS NOT OLD.`id` OR NEW.`event_id` IS NOT OLD.`event_id`)
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: immutable_inventory');
END;
--> statement-breakpoint

-- Prevent parent-side changes from bypassing child scope guards on order_items.

CREATE TRIGGER `immutable_order_items`
BEFORE UPDATE ON `order_items`
FOR EACH ROW
WHEN (NEW.`id` IS NOT OLD.`id` OR NEW.`order_id` IS NOT OLD.`order_id` OR NEW.`ticket_type_id` IS NOT OLD.`ticket_type_id`)
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: immutable_order_items');
END;
--> statement-breakpoint

-- Prevent parent-side changes from bypassing child scope guards on payment_attempts.

CREATE TRIGGER `immutable_payment_attempts`
BEFORE UPDATE ON `payment_attempts`
FOR EACH ROW
WHEN (NEW.`id` IS NOT OLD.`id` OR NEW.`purpose` IS NOT OLD.`purpose` OR NEW.`subject_id` IS NOT OLD.`subject_id` OR NEW.`provider` IS NOT OLD.`provider` OR NEW.`amount_minor` IS NOT OLD.`amount_minor` OR NEW.`currency` IS NOT OLD.`currency` OR NEW.`idempotency_key` IS NOT OLD.`idempotency_key`)
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: immutable_payment_attempts');
END;
--> statement-breakpoint

-- Prevent parent-side changes from bypassing child scope guards on refunds.

CREATE TRIGGER `immutable_refunds`
BEFORE UPDATE ON `refunds`
FOR EACH ROW
WHEN (NEW.`id` IS NOT OLD.`id` OR NEW.`payment_attempt_id` IS NOT OLD.`payment_attempt_id` OR NEW.`amount_minor` IS NOT OLD.`amount_minor` OR NEW.`reason` IS NOT OLD.`reason`)
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: immutable_refunds');
END;
--> statement-breakpoint

-- Prevent parent-side changes from bypassing child scope guards on tickets.

CREATE TRIGGER `immutable_tickets`
BEFORE UPDATE ON `tickets`
FOR EACH ROW
WHEN (NEW.`id` IS NOT OLD.`id` OR NEW.`order_id` IS NOT OLD.`order_id` OR NEW.`order_item_id` IS NOT OLD.`order_item_id` OR NEW.`inventory_id` IS NOT OLD.`inventory_id` OR NEW.`event_id` IS NOT OLD.`event_id` OR NEW.`ticket_type_id` IS NOT OLD.`ticket_type_id`)
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: immutable_tickets');
END;
--> statement-breakpoint

-- Prevent parent-side changes from bypassing child scope guards on checkins.

CREATE TRIGGER `immutable_checkins`
BEFORE UPDATE ON `checkins`
FOR EACH ROW
WHEN (NEW.`id` IS NOT OLD.`id` OR NEW.`ticket_id` IS NOT OLD.`ticket_id` OR NEW.`actor_id` IS NOT OLD.`actor_id` OR NEW.`operation_id` IS NOT OLD.`operation_id` OR NEW.`captured_at` IS NOT OLD.`captured_at` OR NEW.`committed_at` IS NOT OLD.`committed_at`)
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: immutable_checkins');
END;
--> statement-breakpoint

-- Historical ticket snapshots must not be reassigned to a different type or physical seat.

CREATE TRIGGER `inventory_historical_assignment`
BEFORE UPDATE ON `inventory`
FOR EACH ROW
WHEN (
  NEW.ticket_type_id IS NOT OLD.ticket_type_id
  OR NEW.section IS NOT OLD.section
  OR NEW.row IS NOT OLD.row
  OR NEW.number IS NOT OLD.number
) AND EXISTS (SELECT 1 FROM tickets t WHERE t.inventory_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: inventory_historical_assignment');
END;
--> statement-breakpoint

-- A referenced item keeps its purchased data; pending checkouts may edit before payment starts.

CREATE TRIGGER `order_item_snapshot_frozen`
BEFORE UPDATE ON `order_items`
FOR EACH ROW
WHEN (
  NEW.ticket_type_name IS NOT OLD.ticket_type_name
  OR NEW.quantity IS NOT OLD.quantity
  OR NEW.unit_price_minor IS NOT OLD.unit_price_minor
  OR NEW.subtotal_minor IS NOT OLD.subtotal_minor
  OR NEW.discount_minor IS NOT OLD.discount_minor
  OR NEW.total_minor IS NOT OLD.total_minor
  OR NEW.attendees_json IS NOT OLD.attendees_json
  OR NEW.seats_json IS NOT OLD.seats_json
) AND (
  EXISTS (SELECT 1 FROM tickets t WHERE t.order_item_id = OLD.id)
  OR EXISTS (SELECT 1 FROM payment_attempts p WHERE p.purpose = 'ticket_order' AND p.subject_id = OLD.order_id)
)
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: order_item_snapshot_frozen');
END;
--> statement-breakpoint

-- A committed promo remains consumed even after order cancellation/refund.

CREATE TRIGGER `promo_committed_immutable`
BEFORE UPDATE ON `promo_allocations`
FOR EACH ROW
WHEN OLD.committed_at IS NOT NULL AND (
  NEW.order_id IS NOT OLD.order_id
  OR NEW.campaign_id IS NOT OLD.campaign_id
  OR NEW.reservation_id IS NOT OLD.reservation_id
  OR NEW.committed_at IS NOT OLD.committed_at
  OR NEW.released_at IS NOT OLD.released_at
)
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: promo_committed_immutable');
END;
--> statement-breakpoint

-- Price and policy snapshots freeze after payment starts or tickets are issued.
-- State/completion/admission columns remain mutable for atomic transitions.
CREATE TRIGGER `order_snapshot_frozen`
BEFORE UPDATE ON `orders`
FOR EACH ROW
WHEN (
  NEW.currency IS NOT OLD.currency
  OR NEW.subtotal_minor IS NOT OLD.subtotal_minor
  OR NEW.discount_minor IS NOT OLD.discount_minor
  OR NEW.total_minor IS NOT OLD.total_minor
  OR NEW.processing_fee_basis_points IS NOT OLD.processing_fee_basis_points
  OR NEW.processing_fee_minor IS NOT OLD.processing_fee_minor
  OR NEW.campaign_id IS NOT OLD.campaign_id
  OR NEW.refund_policy_version IS NOT OLD.refund_policy_version
) AND (
  OLD.state IN ('completed', 'cancelled', 'refunded')
  OR EXISTS (
    SELECT 1 FROM payment_attempts p
    WHERE p.purpose = 'ticket_order' AND p.subject_id = OLD.id
  )
  OR EXISTS (SELECT 1 FROM tickets t WHERE t.order_id = OLD.id)
)
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: order_snapshot_frozen');
END;
--> statement-breakpoint

-- These polymorphic payment references cannot be represented by ordinary FKs.
-- Retention must delete/refund payment children before deleting their subject.
CREATE TRIGGER `order_payment_subject_delete`
BEFORE DELETE ON `orders`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM payment_attempts p
  WHERE p.purpose = 'ticket_order' AND p.subject_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: order_payment_subject_delete');
END;
--> statement-breakpoint

CREATE TRIGGER `event_payment_subject_delete`
BEFORE DELETE ON `events`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM payment_attempts p
  WHERE p.purpose = 'event_activation' AND p.subject_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: event_payment_subject_delete');
END;
--> statement-breakpoint

-- Appending or deleting a row must not bypass the item UPDATE snapshot guard.
-- Retention removes ticket/refund/payment children before deleting order items.
CREATE TRIGGER `order_item_frozen_insert`
BEFORE INSERT ON `order_items`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM payment_attempts p
  WHERE p.purpose = 'ticket_order' AND p.subject_id = NEW.order_id
) OR EXISTS (SELECT 1 FROM tickets t WHERE t.order_id = NEW.order_id)
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: order_item_frozen_insert');
END;
--> statement-breakpoint

CREATE TRIGGER `order_item_frozen_delete`
BEFORE DELETE ON `order_items`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM payment_attempts p
  WHERE p.purpose = 'ticket_order' AND p.subject_id = OLD.order_id
) OR EXISTS (SELECT 1 FROM tickets t WHERE t.order_id = OLD.order_id)
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: order_item_frozen_delete');
END;
--> statement-breakpoint
