import { unstable_splitSqlQuery } from "wrangler"

/** D1 checks that referenced tables exist even with deferred foreign keys.
 * Load all schema tables before data, and install transition guards only after
 * final-state rows are present. D1's import transaction verifies foreign keys.
 * Never use this on a populated target. Unknown SQL fails closed for review. */
export function prepareRestoreStatements(sql) {
  const tables = [],
    data = [],
    indexesAndViews = [],
    triggers = []
  for (const statement of unstable_splitSqlQuery(sql)) {
    const normalized = statement.trim()
    if (
      /^PRAGMA defer_foreign_keys\s*=\s*(?:TRUE|ON|1)\s*;?$/i.test(normalized)
    )
      continue
    if (/^CREATE TABLE\s/i.test(normalized)) tables.push(statement)
    else if (
      /^INSERT INTO\s/i.test(normalized) ||
      /^DELETE FROM ["`]?sqlite_sequence["`]?\s*;?$/i.test(normalized)
    )
      data.push(statement)
    else if (/^CREATE (?:UNIQUE )?(?:INDEX|VIEW)\s/i.test(normalized))
      indexesAndViews.push(statement)
    else if (/^CREATE TRIGGER\s/i.test(normalized)) triggers.push(statement)
    else
      throw new Error(
        "Unsupported SQL in backup; review the export before restoring"
      )
  }
  if (!tables.length) throw new Error("Backup has no table schema")
  return [
    "PRAGMA defer_foreign_keys=TRUE;",
    ...tables,
    ...data,
    ...indexesAndViews,
    ...triggers,
  ]
}
