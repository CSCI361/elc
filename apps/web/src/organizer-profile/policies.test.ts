import { activationProfileSchema } from "@elc/shared"
import { describe, expect, it, vi } from "vite-plus/test"
import {
  emptyOrganizerProfile,
  observedProfile,
  payoutReferenceText,
  payoutReferenceValue,
  profileAttempt,
} from "./policies"

const profile = {
  displayName: "Organizer",
  legalName: "Demo Company",
  contact: "contact@example.test",
  dummyPayoutReference: "DEMO-ORGANIZER",
}
const saved = { profile, revision: 4, updatedAt: "2026-09-13T08:00:00.000Z" }

describe("organizer profile save identity", () => {
  it("reuses the exact request ID and reviewed revision after an uncertain response", () => {
    const id = vi
      .fn()
      .mockReturnValueOnce("request-1")
      .mockReturnValueOnce("request-2")
    const first = profileAttempt(null, profile, 4, id)
    expect(first?.input).toEqual({
      profile,
      expectedRevision: 4,
      requestId: "request-1",
    })
    expect(profileAttempt(first, { ...profile }, 4, id)).toBe(first)
    expect(id).toHaveBeenCalledTimes(1)
  })
  it("assigns new identities to changed payloads and explicit revision changes without modifying the previous attempt", () => {
    const first = profileAttempt(null, profile, 4, () => "request-1")
    const changed = profileAttempt(
      first,
      { ...profile, displayName: "New name" },
      4,
      () => "request-2"
    )
    const rebased = profileAttempt(first, profile, 5, () => "request-3")
    expect(changed?.input.requestId).toBe("request-2")
    expect(rebased?.input).toMatchObject({
      requestId: "request-3",
      expectedRevision: 5,
    })
    expect(first?.input).toEqual({
      requestId: "request-1",
      expectedRevision: 4,
      profile,
    })
  })
  it("normalizes schema whitespace before comparing payload identity", () => {
    const first = profileAttempt(null, profile, 0, () => "request-1")
    expect(
      profileAttempt(
        first,
        {
          ...profile,
          displayName: " Organizer ",
          dummyPayoutReference: " DEMO-ORGANIZER ",
        },
        0,
        () => "unexpected-new-id"
      )
    ).toBe(first)
  })
  it.each([
    { displayName: " " },
    { displayName: "x".repeat(121) },
    { legalName: "" },
    { legalName: "x".repeat(201) },
    { contact: "ab" },
    { contact: "x".repeat(201) },
    { dummyPayoutReference: "KZ12345678901234567890" },
    { dummyPayoutReference: "4111111111111111" },
    { dummyPayoutReference: "DEMO-ab" },
    { dummyPayoutReference: "DEMO-" + "x".repeat(61) },
    { dummyPayoutReference: "DEMO-with space" },
    { dummyPayoutReference: "https://bank.example/account" },
  ])("rejects invalid profile %j before creating a request", (change) => {
    const id = vi.fn()
    expect(profileAttempt(null, { ...profile, ...change }, 0, id)).toBeNull()
    expect(id).not.toHaveBeenCalled()
  })
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid revision %s",
    (revision) => {
      expect(profileAttempt(null, profile, revision, () => "id")).toBeNull()
    }
  )
  it("accepts the schema's maximum field lengths and dummy reference boundary", () => {
    expect(
      profileAttempt(
        null,
        {
          displayName: "d".repeat(120),
          legalName: "l".repeat(200),
          contact: "c".repeat(200),
          dummyPayoutReference: "DEMO-" + "x".repeat(60),
        },
        0,
        () => "id"
      )
    ).not.toBeNull()
  })
})

describe("organizer profile read reconciliation", () => {
  it("initializes missing and saved profiles from their first authorized response", () => {
    const initial = { baseline: null, draft: { ...emptyOrganizerProfile } }
    expect(observedProfile(initial, saved, false)).toEqual({
      baseline: saved,
      draft: profile,
    })
    const missing = { profile: null, revision: 0, updatedAt: null }
    expect(observedProfile(initial, missing, false)).toEqual({
      baseline: missing,
      draft: emptyOrganizerProfile,
    })
  })
  it("never silently rebases an unsaved form on a newer background read", () => {
    const current = {
      baseline: saved,
      draft: { ...profile, legalName: "Unsaved fictional name" },
    }
    const later = {
      ...saved,
      revision: 5,
      profile: { ...profile, contact: "new@example.test" },
    }
    expect(observedProfile(current, later, false)).toBe(current)
    expect(current.baseline.revision).toBe(4)
    expect(current.draft.legalName).toBe("Unsaved fictional name")
  })
  it("replaces fields and revision only after explicit reload or acknowledged save", () => {
    const current = {
      baseline: saved,
      draft: { ...profile, legalName: "Unsaved fictional name" },
    }
    const later = {
      ...saved,
      revision: 5,
      profile: { ...profile, contact: "new@example.test" },
    }
    expect(observedProfile(current, later, true)).toEqual({
      baseline: later,
      draft: later.profile,
    })
    expect(current.baseline.revision).toBe(4)
  })
})

describe("payout reference field", () => {
  it("should show a saved reference without the stored prefix", () => {
    expect(payoutReferenceText("DEMO-ORGANIZER")).toBe("ORGANIZER")
  })

  it("should store typed text in the format the API accepts", () => {
    const value = payoutReferenceValue("ORGANIZER")
    expect(value).toBe("DEMO-ORGANIZER")
    expect(
      activationProfileSchema.safeParse({
        ...profile,
        dummyPayoutReference: value,
      }).success
    ).toBe(true)
  })

  it("should give back exactly what was typed, even text that starts with the prefix", () => {
    for (const typed of ["D", "DEMO", "DEMO-", "DEMO-2026", "ORGANIZER"])
      expect(payoutReferenceText(payoutReferenceValue(typed))).toBe(typed)
  })

  it("should keep an empty field empty", () => {
    expect(payoutReferenceValue("")).toBe("")
  })
})
