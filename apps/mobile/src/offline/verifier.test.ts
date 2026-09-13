import { describe, expect, it } from "vite-plus/test"
import { Buffer } from "node:buffer"
import { offlinePageDigest } from "@elc/shared"
import { createSnapshotVerifier } from "./verifier"
import { signingFixture, snapshotFixture } from "./test-fixture"

const binding = { accountId: "scanner", eventId: "event", deviceId: "device" }
describe("native pinned ES256 snapshot verification", () => {
  it("accepts WebCrypto signatures with either S representation and complete out-of-order pages", async () => {
    const signing = await signingFixture()
    const now = Date.now()
    const fixture = await snapshotFixture(signing, now, 201)
    const verify = createSnapshotVerifier(signing.pin)
    const signature = Buffer.from(fixture.manifest.signature, "base64url")
    const order = BigInt(
      "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"
    )
    const s = BigInt(`0x${signature.subarray(32).toString("hex")}`)
    const alternate = Buffer.concat([
      signature.subarray(0, 32),
      Buffer.from((order - s).toString(16).padStart(64, "0"), "hex"),
    ])
    expect(
      await verify(fixture.manifest, [...fixture.pages].reverse(), binding, now)
    ).toHaveLength(201)
    expect(
      await verify(
        { ...fixture.manifest, signature: alternate.toString("base64url") },
        fixture.pages,
        binding,
        now
      )
    ).toHaveLength(201)
  })
  it("rejects partial, duplicated, tampered or incorrectly bound pages and manifests", async () => {
    const signing = await signingFixture()
    const now = Date.now()
    const fixture = await snapshotFixture(signing, now, 101)
    const verify = createSnapshotVerifier(signing.pin)
    expect(
      await verify(fixture.manifest, fixture.pages.slice(0, 1), binding, now)
    ).toBeNull()
    expect(
      await verify(
        fixture.manifest,
        [fixture.pages[0], fixture.pages[0]],
        binding,
        now
      )
    ).toBeNull()
    const altered = structuredClone(fixture.pages)
    altered[0]!.tickets[0]!.attendeeName = "tampered"
    expect(await verify(fixture.manifest, altered, binding, now)).toBeNull()
    for (const field of ["accountId", "eventId", "deviceId"] as const)
      expect(
        await verify(
          fixture.manifest,
          fixture.pages,
          { ...binding, [field]: "another" },
          now
        )
      ).toBeNull()
    expect(
      await verify(
        { ...fixture.manifest, eventId: "another" },
        fixture.pages,
        binding,
        now
      )
    ).toBeNull()
    expect(
      await verify(fixture.manifest, fixture.pages, binding, now - 1)
    ).toBeNull()
    expect(
      await verify(
        fixture.manifest,
        fixture.pages,
        binding,
        Date.parse(fixture.manifest.expiresAt)
      )
    ).toBeNull()
    const other = await signingFixture()
    expect(
      await createSnapshotVerifier(other.pin)(
        fixture.manifest,
        fixture.pages,
        binding,
        now
      )
    ).toBeNull()
    expect(() =>
      createSnapshotVerifier({
        ...signing.pin,
        publicJwk: { ...signing.pin.publicJwk, d: "private" },
      })
    ).toThrow()
  })
  it("rejects a correctly signed manifest containing duplicate ticket hashes", async () => {
    const signing = await signingFixture()
    const now = Date.now()
    const fixture = await snapshotFixture(signing, now)
    fixture.pages[0]!.tickets[1]!.tokenHash =
      fixture.pages[0]!.tickets[0]!.tokenHash
    const { signature: _, ...unsigned } = fixture.manifest
    unsigned.pages[0]!.digest = await offlinePageDigest(fixture.pages[0]!)
    const manifest = { ...unsigned, signature: await signing.sign(unsigned) }
    expect(
      await createSnapshotVerifier(signing.pin)(
        manifest,
        fixture.pages,
        binding,
        now
      )
    ).toBeNull()
  })
})
