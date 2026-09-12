import { admissionPayloadSchema } from "@elc/shared"
import { ApiFailure } from "../db/transitions"

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (character) => character.charCodeAt(0)
  )
}

export async function credentialHash(token: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
    )
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

async function encryptionKey(secret: string | undefined): Promise<CryptoKey> {
  if (!secret || !/^[A-Za-z0-9_-]{43}$/.test(secret))
    throw new ApiFailure(
      "SERVICE_UNAVAILABLE",
      503,
      "Ticket delivery is not configured."
    )
  return crypto.subtle.importKey("raw", decode(secret), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ])
}

/** The encrypted credential can be recovered for an authorized download or PDF. */
export async function createTicketCredential(
  ticketId: string,
  secret: string | undefined
): Promise<{ tokenHash: string; ciphertext: string }> {
  const key = await encryptionKey(secret)
  const token = encode(crypto.getRandomValues(new Uint8Array(32)))
  const payload = JSON.stringify({ kind: "elc_admission", version: 1, token })
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(`elc-ticket-v1:${ticketId}`),
    },
    key,
    new TextEncoder().encode(payload)
  )
  return {
    tokenHash: await credentialHash(token),
    ciphertext: `v1.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`,
  }
}

export async function recoverTicketCredential(
  ticketId: string,
  ciphertext: string,
  secret: string | undefined
) {
  const key = await encryptionKey(secret)
  const [version, encodedIv, encodedCiphertext, extra] = ciphertext.split(".")
  if (version !== "v1" || !encodedIv || !encodedCiphertext || extra)
    throw new Error("Unsupported ticket credential encoding")
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decode(encodedIv),
      additionalData: new TextEncoder().encode(`elc-ticket-v1:${ticketId}`),
    },
    key,
    decode(encodedCiphertext)
  )
  return admissionPayloadSchema.parse(
    JSON.parse(new TextDecoder().decode(plaintext))
  )
}
