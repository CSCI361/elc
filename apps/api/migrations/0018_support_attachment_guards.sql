-- Custom SQL migration file, put your code below! --
-- Every object begins as an unlinked quarantine record before R2 receives bytes.
CREATE TRIGGER support_attachment_insert_guard BEFORE INSERT ON support_attachments
WHEN NEW.status <> 'quarantined' OR NEW.message_id IS NOT NULL OR NEW.position IS NOT NULL
  OR NEW.content_type IS NOT NULL OR NEW.content_size IS NOT NULL OR NEW.content_sha256 IS NOT NULL
  OR NEW.validated_at IS NOT NULL OR NEW.attached_at IS NOT NULL OR NEW.deleted_at IS NOT NULL
  OR NEW.rejection_code IS NOT NULL OR NEW.cleanup_after IS NULL
BEGIN SELECT RAISE(ABORT, 'support attachment must begin in quarantine'); END;
--> statement-breakpoint
-- File identity, original bytes and object keys cannot be replaced under an existing ID.
CREATE TRIGGER support_attachment_identity_guard BEFORE UPDATE ON support_attachments
WHEN NEW.id IS NOT OLD.id OR NEW.case_id IS NOT OLD.case_id OR NEW.uploader_id IS NOT OLD.uploader_id
  OR NEW.upload_request_id IS NOT OLD.upload_request_id OR NEW.input_hash IS NOT OLD.input_hash
  OR NEW.safe_filename IS NOT OLD.safe_filename OR NEW.declared_type IS NOT OLD.declared_type
  OR NEW.original_size IS NOT OLD.original_size OR NEW.original_sha256 IS NOT OLD.original_sha256
  OR NEW.quarantine_key IS NOT OLD.quarantine_key OR NEW.object_key IS NOT OLD.object_key
  OR NEW.validator_version IS NOT OLD.validator_version OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
BEGIN SELECT RAISE(ABORT, 'support attachment identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER support_attachment_transition_guard BEFORE UPDATE ON support_attachments
WHEN NOT (NEW.status = OLD.status
  OR (OLD.status = 'quarantined' AND NEW.status IN ('ready','rejected','deleting'))
  OR (OLD.status = 'ready' AND NEW.status IN ('attached','deleting'))
  OR (OLD.status = 'rejected' AND NEW.status = 'deleting')
  OR (OLD.status = 'deleting' AND NEW.status = 'deleted'))
BEGIN SELECT RAISE(ABORT, 'invalid support attachment transition'); END;
--> statement-breakpoint
-- A validation result is written once; a linked attachment cannot be detached or changed.
CREATE TRIGGER support_attachment_content_guard BEFORE UPDATE ON support_attachments
WHEN (NOT (OLD.status = 'quarantined' AND NEW.status = 'ready') AND (
    NEW.content_type IS NOT OLD.content_type OR NEW.content_size IS NOT OLD.content_size
    OR NEW.content_sha256 IS NOT OLD.content_sha256 OR NEW.validated_at IS NOT OLD.validated_at))
  OR (OLD.status = 'attached' AND (NEW.status IS NOT OLD.status OR NEW.message_id IS NOT OLD.message_id
    OR NEW.position IS NOT OLD.position OR NEW.attached_at IS NOT OLD.attached_at))
  OR (NEW.rejection_code IS NOT OLD.rejection_code AND NOT (OLD.status = 'quarantined' AND NEW.status = 'rejected'))
BEGIN SELECT RAISE(ABORT, 'support attachment content is immutable'); END;
--> statement-breakpoint
-- Link only while inserting a new canonical message, before its change/outbox/receipt.
-- This prevents adding files to already committed immutable message history.
CREATE TRIGGER support_attachment_message_guard BEFORE UPDATE ON support_attachments
WHEN NEW.status = 'attached' AND OLD.status <> 'attached' AND (
  OLD.status <> 'ready' OR NEW.attached_at >= NEW.expires_at OR NEW.attached_at < NEW.validated_at
  OR NOT EXISTS (SELECT 1 FROM support_messages m JOIN support_cases c ON c.id = m.case_id
    WHERE m.id = NEW.message_id AND m.case_id = NEW.case_id AND m.author_id = NEW.uploader_id
      AND m.created_at = NEW.attached_at AND c.last_sequence = m.sequence AND c.status <> 'resolved')
  OR EXISTS (SELECT 1 FROM support_case_changes WHERE message_id = NEW.message_id)
  OR (SELECT count(*) FROM support_attachments WHERE message_id = NEW.message_id AND id <> NEW.id) >= 3)
BEGIN SELECT RAISE(ABORT, 'support attachment message scope is invalid'); END;

--> statement-breakpoint
-- A released object was validated during this upload's finite quarantine window.
CREATE TRIGGER support_attachment_validation_time_guard BEFORE UPDATE ON support_attachments
WHEN OLD.status = 'quarantined' AND NEW.status = 'ready' AND
  (NEW.validated_at < NEW.created_at OR NEW.validated_at >= NEW.expires_at)
BEGIN SELECT RAISE(ABORT, 'support attachment validation window is invalid'); END;
