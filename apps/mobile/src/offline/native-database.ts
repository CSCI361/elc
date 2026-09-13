import * as SQLite from "expo-sqlite"
import {
  serializedDatabase,
  type LocalDatabase,
  type SqlSession,
} from "./database"
import { OfflineFailure } from "./model"

/** A random 256-bit raw SQLCipher key; interpolation is restricted to validated hexadecimal. */
export function cipherKeyPragma(key: string) {
  if (!/^[a-f0-9]{64}$/.test(key))
    throw new OfflineFailure("encryption_unavailable")
  return `PRAGMA key = "x'${key}'"`
}
export async function openEncryptedDatabase(
  filename: string,
  key: string
): Promise<LocalDatabase> {
  if (!/^elc-offline-(local|preview|demo)-[a-f0-9]{32}\.db$/.test(filename))
    throw new OfflineFailure("encryption_unavailable")
  const pragma = cipherKeyPragma(key)
  const database = await SQLite.openDatabaseAsync(filename, {
    useNewConnection: true,
  })
  try {
    await database.execAsync(pragma)
    const cipher = await database.getFirstAsync<{ cipher_version: string }>(
      "PRAGMA cipher_version"
    )
    if (!cipher?.cipher_version)
      throw new OfflineFailure("encryption_unavailable")
    await database.getFirstAsync("SELECT count(*) FROM sqlite_master")
    await database.execAsync(
      "PRAGMA cipher_memory_security = ON; PRAGMA secure_delete = ON; PRAGMA temp_store = MEMORY; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;"
    )
  } catch {
    await database.closeAsync()
    throw new OfflineFailure("encryption_unavailable")
  }
  const session: SqlSession = {
    exec: (sql) => database.execAsync(sql),
    run: (sql, bindings = []) => database.runAsync(sql, bindings),
    first: <T>(sql: string, bindings = []) =>
      database.getFirstAsync<T>(sql, bindings),
    all: <T>(sql: string, bindings = []) =>
      database.getAllAsync<T>(sql, bindings),
  }
  // Expo's withExclusiveTransactionAsync opens another connection without the runtime PRAGMA key.
  // Keep this keyed connection private and serialize every read/write with BEGIN IMMEDIATE for writes.
  return serializedDatabase(session, () => database.closeAsync())
}
