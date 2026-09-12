import { describe, expect, it } from "vite-plus/test"
import {
  createTicketCredential,
  credentialHash,
  recoverTicketCredential,
} from "./credentials"

const key = "A".repeat(43)

describe("canonical ticket credentials", () => {
  it("recovers the same opaque credential for repeat delivery without exposing it in storage", async () => {
    const stored = await createTicketCredential("ticket-a", key)
    const first = await recoverTicketCredential(
      "ticket-a",
      stored.ciphertext,
      key
    )
    const repeated = await recoverTicketCredential(
      "ticket-a",
      stored.ciphertext,
      key
    )
    expect(repeated).toEqual(first)
    expect(Object.keys(first).sort()).toEqual(["kind", "token", "version"])
    expect(await credentialHash(first.token)).toBe(stored.tokenHash)
    expect(stored.ciphertext).not.toContain(first.token)
    const other = await createTicketCredential("ticket-b", key)
    expect(other.tokenHash).not.toBe(stored.tokenHash)
  })

  it("rejects a ciphertext moved to another ticket, tampering and the wrong key", async () => {
    const stored = await createTicketCredential("ticket-a", key)
    await expect(
      recoverTicketCredential("ticket-b", stored.ciphertext, key)
    ).rejects.toThrow()
    await expect(
      recoverTicketCredential("ticket-a", stored.ciphertext, "B".repeat(43))
    ).rejects.toThrow()
    const parts = stored.ciphertext.split(".")
    parts[2] = `${parts[2]?.startsWith("A") ? "B" : "A"}${parts[2]?.slice(1)}`
    await expect(
      recoverTicketCredential("ticket-a", parts.join("."), key)
    ).rejects.toThrow()
  })

  it("fails closed before issuing a ticket when the dedicated key is missing", async () => {
    await expect(
      createTicketCredential("ticket-a", undefined)
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
    })
  })
})
