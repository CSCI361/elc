import { HTTPException } from "hono/http-exception"
import type { ApiErrorCode } from "@elc/shared"

export class ApiFailure extends HTTPException {
  readonly code: ApiErrorCode

  constructor(
    code: ApiErrorCode,
    status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503,
    message: string
  ) {
    super(status, { message })
    this.code = code
  }
}

/** SQL text must be authored by the server; put all request values in bindings. */
export function assertSql(
  db: D1Database,
  predicate: string,
  bindings: unknown[] = []
): D1PreparedStatement[] {
  const id = crypto.randomUUID()
  return [
    db
      .prepare(
        `INSERT INTO transition_guards (id, valid) SELECT ?, CASE WHEN (${predicate}) THEN 1 ELSE 0 END`
      )
      .bind(id, ...bindings),
    db.prepare("DELETE FROM transition_guards WHERE id = ?").bind(id),
  ]
}

export function isTransitionConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    /transition_guard_valid|UNIQUE constraint failed/.test(error.message)
  )
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)])
    )
  }
  return value
}

export async function requestHash(
  operation: string,
  normalizedInput: unknown
): Promise<string> {
  const data = new TextEncoder().encode(
    JSON.stringify({ operation, input: canonical(normalizedInput) })
  )
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export async function readReceipt(
  db: D1Database,
  actorId: string,
  requestId: string,
  inputHash: string
): Promise<{ resourceId: string; responseJson: string | null } | null> {
  const receipt = await db
    .prepare(
      "SELECT input_hash AS inputHash, resource_id AS resourceId, response_json AS responseJson FROM request_receipts WHERE actor_id = ? AND request_id = ?"
    )
    .bind(actorId, requestId)
    .first<{
      inputHash: string
      resourceId: string
      responseJson: string | null
    }>()
  if (!receipt) return null
  if (receipt.inputHash !== inputHash)
    throw new ApiFailure(
      "CONFLICT",
      409,
      "This request identifier was already used for a different operation."
    )
  return { resourceId: receipt.resourceId, responseJson: receipt.responseJson }
}
