import {
  permissionSchema,
  platformPermissionSchema,
  type Permission,
} from "@elc/shared"
import { HTTPException } from "hono/http-exception"
import type { z } from "zod"
import type { Bindings } from "../env"

type Database = Bindings["DB"]
type PlatformPermission = z.infer<typeof platformPermissionSchema>

export type ActiveAccount = { id: string; email: string }
export type EventAccess = {
  id: string
  organizerId: string
  visibility: "public" | "unlisted" | "private"
  publicationState: "draft" | "published" | "unpublished"
  suspendedAt: number | null
}

const ownerPermissions = new Set<Permission>([
  "event:manage",
  "support:manage",
  "refund:initiate",
  "analytics:read",
  "history:read",
])

/** userId must come from the server-verified session, never from request input. */
export async function requireActiveAccount(
  db: Database,
  userId: string
): Promise<ActiveAccount> {
  const account = await db
    .prepare(`
    SELECT u.id, u.email, u.email_verified AS emailVerified, p.suspended_at AS suspendedAt
    FROM user u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?
  `)
    .bind(userId)
    .first<{
      id: string
      email: string
      emailVerified: number
      suspendedAt: number | null
    }>()
  if (!account)
    throw new HTTPException(401, { message: "Sign in to continue." })
  if (account.suspendedAt !== null)
    throw new HTTPException(403, { message: "This account is suspended." })
  if (!account.emailVerified)
    throw new HTTPException(403, {
      message: "Verify your email address to continue.",
    })
  return { id: account.id, email: account.email }
}

async function getEventAccess(
  db: Database,
  eventId: string
): Promise<EventAccess> {
  const event = await db
    .prepare(`
    SELECT id, organizer_id AS organizerId, visibility,
      publication_state AS publicationState, suspended_at AS suspendedAt
    FROM events WHERE id = ?
  `)
    .bind(eventId)
    .first<EventAccess>()
  if (!event) throw new HTTPException(404, { message: "Event not found." })
  return event
}

/** Authorization is rechecked on every request; mutations also need commit-time guards. */
export async function requireEventPermission(
  db: Database,
  userId: string,
  eventId: string,
  permission: Permission
): Promise<EventAccess> {
  permissionSchema.parse(permission)
  const account = await requireActiveAccount(db, userId)
  const event = await getEventAccess(db, eventId)
  if (event.organizerId === account.id && ownerPermissions.has(permission))
    return event
  const grant = await db
    .prepare(`
    SELECT 1 FROM event_permissions
    WHERE user_id = ? AND event_id = ? AND permission = ? AND revoked_at IS NULL
  `)
    .bind(account.id, eventId, permission)
    .first()
  if (!grant)
    throw new HTTPException(403, {
      message: "You do not have permission for this event.",
    })
  return event
}

export async function requirePlatformPermission(
  db: Database,
  userId: string,
  permission: PlatformPermission
): Promise<ActiveAccount> {
  platformPermissionSchema.parse(permission)
  const account = await requireActiveAccount(db, userId)
  const grant = await db
    .prepare(
      "SELECT 1 FROM platform_grants WHERE user_id = ? AND permission = ?"
    )
    .bind(account.id, permission)
    .first()
  if (!grant)
    throw new HTTPException(403, {
      message: "Platform permission is required.",
    })
  return account
}

/** Link access includes unlisted events; discovery must filter them separately. */
export async function requireEventReadAccess(
  db: Database,
  eventId: string,
  userId?: string
): Promise<EventAccess> {
  const event = await getEventAccess(db, eventId)
  if (
    event.visibility !== "private" &&
    event.publicationState === "published" &&
    event.suspendedAt === null
  )
    return event
  if (!userId) throw new HTTPException(404, { message: "Event not found." })
  const account = await requireActiveAccount(db, userId)
  if (event.organizerId === account.id) return event
  const grant = await db
    .prepare(`
    SELECT permission FROM event_permissions
    WHERE event_id = ? AND user_id = ? AND revoked_at IS NULL
  `)
    .bind(eventId, account.id)
    .all<{ permission: string }>()
  if (
    grant.results.some(
      (entry) => permissionSchema.safeParse(entry.permission).success
    )
  )
    return event
  const moderator = await db
    .prepare(
      "SELECT 1 FROM platform_grants WHERE user_id = ? AND permission = 'platform:moderate'"
    )
    .bind(account.id)
    .first()
  if (moderator) return event
  if (
    event.visibility === "private" &&
    event.publicationState === "published" &&
    event.suspendedAt === null
  ) {
    // Expiry controls accepting the token. Accepted access survives token expiry,
    // but revocation and a changed account email remove that invitation's access.
    const acceptedInvitation = await db
      .prepare(`
      SELECT 1 FROM invitations i JOIN events e ON e.id = i.event_id
      WHERE i.event_id = ? AND i.accepted_by = ? AND lower(i.email) = lower(?)
        AND i.revoked_at IS NULL AND i.accepted_at IS NOT NULL
        AND i.accepted_at < i.expires_at AND i.accepted_at < e.ends_at
    `)
      .bind(eventId, account.id, account.email)
      .first()
    if (acceptedInvitation) return event
  }
  throw new HTTPException(404, { message: "Event not found." })
}
