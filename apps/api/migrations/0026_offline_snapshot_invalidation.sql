ALTER TABLE `offline_snapshots` ADD `invalidated_at` integer;
--> statement-breakpoint
CREATE TRIGGER offline_snapshot_invalidation_insert BEFORE INSERT ON offline_snapshots
WHEN NEW.invalidated_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'ELC invariant: offline_snapshot_invalidation'); END;
--> statement-breakpoint
CREATE TRIGGER offline_snapshot_invalidation_update BEFORE UPDATE OF invalidated_at ON offline_snapshots
WHEN (OLD.invalidated_at IS NOT NULL AND NEW.invalidated_at IS NOT OLD.invalidated_at)
  OR (NEW.invalidated_at IS NOT NULL AND NEW.invalidated_at < NEW.issued_at)
BEGIN SELECT RAISE(ABORT, 'ELC invariant: offline_snapshot_invalidation'); END;
