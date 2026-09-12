CREATE TRIGGER `order_policy_snapshot_insert`
BEFORE INSERT ON `orders`
WHEN NEW.revision < 0 OR typeof(NEW.revision) <> 'integer'
  OR NOT json_valid(NEW.refund_policy_json)
  OR json_type(NEW.refund_policy_json) IS NOT 'object'
  OR json_extract(NEW.refund_policy_json, '$.version') IS NOT NEW.refund_policy_version
  OR json_type(NEW.refund_policy_json, '$.instructions') IS NOT 'text'
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: order_policy_snapshot');
END;
--> statement-breakpoint
CREATE TRIGGER `order_policy_snapshot_update`
BEFORE UPDATE ON `orders`
WHEN NEW.revision < OLD.revision OR typeof(NEW.revision) <> 'integer'
  OR NOT json_valid(NEW.refund_policy_json)
  OR json_type(NEW.refund_policy_json) IS NOT 'object'
  OR json_extract(NEW.refund_policy_json, '$.version') IS NOT NEW.refund_policy_version
  OR json_type(NEW.refund_policy_json, '$.instructions') IS NOT 'text'
  OR (NEW.refund_policy_json IS NOT OLD.refund_policy_json AND (
    OLD.state <> 'pending'
    OR EXISTS (SELECT 1 FROM payment_attempts WHERE purpose = 'ticket_order' AND subject_id = OLD.id)
    OR EXISTS (SELECT 1 FROM tickets WHERE order_id = OLD.id)
  ))
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: order_policy_snapshot');
END;
--> statement-breakpoint
CREATE TRIGGER `event_revision_insert`
BEFORE INSERT ON `events`
WHEN NEW.revision < 0 OR typeof(NEW.revision) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: event_revision');
END;
--> statement-breakpoint
CREATE TRIGGER `event_revision_update`
BEFORE UPDATE ON `events`
WHEN NEW.revision < OLD.revision OR typeof(NEW.revision) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'ELC invariant: event_revision');
END;
