-- Custom SQL migration file, put your code below! --
-- Context is fixed at creation. An attendee owns linked orders; a platform requester owns the event.
CREATE TRIGGER support_case_scope_insert BEFORE INSERT ON support_cases
WHEN NEW.status <> 'open' OR NEW.revision <> 1 OR NEW.last_sequence <> 1
  OR NEW.assignee_id IS NOT NULL OR NEW.updated_at <> NEW.created_at
  OR (NEW.audience = 'organizer_platform' AND NEW.event_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM events e WHERE e.id = NEW.event_id AND e.organizer_id = NEW.requester_id))
  OR (NEW.order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.id = NEW.order_id AND o.event_id = NEW.event_id
      AND (NEW.audience <> 'attendee' OR o.account_id = NEW.requester_id)))
  OR (NEW.ticket_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tickets t WHERE t.id = NEW.ticket_id AND t.order_id = NEW.order_id AND t.event_id = NEW.event_id))
BEGIN SELECT RAISE(ABORT, 'ELC invariant: support_case_scope'); END;
--> statement-breakpoint
-- Advance the case first inside a batch, then append its message/change/audit/outbox/receipt.
-- A later transition cannot skip a missing previous history record.
CREATE TRIGGER support_case_immutable_update BEFORE UPDATE ON support_cases
WHEN NEW.id IS NOT OLD.id OR NEW.requester_id IS NOT OLD.requester_id
  OR NEW.audience IS NOT OLD.audience OR NEW.category IS NOT OLD.category
  OR NEW.subject IS NOT OLD.subject OR NEW.event_id IS NOT OLD.event_id
  OR NEW.order_id IS NOT OLD.order_id OR NEW.ticket_id IS NOT OLD.ticket_id
  OR NEW.created_at IS NOT OLD.created_at OR NEW.revision <> OLD.revision + 1
  OR NEW.last_sequence <> OLD.last_sequence + 1 OR NEW.updated_at < OLD.updated_at
  OR NOT EXISTS (SELECT 1 FROM support_case_changes ch WHERE ch.case_id = OLD.id AND ch.sequence = OLD.last_sequence)
BEGIN SELECT RAISE(ABORT, 'ELC invariant: support_case_immutable'); END;
--> statement-breakpoint
-- Assignment does not grant access. A new assignee must already be active authorized support staff.
CREATE TRIGGER support_case_assignee_update BEFORE UPDATE ON support_cases
WHEN NEW.assignee_id IS NOT OLD.assignee_id AND NEW.assignee_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM user u LEFT JOIN profiles p ON p.user_id = u.id
    WHERE u.id = NEW.assignee_id AND u.email_verified = 1 AND p.suspended_at IS NULL AND (
      EXISTS (SELECT 1 FROM platform_grants g WHERE g.user_id = u.id AND g.permission IN ('platform:support', 'platform:moderate'))
      OR (NEW.audience = 'attendee' AND (
        EXISTS (SELECT 1 FROM events e WHERE e.id = NEW.event_id AND e.organizer_id = u.id)
        OR EXISTS (SELECT 1 FROM event_permissions ep WHERE ep.event_id = NEW.event_id AND ep.user_id = u.id AND ep.permission = 'support:manage' AND ep.revoked_at IS NULL)
      ))
    )
  )
