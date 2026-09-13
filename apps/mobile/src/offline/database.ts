export type SqlValue = string | number | null
export interface SqlSession {
  exec(sql: string): Promise<void>
  run(sql: string, bindings?: SqlValue[]): Promise<{ changes: number }>
  first<T>(sql: string, bindings?: SqlValue[]): Promise<T | null>
  all<T>(sql: string, bindings?: SqlValue[]): Promise<T[]>
}
export interface LocalDatabase {
  read<T>(work: (sql: SqlSession) => Promise<T>): Promise<T>
  write<T>(work: (sql: SqlSession) => Promise<T>): Promise<T>
  checkpoint(): Promise<void>
  close(): Promise<void>
}

/** All access to one connection, including reads and close, uses this queue. */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve()
  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work)
    this.tail = result.then(
      () => {},
      () => {}
    )
    return result
  }
}

/** Private connection ownership prevents Expo's unrelated async queries entering a transaction. */
export function serializedDatabase(
  session: SqlSession,
  closeConnection: () => Promise<void>
): LocalDatabase {
  const queue = new SerialQueue()
  let closed = false
  const transaction = <T>(
    write: boolean,
    work: (sql: SqlSession) => Promise<T>
  ) =>
    queue.run(async () => {
      if (closed) throw new Error("The local database is closed")
      await session.exec(write ? "BEGIN IMMEDIATE" : "BEGIN")
      try {
        const result = await work(session)
        await session.exec("COMMIT")
        return result
      } catch (error) {
        await session.exec("ROLLBACK")
        throw error
      }
    })
  return {
    read: (work) => transaction(false, work),
    write: (work) => transaction(true, work),
    checkpoint: () =>
      queue.run(async () => {
        if (!closed) await session.exec("PRAGMA wal_checkpoint(TRUNCATE)")
      }),
    close: () =>
      queue.run(async () => {
        if (!closed) {
          closed = true
          await closeConnection()
        }
      }),
  }
}

export const offlineSchema = `
CREATE TABLE IF NOT EXISTS vault (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  account_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 1 CHECK (locked IN (0, 1)),
  wall_high_water INTEGER NOT NULL DEFAULT 0,
  trusted_server_at INTEGER,
  trusted_wall_at INTEGER,
  clock_unsafe INTEGER NOT NULL DEFAULT 0 CHECK (clock_unsafe IN (0, 1))
);
CREATE TABLE IF NOT EXISTS devices (
  event_id TEXT PRIMARY KEY,
  registration_request_id TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  device_id TEXT UNIQUE,
  revoked_at INTEGER,
  sequence INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  last_sync_at INTEGER
);
CREATE TABLE IF NOT EXISTS snapshots (
  event_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL UNIQUE,
  device_id TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  pages_json TEXT NOT NULL,
  event_json TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  received_wall_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshot_tickets (
  event_id TEXT NOT NULL REFERENCES snapshots(event_id) ON DELETE CASCADE,
  ticket_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (event_id, ticket_id),
  UNIQUE (event_id, token_hash)
);
CREATE TABLE IF NOT EXISTS units (
  scan_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  scan_json TEXT NOT NULL,
  undo_json TEXT,
  captured_at INTEGER NOT NULL,
  captured_wall_at INTEGER NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('pending', 'sealed', 'acknowledged')),
  batch_id TEXT,
  acknowledged_at INTEGER,
  result_json TEXT,
  UNIQUE (device_id, sequence)
);
CREATE INDEX IF NOT EXISTS units_pending ON units(event_id, stage, sequence);
CREATE UNIQUE INDEX IF NOT EXISTS units_undo_id ON units(json_extract(undo_json, '$.operationId')) WHERE undo_json IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS units_identity_immutable BEFORE UPDATE OF scan_id, event_id, device_id, ticket_id, token_hash, sequence, scan_json, captured_at, captured_wall_at ON units
BEGIN SELECT RAISE(ABORT, 'offline unit identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS units_undo_once BEFORE UPDATE OF undo_json ON units
WHEN OLD.undo_json IS NOT NULL OR OLD.stage <> 'pending'
BEGIN SELECT RAISE(ABORT, 'sealed offline units cannot change'); END;
CREATE TRIGGER IF NOT EXISTS units_stage_forward BEFORE UPDATE OF stage ON units
WHEN NOT ((OLD.stage = 'pending' AND NEW.stage = 'sealed') OR (OLD.stage = 'sealed' AND NEW.stage = 'acknowledged'))
BEGIN SELECT RAISE(ABORT, 'offline journal cannot move backwards'); END;
CREATE TABLE IF NOT EXISTS local_admissions (
  event_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  scan_id TEXT NOT NULL UNIQUE REFERENCES units(scan_id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, token_hash)
);
CREATE TABLE IF NOT EXISTS online_barriers (
  event_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('pending', 'checked_in', 'blocked')),
  created_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  PRIMARY KEY (event_id, token_hash)
);
CREATE TABLE IF NOT EXISTS batches (
  request_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  response_json TEXT
);
CREATE TABLE IF NOT EXISTS attempts (
  operation_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  result TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  ticket_id TEXT
);
CREATE TRIGGER IF NOT EXISTS batch_payload_immutable BEFORE UPDATE OF payload_json, request_id, event_id, device_id ON batches
BEGIN SELECT RAISE(ABORT, 'sealed offline batches cannot change'); END;
PRAGMA user_version = 1;
`
