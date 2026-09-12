import { drizzle } from "drizzle-orm/d1"
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test"
import {
  events,
  eventPermissions,
  invitations,
  platformGrants,
  profiles,
  user,
} from "../db/schema"
import {
  requireActiveAccount,
  requireEventPermission,
  requireEventReadAccess,
  requirePlatformPermission,
} from "./permissions"
import { createAuthTestDatabase } from "./test-database"

describe("application authorization on D1", () => {
  let database: Awaited<ReturnType<typeof createAuthTestDatabase>>
  const now = Date.now()

  beforeAll(async () => {
    database = await createAuthTestDatabase()
    const db = drizzle(database.DB)
    await db.insert(user).values(
      ["owner", "scanner", "invited", "unverified", "admin", "outsider"].map(
        (id) => ({
          id,
          name: id,
          email: `${id}@example.test`,
          emailVerified: id !== "unverified",
        })
      )
    )
    await db.insert(profiles).values({ userId: "owner", updatedAt: now })
    const eventFixtures = [
      {
        id: "public",
        visibility: "public" as const,
        publicationState: "published" as const,
      },
      {
        id: "unlisted",
        visibility: "unlisted" as const,
        publicationState: "published" as const,
      },
      {
        id: "private-a",
        visibility: "private" as const,
        publicationState: "published" as const,
      },
      {
        id: "private-b",
        visibility: "private" as const,
        publicationState: "published" as const,
      },
      {
        id: "draft",
        visibility: "private" as const,
        publicationState: "draft" as const,
      },
    ].map((event) => ({
      ...event,
      organizerId: "owner",
      title: event.id,
      description: "Authorization test",
      category: "education",
      venueName: "Test venue",
      venueAddress: "Test address",
      startsAt: now + 86_400_000,
      endsAt: now + 90_000_000,
      registrationOpensAt: now - 86_400_000,
      registrationClosesAt: now + 80_000_000,
      capacity: 80,
      calendarUid: `${event.id}@elc.test`,
      reportingId: `report-${event.id}`,
      createdAt: now,
      updatedAt: now,
    }))
    for (const event of eventFixtures) await db.insert(events).values(event)
    await db.insert(eventPermissions).values([
      {
        eventId: "private-a",
        userId: "scanner",
        permission: "ticket:scan",
        grantedAt: now,
      },
      {
        eventId: "private-a",
        userId: "unverified",
        permission: "event:manage",
        grantedAt: now,
      },
    ])
    await db.insert(invitations).values({
      id: "invitation",
      eventId: "private-a",
      email: "invited@example.test",
      tokenHash: "invitation-hash",
      expiresAt: now - 1,
      createdAt: now - 5_000,
    })
    await db.insert(platformGrants).values({
      userId: "admin",
      permission: "platform:moderate",
      grantedAt: now,
    })
  })

  afterAll(async () => {
    await database?.runtime.dispose()
  })

  it("lets owners manage their event but requires explicit scan, reversal, and conflict-review grants", async () => {
    for (const permission of [
      "event:manage",
      "support:manage",
      "refund:initiate",
      "analytics:read",
      "history:read",
    ] as const) {
      await expect(
        requireEventPermission(database.DB, "owner", "private-a", permission)
      ).resolves.toMatchObject({ id: "private-a" })
    }
    for (const permission of [
      "ticket:scan",
      "checkin:reverse",
      "checkin:review",
    ] as const) {
      await expect(
        requireEventPermission(database.DB, "owner", "private-a", permission)
      ).rejects.toMatchObject({ status: 403 })
    }
    await drizzle(database.DB).insert(eventPermissions).values({
      eventId: "private-a",
      userId: "owner",
      permission: "ticket:scan",
      grantedAt: now,
    })
    await expect(
      requireEventPermission(database.DB, "owner", "private-a", "ticket:scan")
    ).resolves.toMatchObject({ id: "private-a" })
    await expect(
      requireEventPermission(
        database.DB,
        "owner",
        "private-a",
        "checkin:reverse"
      )
    ).rejects.toMatchObject({ status: 403 })
  })

  it("scopes staff grants to their event and denies unrelated support, refund, and platform permissions", async () => {
    await expect(
      requireEventPermission(database.DB, "scanner", "private-a", "ticket:scan")
    ).resolves.toMatchObject({ id: "private-a" })
    await expect(
      requireEventReadAccess(database.DB, "private-a", "scanner")
    ).resolves.toMatchObject({ id: "private-a" })
    await expect(
      requireEventPermission(database.DB, "scanner", "private-b", "ticket:scan")
    ).rejects.toMatchObject({ status: 403 })
    for (const permission of [
      "event:manage",
      "support:manage",
      "refund:initiate",
    ] as const) {
      await expect(
        requireEventPermission(database.DB, "scanner", "private-a", permission)
      ).rejects.toMatchObject({ status: 403 })
    }
    await expect(
      requirePlatformPermission(database.DB, "scanner", "platform:support")
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      requirePlatformPermission(database.DB, "owner", "platform:moderate")
    ).rejects.toMatchObject({ status: 403 })
    await database.DB.prepare(
      "UPDATE event_permissions SET revoked_at = ? WHERE user_id = 'scanner'"
    )
      .bind(now)
      .run()
    await expect(
      requireEventPermission(database.DB, "scanner", "private-a", "ticket:scan")
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      requireEventReadAccess(database.DB, "private-a", "scanner")
    ).rejects.toMatchObject({ status: 404 })
  })

  it("rechecks suspension and email verification even when a role assignment exists", async () => {
    await expect(
      requireEventPermission(
        database.DB,
        "unverified",
        "private-a",
        "event:manage"
      )
    ).rejects.toMatchObject({ status: 403 })
    await database.DB.prepare(
      "UPDATE profiles SET suspended_at = ? WHERE user_id = 'owner'"
    )
      .bind(now)
      .run()
    await expect(
      requireActiveAccount(database.DB, "owner")
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      requireEventPermission(database.DB, "owner", "private-a", "event:manage")
    ).rejects.toMatchObject({ status: 403 })
    await database.DB.prepare(
      "UPDATE profiles SET suspended_at = NULL WHERE user_id = 'owner'"
    ).run()
    await expect(
      requireActiveAccount(database.DB, "owner")
    ).resolves.toMatchObject({ id: "owner" })
  })

  it("requires accepted private invitations tied to the current verified account and honors revocation", async () => {
    await expect(
      requireEventReadAccess(database.DB, "private-a")
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      requireEventReadAccess(database.DB, "private-a", "invited")
    ).rejects.toMatchObject({ status: 404 })
    await database.DB.prepare(
      "UPDATE invitations SET accepted_by = 'invited', accepted_at = ? WHERE id = 'invitation'"
    )
      .bind(now - 2_000)
      .run()
    // The token has expired, but it was accepted before its deadline.
    await expect(
      requireEventReadAccess(database.DB, "private-a", "invited")
    ).resolves.toMatchObject({ id: "private-a" })
    await expect(
      requireEventReadAccess(database.DB, "private-a", "outsider")
    ).rejects.toMatchObject({ status: 404 })
    await database.DB.prepare(
      "UPDATE user SET email = 'changed@example.test' WHERE id = 'invited'"
    ).run()
    await expect(
      requireEventReadAccess(database.DB, "private-a", "invited")
    ).rejects.toMatchObject({ status: 404 })
    await database.DB.prepare(
      "UPDATE user SET email = 'invited@example.test' WHERE id = 'invited'"
    ).run()
    await database.DB.prepare(
      "UPDATE invitations SET accepted_at = ? WHERE id = 'invitation'"
    )
      .bind(now)
      .run()
    await expect(
      requireEventReadAccess(database.DB, "private-a", "invited")
    ).rejects.toMatchObject({ status: 404 })
    await database.DB.prepare(
      "UPDATE invitations SET accepted_at = ?, revoked_at = ? WHERE id = 'invitation'"
    )
      .bind(now - 2_000, now)
      .run()
    await expect(
      requireEventReadAccess(database.DB, "private-a", "invited")
    ).rejects.toMatchObject({ status: 404 })
  })

  it("allows public/unlisted link access while keeping drafts and suspended events private", async () => {
    await expect(
      requireEventReadAccess(database.DB, "public")
    ).resolves.toMatchObject({ id: "public" })
    await expect(
      requireEventReadAccess(database.DB, "unlisted")
    ).resolves.toMatchObject({ id: "unlisted" })
    await expect(
      requireEventReadAccess(database.DB, "draft", "outsider")
    ).rejects.toMatchObject({ status: 404 })
    await database.DB.prepare(
      "UPDATE events SET suspended_at = ? WHERE id = 'public'"
    )
      .bind(now)
      .run()
    await expect(
      requireEventReadAccess(database.DB, "public")
    ).rejects.toMatchObject({ status: 404 })
  })

  it("requires the exact platform grant and does not turn moderation into event or platform support authority", async () => {
    await expect(
      requirePlatformPermission(database.DB, "admin", "platform:moderate")
    ).resolves.toMatchObject({ id: "admin" })
    await expect(
      requireEventReadAccess(database.DB, "draft", "admin")
    ).resolves.toMatchObject({ id: "draft" })
    await expect(
      requirePlatformPermission(database.DB, "admin", "platform:support")
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      requireEventPermission(
        database.DB,
        "admin",
        "private-a",
        "support:manage"
      )
    ).rejects.toMatchObject({ status: 403 })
    await database.DB.prepare(
      "DELETE FROM platform_grants WHERE user_id = 'admin'"
    ).run()
    await expect(
      requirePlatformPermission(database.DB, "admin", "platform:moderate")
    ).rejects.toMatchObject({ status: 403 })
  })
})
