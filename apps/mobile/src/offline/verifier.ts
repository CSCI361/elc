import { p256 } from "@noble/curves/nist.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import { z } from "zod"
import {
  offlineCanonicalJson,
  offlineSnapshotManifestSchema,
  offlineSnapshotPageSchema,
  type OfflineSnapshotPage,
} from "@elc/shared"
import type { SnapshotVerifier } from "./store"

const pinSchema = z.strictObject({
  keyId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  publicJwk: z
    .object({
      kty: z.literal("EC"),
      crv: z.literal("P-256"),
      x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      y: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      d: z.never().optional(),
    })
    .passthrough(),
})
export type PublicKeyPin = z.infer<typeof pinSchema>
function base64Url(value: string) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
  let bits = 0
  let accumulator = 0
  const bytes: number[] = []
  for (const character of value) {
    const digit = alphabet.indexOf(character)
    if (digit < 0) throw new Error("Invalid base64url encoding")
    accumulator = (accumulator << 6) | digit
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((accumulator >> bits) & 255)
    }
  }
  if ((accumulator & ((1 << bits) - 1)) !== 0)
    throw new Error("Noncanonical base64url encoding")
  return Uint8Array.from(bytes)
}
export const tokenDigest = (token: string) =>
  bytesToHex(sha256(new TextEncoder().encode(token)))
export function createSnapshotVerifier(rawPin: unknown): SnapshotVerifier {
  const pin = pinSchema.parse(rawPin)
  const point = new Uint8Array(65)
  point[0] = 4
  point.set(base64Url(pin.publicJwk.x), 1)
  point.set(base64Url(pin.publicJwk.y), 33)
  p256.Point.fromBytes(point).assertValidity()
  return async (rawManifest, rawPages, expected, now) => {
    try {
      const manifest = offlineSnapshotManifestSchema.parse(rawManifest)
      if (
        manifest.keyId !== pin.keyId ||
        manifest.accountId !== expected.accountId ||
        manifest.deviceId !== expected.deviceId ||
        manifest.eventId !== expected.eventId ||
        now < Date.parse(manifest.issuedAt) ||
        now >= Date.parse(manifest.expiresAt)
      )
        return null
      const { signature, ...unsigned } = manifest
      const signatureBytes = base64Url(signature)
      if (
        signatureBytes.length !== 64 ||
        !p256.verify(
          signatureBytes,
          new TextEncoder().encode(
            `elc-offline-manifest-v1\n${offlineCanonicalJson(unsigned)}`
          ),
          point,
          { prehash: true, lowS: false, format: "compact" }
        )
      )
        return null
      const pages = rawPages
        .map((page) => offlineSnapshotPageSchema.parse(page))
        .sort((a, b) => a.page - b.page)
      if (pages.length !== manifest.pages.length) return null
      for (const [index, page] of pages.entries()) {
        if (
          page.page !== index ||
          page.totalPages !== pages.length ||
          page.totalTickets !== manifest.ticketCount ||
          page.tickets.length !== manifest.pages[index]!.ticketCount ||
          page.snapshotId !== manifest.snapshotId ||
          page.accountId !== manifest.accountId ||
          page.deviceId !== manifest.deviceId ||
          page.eventId !== manifest.eventId ||
          page.issuedAt !== manifest.issuedAt ||
          page.expiresAt !== manifest.expiresAt ||
          bytesToHex(
            sha256(new TextEncoder().encode(offlineCanonicalJson(page)))
          ) !== manifest.pages[index]!.digest
        )
          return null
      }
      const tickets: OfflineSnapshotPage["tickets"] = pages.flatMap(
        (page) => page.tickets
      )
      if (
        new Set(tickets.map((ticket) => ticket.ticketId)).size !==
          tickets.length ||
        new Set(tickets.map((ticket) => ticket.tokenHash)).size !==
          tickets.length
      )
        return null
      return tickets
    } catch {
      return null
    }
  }
}
