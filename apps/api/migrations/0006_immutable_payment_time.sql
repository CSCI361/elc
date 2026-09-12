CREATE TRIGGER immutable_payment_time BEFORE UPDATE ON payment_attempts
WHEN OLD.succeeded_at IS NOT NULL AND NEW.succeeded_at IS NOT OLD.succeeded_at
BEGIN SELECT RAISE(ABORT, 'ELC invariant: immutable_payment_time'); END;
