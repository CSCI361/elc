import { Buffer } from "node:buffer"
import {
  offlineCanonicalJson,
  offlinePageDigest,
  type OfflineSnapshotManifest,
  type OfflineSnapshotPage,
  type ScannerEvent,
} from "@elc/shared"
import { tokenDigest } from "./verifier"

export async function signingFixture() {
  const key = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  )
  const publicJwk = await crypto.subtle.exportKey("jwk", key.publicKey)
  return {
    pin: { keyId: "test-key", publicJwk },
    sign: async (unsigned: Omit<OfflineSnapshotManifest, "signature">) =>
      Buffer.from(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          key.privateKey,
          new TextEncoder().encode(
            `elc-offline-manifest-v1\n${offlineCanonicalJson(unsigned)}`
          )
        )
      ).toString("base64url"),
  }
}
export async function snapshotFixture(
  signing: Awaited<ReturnType<typeof signingFixture>>,
  now: number,
  count = 2,
  overrides: {
    accountId?: string
    eventId?: string
    deviceId?: string
    eventEndsAt?: number
    ticketState?: "valid" | "cancelled" | "refunded" | "checked_in"
  } = {}
) {
  const accountId = overrides.accountId ?? "scanner"
  const eventId = overrides.eventId ?? "event"
  const deviceId = overrides.deviceId ?? "device"
  const snapshotId = crypto.randomUUID()
  const issuedAt = new Date(now).toISOString()
  const endsAt = overrides.eventEndsAt ?? now + 2 * 60 * 60_000
  const expiresAt = new Date(
    Math.min(now + 4 * 60 * 60_000, endsAt + 2 * 60 * 60_000)
  ).toISOString()
  const tokens = Array.from(
    { length: count },
    (_, index) => `fixture_token_${index}_${"A".repeat(32)}`
  )
  const tickets: OfflineSnapshotPage["tickets"] = tokens.map(
    (token, index) => ({
      ticketId: `ticket-${index}`,
      tokenHash: tokenDigest(token),
      attendeeName: `Fixture guest ${index}`,
      state: overrides.ticketState ?? "valid",
      admissionBlocked: false,
      activeCheckInId:
        overrides.ticketState === "checked_in" ? `checkin-${index}` : null,
      seat: null,
    })
  )
  const pages: OfflineSnapshotPage[] = Array.from(
    { length: Math.max(1, Math.ceil(count / 100)) },
    (_, page) => ({
      version: 1,
      snapshotId,
      accountId,
      deviceId,
      eventId,
      issuedAt,
      expiresAt,
      page,
      totalPages: Math.max(1, Math.ceil(count / 100)),
      totalTickets: count,
      tickets: tickets.slice(page * 100, page * 100 + 100),
    })
  )
  const unsigned: Omit<OfflineSnapshotManifest, "signature"> = {
    version: 1,
    snapshotId,
    accountId,
    deviceId,
    eventId,
    issuedAt,
    expiresAt,
    eventEndsAt: new Date(endsAt).toISOString(),
    keyId: signing.pin.keyId,
    algorithm: "ES256",
    ticketCount: count,
    pageSize: 100,
    pages: await Promise.all(
      pages.map(async (page) => ({
        page: page.page,
        ticketCount: page.tickets.length,
        digest: await offlinePageDigest(page),
      }))
    ),
  }
  const manifest = { ...unsigned, signature: await signing.sign(unsigned) }
  const event: ScannerEvent = {
    id: eventId,
    title: "Encrypted offline fixture",
    venueName: "Hall",
    timeZone: "Asia/Almaty",
    startsAt: new Date(now - 3600_000).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    cancelledAt: null,
    suspendedAt: null,
    permissions: ["ticket:scan"],
    counts: { registered: count, checkedIn: 0, unresolvedOffline: 0 },
    coverImageUrl: null,
  }
  return { manifest, pages, event, tickets, tokens }
}
