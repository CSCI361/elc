CREATE TRIGGER offline_device_scope_insert BEFORE INSERT ON offline_devices
WHEN NEW.revision <> 0 OR NEW.revoked_at IS NOT NULL OR NEW.revoked_by IS NOT NULL
  OR NEW.revocation_reason IS NOT NULL OR NEW.loss_reported <> 0 OR NEW.last_sync_at IS NOT NULL
  OR length(trim(NEW.label)) NOT BETWEEN 1 AND 100
  OR NOT EXISTS (SELECT 1 FROM user u LEFT JOIN profiles p ON p.user_id = u.id JOIN event_permissions ep ON ep.user_id = u.id
    WHERE u.id = NEW.account_id AND u.email_verified = 1 AND p.suspended_at IS NULL AND ep.event_id = NEW.event_id AND ep.permission = 'ticket:scan' AND ep.revoked_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'ELC invariant: offline_device_scope'); END;
--> statement-breakpoint
CREATE TRIGGER offline_device_immutable_update BEFORE UPDATE ON offline_devices
WHEN NEW.id IS NOT OLD.id OR NEW.account_id IS NOT OLD.account_id OR NEW.event_id IS NOT OLD.event_id
  OR NEW.label IS NOT OLD.label OR NEW.registered_at IS NOT OLD.registered_at
  OR (OLD.last_sync_at IS NOT NULL AND (NEW.last_sync_at IS NULL OR NEW.last_sync_at < OLD.last_sync_at))
  OR (OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS NOT OLD.revoked_at OR NEW.revoked_by IS NOT OLD.revoked_by OR NEW.revocation_reason IS NOT OLD.revocation_reason OR NEW.loss_reported IS NOT OLD.loss_reported))
  OR (NEW.revoked_at IS OLD.revoked_at AND NEW.revision <> OLD.revision)
  OR (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL AND (NEW.revision <> OLD.revision + 1 OR NEW.revoked_at < NEW.registered_at OR NEW.revoked_by IS NULL OR NEW.revocation_reason IS NULL OR length(trim(NEW.revocation_reason)) NOT BETWEEN 1 AND 500))
