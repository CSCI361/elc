import { z } from "zod"
import { ApiFailure } from "../db/transitions"

const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
const decode = (value: string) =>
  Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (character) => character.charCodeAt(0)
  )
export async function invitationTokenHash(token: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
    )
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}
async function key(secret: string | undefined) {
  if (!secret || !/^[A-Za-z0-9_-]{43}$/.test(secret))
    throw new ApiFailure(
      "SERVICE_UNAVAILABLE",
      503,
      "Invitation delivery encryption is not configured."
    )
  return crypto.subtle.importKey("raw", decode(secret), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ])
}
export async function createInvitationToken(
  invitationId: string,
  secret: string | undefined
) {
  const token = encode(crypto.getRandomValues(new Uint8Array(32)))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(
        `elc-invitation-v1:${invitationId}`
      ),
    },
    await key(secret),
    new TextEncoder().encode(token)
  )
  return {
    tokenHash: await invitationTokenHash(token),
    encryptedToken: `v1.${encode(iv)}.${encode(new Uint8Array(encrypted))}`,
  }
}
/** Only a delivery worker should decrypt the committed token after checking the invitation is still pending. */
export async function recoverInvitationToken(
  invitationId: string,
  encryptedToken: string,
  secret: string | undefined
) {
  const [version, iv, ciphertext, extra] = encryptedToken.split(".")
  if (version !== "v1" || !iv || !ciphertext || extra)
    throw new Error("Unsupported invitation token encoding")
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decode(iv),
      additionalData: new TextEncoder().encode(
        `elc-invitation-v1:${invitationId}`
      ),
    },
    await key(secret),
    decode(ciphertext)
  )
  return z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .parse(new TextDecoder().decode(plain))
}
export function invitationAcceptanceUrl(appOrigin: string, token: string) {
  const url = new URL(appOrigin)
  if (!["http:", "https:"].includes(url.protocol))
    throw new ApiFailure(
      "SERVICE_UNAVAILABLE",
      503,
      "Configure a valid application origin."
    )
  return `${url.origin}/invitations/accept#token=${token}`
}