BEGIN SELECT RAISE(ABORT, 'ELC invariant: support_assignee'); END;
--> statement-breakpoint
-- Messages must occupy the current sequence and use an account authorized at insertion.
CREATE TRIGGER support_message_scope_insert BEFORE INSERT ON support_messages
WHEN NOT EXISTS (
  SELECT 1 FROM support_cases c JOIN user u ON u.id = NEW.author_id
  LEFT JOIN profiles p ON p.user_id = u.id
  WHERE c.id = NEW.case_id AND c.last_sequence = NEW.sequence AND c.updated_at = NEW.created_at
    AND c.status <> 'resolved' AND u.email_verified = 1 AND p.suspended_at IS NULL AND (
      c.requester_id = u.id
      OR EXISTS (SELECT 1 FROM platform_grants g WHERE g.user_id = u.id AND g.permission IN ('platform:support', 'platform:moderate'))
      OR (c.audience = 'attendee' AND (
        EXISTS (SELECT 1 FROM events e WHERE e.id = c.event_id AND e.organizer_id = u.id)
        OR EXISTS (SELECT 1 FROM event_permissions ep WHERE ep.event_id = c.event_id AND ep.user_id = u.id AND ep.permission = 'support:manage' AND ep.revoked_at IS NULL)
      ))
    )
)
BEGIN SELECT RAISE(ABORT, 'ELC invariant: support_message_scope'); END;
--> statement-breakpoint
CREATE TRIGGER support_message_immutable_update BEFORE UPDATE ON support_messages
BEGIN SELECT RAISE(ABORT, 'ELC invariant: support_message_immutable'); END;
--> statement-breakpoint
-- One ordered change records each mutation. Snapshots and message ownership must agree with the case.
CREATE TRIGGER support_change_scope_insert BEFORE INSERT ON support_case_changes
WHEN NOT EXISTS (
  SELECT 1 FROM support_cases c WHERE c.id = NEW.case_id AND c.last_sequence = NEW.sequence
    AND c.updated_at = NEW.created_at
    AND json_extract(NEW.after_json, '$.status') IS c.status
    AND json_extract(NEW.after_json, '$.assigneeId') IS c.assignee_id
    AND ((NEW.kind = 'created' AND NEW.sequence = 1 AND NEW.actor_id = c.requester_id AND NEW.before_json = '{}')
      OR (NEW.kind <> 'created' AND NEW.sequence > 1 AND EXISTS (
        SELECT 1 FROM support_case_changes previous WHERE previous.case_id = c.id AND previous.sequence = NEW.sequence - 1
          AND json_extract(previous.after_json, '$.status') IS json_extract(NEW.before_json, '$.status')
          AND json_extract(previous.after_json, '$.assigneeId') IS json_extract(NEW.before_json, '$.assigneeId')
      )))
    AND (NEW.message_id IS NULL OR EXISTS (
      SELECT 1 FROM support_messages m WHERE m.id = NEW.message_id AND m.case_id = c.id
        AND m.sequence = NEW.sequence AND m.author_id = NEW.actor_id AND m.created_at = NEW.created_at
    ))
    AND (NEW.kind <> 'message' OR NEW.before_json = NEW.after_json)
    AND (NEW.kind <> 'assignment' OR (
      json_extract(NEW.before_json, '$.status') IS json_extract(NEW.after_json, '$.status')
      AND json_extract(NEW.before_json, '$.assigneeId') IS NOT json_extract(NEW.after_json, '$.assigneeId')))
    AND (NEW.kind <> 'status' OR (
      json_extract(NEW.before_json, '$.assigneeId') IS json_extract(NEW.after_json, '$.assigneeId')
      AND json_extract(NEW.before_json, '$.status') IS NOT json_extract(NEW.after_json, '$.status')))
)
BEGIN SELECT RAISE(ABORT, 'ELC invariant: support_change_scope'); END;
--> statement-breakpoint
-- Only current staff may change status or assignment; requester participation alone is insufficient.
CREATE TRIGGER support_change_staff_insert BEFORE INSERT ON support_case_changes
WHEN NEW.kind IN ('assignment', 'status') AND NOT EXISTS (
  SELECT 1 FROM support_cases c JOIN user u ON u.id = NEW.actor_id
  LEFT JOIN profiles p ON p.user_id = u.id
  WHERE c.id = NEW.case_id AND u.email_verified = 1 AND p.suspended_at IS NULL AND (
    EXISTS (SELECT 1 FROM platform_grants g WHERE g.user_id = u.id AND g.permission IN ('platform:support', 'platform:moderate'))
    OR (c.audience = 'attendee' AND (
      EXISTS (SELECT 1 FROM events e WHERE e.id = c.event_id AND e.organizer_id = u.id)
      OR EXISTS (SELECT 1 FROM event_permissions ep WHERE ep.event_id = c.event_id AND ep.user_id = u.id AND ep.permission = 'support:manage' AND ep.revoked_at IS NULL)
    ))
  )
)
BEGIN SELECT RAISE(ABORT, 'ELC invariant: support_change_staff'); END;
--> statement-breakpoint
CREATE TRIGGER support_change_immutable_update BEFORE UPDATE ON support_case_changes
BEGIN SELECT RAISE(ABORT, 'ELC invariant: support_change_immutable'); END;
--> statement-breakpoint
-- Support audit entries contain generic descriptions, never message bodies or private case subjects.
CREATE TRIGGER support_audit_immutable_update BEFORE UPDATE ON audit_entries
WHEN OLD.action LIKE 'support.%'
BEGIN SELECT RAISE(ABORT, 'ELC invariant: support_audit_immutable'); END;