BEGIN SELECT RAISE(ABORT, 'ELC invariant: offline_device_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER offline_snapshot_scope_insert BEFORE INSERT ON offline_snapshots
WHEN NEW.manifest_json IS NOT NULL OR NEW.expires_at <= NEW.issued_at OR NEW.expires_at > NEW.issued_at + 14400000
  OR NEW.expires_at > NEW.event_ends_at + 7200000 OR NEW.ticket_count < 0
  OR NOT EXISTS (SELECT 1 FROM offline_devices d JOIN events e ON e.id = d.event_id
    WHERE d.id = NEW.device_id AND d.account_id = NEW.account_id AND d.event_id = NEW.event_id AND d.revoked_at IS NULL
      AND e.cancelled_at IS NULL AND e.suspended_at IS NULL AND e.ends_at = NEW.event_ends_at
      AND NEW.ticket_count = (SELECT count(*) FROM tickets WHERE event_id = e.id))
BEGIN SELECT RAISE(ABORT, 'ELC invariant: offline_snapshot_scope'); END;
--> statement-breakpoint
CREATE TRIGGER offline_snapshot_immutable_update BEFORE UPDATE ON offline_snapshots
WHEN NEW.id IS NOT OLD.id OR NEW.account_id IS NOT OLD.account_id OR NEW.device_id IS NOT OLD.device_id
  OR NEW.event_id IS NOT OLD.event_id OR NEW.issued_at IS NOT OLD.issued_at OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.event_ends_at IS NOT OLD.event_ends_at OR NEW.ticket_count IS NOT OLD.ticket_count OR NEW.key_id IS NOT OLD.key_id
  OR (OLD.manifest_json IS NOT NULL AND NEW.manifest_json IS NOT OLD.manifest_json)
  OR (NEW.manifest_json IS NOT NULL AND (NOT json_valid(NEW.manifest_json)
    OR json_extract(NEW.manifest_json, '$.snapshotId') IS NOT NEW.id
    OR json_extract(NEW.manifest_json, '$.keyId') IS NOT NEW.key_id
    OR json_extract(NEW.manifest_json, '$.ticketCount') IS NOT NEW.ticket_count
    OR NEW.ticket_count <> (SELECT count(*) FROM offline_snapshot_tickets WHERE snapshot_id = NEW.id)))
BEGIN SELECT RAISE(ABORT, 'ELC invariant: offline_snapshot_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER offline_snapshot_ticket_insert BEFORE INSERT ON offline_snapshot_tickets
WHEN NEW.ordinal < 0 OR NOT json_valid(NEW.payload_json)
  OR json_extract(NEW.payload_json, '$.ticketId') IS NOT NEW.ticket_id OR json_extract(NEW.payload_json, '$.tokenHash') IS NOT NEW.token_hash
  OR NOT EXISTS (SELECT 1 FROM offline_snapshots s JOIN tickets t ON t.event_id = s.event_id
    WHERE s.id = NEW.snapshot_id AND s.manifest_json IS NULL AND t.id = NEW.ticket_id AND t.token_hash = NEW.token_hash AND NEW.ordinal < s.ticket_count)
BEGIN SELECT RAISE(ABORT, 'ELC invariant: offline_snapshot_ticket_scope'); END;
--> statement-breakpoint
CREATE TRIGGER offline_snapshot_ticket_immutable BEFORE UPDATE ON offline_snapshot_tickets
BEGIN SELECT RAISE(ABORT, 'ELC invariant: offline_snapshot_ticket_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER offline_operation_scope_insert BEFORE INSERT ON offline_operations
WHEN NEW.kind NOT IN ('scan', 'undo') OR NEW.device_sequence <= 0
  OR NEW.result NOT IN ('checked_in', 'invalid', 'wrong_event', 'cancelled', 'refunded', 'already_used', 'admission_blocked', 'forbidden', 'snapshot_expired', 'locally_reversed')
  OR NOT EXISTS (SELECT 1 FROM offline_devices WHERE id = NEW.device_id AND account_id = NEW.account_id AND event_id = NEW.event_id)
  OR (NEW.ticket_id IS NULL) <> (NEW.order_id IS NULL)
  OR (NEW.ticket_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tickets WHERE id = NEW.ticket_id AND order_id = NEW.order_id AND event_id = NEW.event_id))
  OR (NEW.kind = 'scan' AND NEW.original_operation_id IS NOT NULL)
  OR (NEW.kind = 'undo' AND (NEW.result <> 'locally_reversed' OR NEW.checkin_id IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM offline_operations op WHERE op.operation_id = NEW.original_operation_id AND op.kind = 'scan' AND op.result = 'locally_reversed'
      AND op.device_id = NEW.device_id AND op.account_id = NEW.account_id AND op.event_id = NEW.event_id AND op.snapshot_id = NEW.snapshot_id
      AND op.unit_hash = NEW.unit_hash AND op.device_sequence < NEW.device_sequence AND op.captured_at <= NEW.captured_at)))
  OR (NEW.result = 'checked_in' AND (NEW.kind <> 'scan' OR NEW.checkin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM checkins ci JOIN tickets t ON t.id = ci.ticket_id JOIN orders o ON o.id = t.order_id JOIN events e ON e.id = t.event_id
    WHERE ci.id = NEW.checkin_id AND ci.ticket_id = NEW.ticket_id AND ci.actor_id = NEW.account_id AND ci.operation_id = NEW.operation_id
      AND ci.device_id = NEW.device_id AND ci.captured_at = NEW.captured_at AND ci.committed_at = NEW.reported_at AND ci.reversed_at IS NULL
      AND t.state = 'checked_in' AND o.state = 'completed' AND o.admission_blocked_at IS NULL AND e.cancelled_at IS NULL AND e.suspended_at IS NULL)))
  OR (NEW.result <> 'checked_in' AND NEW.checkin_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ELC invariant: offline_operation_scope'); END;
--> statement-breakpoint
CREATE TRIGGER offline_operation_immutable BEFORE UPDATE ON offline_operations
BEGIN SELECT RAISE(ABORT, 'ELC invariant: offline_operation_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER offline_report_scope_insert BEFORE INSERT ON offline_admission_reports
WHEN NEW.review_state <> 'unresolved' OR NEW.revision <> 0 OR NEW.resolution IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.reviewed_by IS NOT NULL OR NEW.reason IS NOT NULL
  OR NOT EXISTS (SELECT 1 FROM offline_operations op WHERE op.operation_id = NEW.operation_id AND op.kind = 'scan' AND op.result NOT IN ('checked_in', 'locally_reversed') AND op.ticket_id = NEW.ticket_id AND op.order_id = NEW.order_id)
BEGIN SELECT RAISE(ABORT, 'ELC invariant: offline_report_scope'); END;
--> statement-breakpoint
CREATE TRIGGER offline_report_review_update BEFORE UPDATE ON offline_admission_reports
WHEN NEW.operation_id IS NOT OLD.operation_id OR NEW.order_id IS NOT OLD.order_id OR NEW.ticket_id IS NOT OLD.ticket_id
  OR OLD.review_state <> 'unresolved' OR NEW.review_state <> 'resolved' OR NEW.revision <> OLD.revision + 1
  OR NEW.resolution NOT IN ('no_admission', 'admission_confirmed') OR NEW.resolution IS NULL
  OR NEW.reviewed_at IS NULL OR NEW.reviewed_by IS NULL OR NEW.reason IS NULL OR length(trim(NEW.reason)) NOT BETWEEN 1 AND 500
  OR NOT EXISTS (SELECT 1 FROM offline_operations op JOIN events e ON e.id = op.event_id JOIN user u ON u.id = NEW.reviewed_by LEFT JOIN profiles p ON p.user_id = u.id
    WHERE op.operation_id = NEW.operation_id AND NEW.reviewed_at >= op.reported_at AND u.email_verified = 1 AND p.suspended_at IS NULL
      AND (e.organizer_id = u.id OR EXISTS (SELECT 1 FROM event_permissions ep WHERE ep.user_id = u.id AND ep.event_id = e.id AND ep.permission = 'checkin:review' AND ep.revoked_at IS NULL)))
BEGIN SELECT RAISE(ABORT, 'ELC invariant: offline_report_review'); END;
--> statement-breakpoint
CREATE TRIGGER offline_review_scope_insert BEFORE INSERT ON offline_admission_reviews
WHEN NOT EXISTS (SELECT 1 FROM offline_admission_reports r WHERE r.operation_id = NEW.operation_id AND r.review_state = 'resolved'
  AND r.resolution = NEW.resolution AND r.reason = NEW.reason AND r.reviewed_by = NEW.actor_id AND r.reviewed_at = NEW.created_at)
  OR (NEW.resolution = 'no_admission' AND NEW.checkin_id IS NOT NULL)
  OR (NEW.resolution = 'admission_confirmed' AND (NEW.checkin_id IS NULL OR NOT EXISTS (SELECT 1 FROM checkins ci JOIN offline_admission_reports r ON r.ticket_id = ci.ticket_id WHERE r.operation_id = NEW.operation_id AND ci.id = NEW.checkin_id AND ci.reversed_at IS NULL)))
BEGIN SELECT RAISE(ABORT, 'ELC invariant: offline_review_scope'); END;
--> statement-breakpoint
CREATE TRIGGER offline_review_immutable BEFORE UPDATE ON offline_admission_reviews
BEGIN SELECT RAISE(ABORT, 'ELC invariant: offline_review_immutable'); END;
