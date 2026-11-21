import {
  activationProfileSchema,
  type OrganizerProfileResponse,
  type UpdateOrganizerProfile,
} from "@elc/shared"

export type OrganizerProfile = NonNullable<OrganizerProfileResponse["profile"]>
export const emptyOrganizerProfile: OrganizerProfile = {
  displayName: "",
  legalName: "",
  contact: "",
  dummyPayoutReference: "",
}
// The API only accepts payout references in this prefixed form.
const payoutPrefix = "DEMO-"
export function payoutReferenceText(stored: string): string {
  return stored.startsWith(payoutPrefix)
    ? stored.slice(payoutPrefix.length)
    : stored
}
export function payoutReferenceValue(typed: string): string {
  return typed ? payoutPrefix + typed : ""
}
export type ProfileAttempt = {
  signature: string
  input: UpdateOrganizerProfile
}

export function profileAttempt(
  previous: ProfileAttempt | null,
  profile: OrganizerProfile,
  revision: number,
  requestId: () => string
): ProfileAttempt | null {
  const parsed = activationProfileSchema.safeParse(profile)
  if (!parsed.success || !Number.isSafeInteger(revision) || revision < 0)
    return null
  const signature = JSON.stringify({
    expectedRevision: revision,
    profile: parsed.data,
  })
  return previous?.signature === signature
    ? previous
    : {
        signature,
        input: {
          expectedRevision: revision,
          profile: parsed.data,
          requestId: requestId(),
        },
      }
}

/** Background reads report changes without rebasing an unsaved form. */
export function observedProfile(
  previous: {
    baseline: OrganizerProfileResponse | null
    draft: OrganizerProfile
  },
  current: OrganizerProfileResponse,
  replace: boolean
) {
  return replace || previous.baseline === null
    ? {
        baseline: current,
        draft: current.profile ?? { ...emptyOrganizerProfile },
      }
    : previous
}
