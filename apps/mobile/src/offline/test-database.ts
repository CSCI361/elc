import sqlcipher from "@journeyapps/sqlcipher"
import { serializedDatabase, type SqlSession } from "./database"

/** Actual SQLCipher driver for host tests; never imported by the native application. */
export async function openTestCipher(filename: string, key = "ab".repeat(32)) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid test key")
  const raw = await new Promise<sqlcipher.Database>((resolve, reject) => {
    const database = new sqlcipher.Database(filename, (error) =>
      error ? reject(error) : resolve(database)
    )
  })
  const close = () =>
    new Promise<void>((resolve, reject) =>
      raw.close((error) => (error ? reject(error) : resolve()))
    )
  const session: SqlSession = {
    exec: (sql) =>
      new Promise<void>((resolve, reject) =>
        raw.exec(sql, (error) => (error ? reject(error) : resolve()))
      ),
    run: (sql, bindings = []) =>
      new Promise<{ changes: number }>((resolve, reject) =>
        raw.run(sql, bindings, function (error) {
          if (error) reject(error)
          else resolve({ changes: this.changes })
        })
      ),
    first: <T>(sql: string, bindings = []) =>
      new Promise<T | null>((resolve, reject) =>
        raw.get(sql, bindings, (error: Error | null, row: T | undefined) =>
          error ? reject(error) : resolve(row ?? null)
        )
      ),
    all: <T>(sql: string, bindings = []) =>
      new Promise<T[]>((resolve, reject) =>
        raw.all(sql, bindings, (error: Error | null, rows: T[]) =>
          error ? reject(error) : resolve(rows)
        )
      ),
  }
  try {
    await session.exec(`PRAGMA key = "x'${key}'"`)
    const version = await session.first<{ cipher_version: string }>(
      "PRAGMA cipher_version"
    )
    if (!version?.cipher_version)
      throw new Error("SQLCipher encryption is required")
    await session.first("SELECT count(*) FROM sqlite_master")
    await session.exec(
      "PRAGMA secure_delete = ON; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;"
    )
    return {
      db: serializedDatabase(session, close),
      version: version.cipher_version,
    }
  } catch (error) {
    await close()
    throw error
  }
}
