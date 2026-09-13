# Organizer profile

SRS §4.1 requires organizers to have a profile containing contact and payout information. `GET` and `PATCH /api/me/organizer-profile` provide that profile for the current verified, active account. They use the separate `organizer_profiles` table. Saving organizer details does not create or update the `profiles` row used for locale preferences and moderation, or change Better Auth identity fields.

GET returns the saved display name, legal name, contact and dummy payout reference, with a revision and update time. A missing profile returns `profile: null`, revision 0 and a null update time without writing anything. PATCH accepts a request ID, expected revision and the complete profile. Its response contains only the committed revision and update time; the client reloads GET to display current data.

The shared activation profile schema supplies the field limits: display name 1–120 characters, legal name 1–200, contact 3–200, and a `DEMO-` payout reference containing 3–60 allowed letters, digits, underscores or hyphens. Fields are trimmed and the request is strict. The endpoint rejects real-looking payout references outside that dummy format and accepts no identity documents or bank credentials. A 4 KiB request limit runs before identity or database lookup. Invalid fields return `INVALID_INPUT` with status 400; oversized bodies use status 413.

## Authority and retries

The session supplies the account ID. Request bodies cannot select another account or change locale, verification, moderation or event permissions. GET selects the profile and current verified/non-suspended account in one statement. Responses use `Cache-Control: private, no-store` and `Vary: Cookie`.

PATCH atomically writes the profile, request receipt and generic account audit entry. Its transaction guards the active account and expected profile revision. Concurrent edits at the same revision cannot both commit. The profile has its own revision; locale updates and moderation revisions remain independent. Update timestamps do not move backwards when the application clock falls behind the previous profile update.

Receipts store a hash of the normalized operation and a stable acknowledgement containing revision and time. Replaying the same request returns that acknowledgement even after a later edit. Changed input or another operation using the same request ID returns `CONFLICT` with status 409. Lost D1 acknowledgements are recovered through the same receipt. Current account authority is checked with the receipt on replay and before a successful return. Revoked accounts receive `FORBIDDEN` with status 403; an unauthenticated route request requires sign-in.

Audit entries identify the account and operation with the description "Organizer profile updated." They contain no contact, legal name, display name or payout-reference values. Receipt responses also exclude those values. A failed audit insertion rolls back the profile and receipt together.

## Activation and retention

The save operation does not write events, event activations, activation checklist history, activation attempts, terms acceptance, paid-sales state or payment records. Existing and confirmed event checklists retain their own saved details. The web application may explicitly copy a saved profile into an event form, but saving that event checklist remains a separate operation.

The organizer profile references its account with cascading deletion. It does not independently keep an otherwise eligible inactive account alive. The existing account audit follows the 180-day retention policy and can postpone account deletion until it expires. Existing retained event, order and support relationships still apply.

`organizerProfileRoutes` and `createOrganizerProfileRoutes` are exported from `apps/api/src/organizer-profile/index.ts` for mounting at `/api`. The factory accepts identity and lifecycle hooks for isolated verification.

## Local verification

The integration tests use real migrations and D1. They cover non-mutating absent reads, normalized creation and updates, competing revisions, concurrent identical retries, a lost database acknowledgement, stable replay after later edits, cross-account and cross-operation isolation, account revocation, audit rollback, invalid fields, the body limit, and private response headers. Locale and moderation preservation checks include a concurrent preference update. A canonical successfully activated event and payment fixture verifies that later account-profile changes leave every event checklist and payment snapshot unchanged. Retention tests run the actual audit cleanup and inactive-account deletion functions and verify cascading organizer-profile removal. Payment fixtures use synthetic provider confirmation only.

All 30 focused integration cases passed in 28.80 seconds. The final scoped check passed formatting for four files and reported no warnings, lint errors or type errors in three TypeScript files.

Run `vp check apps/api/src/organizer-profile docs/evidence/organizer-profile-api.md` and `vp test apps/api/src/organizer-profile/profile.integration.test.ts --maxWorkers=1`. Browser acceptance is recorded separately.

The integrated profile unit passes the full regression: 1,316 tests across 79
files in 548.22 seconds, with full checks across 440 files and web/Worker/Astro
builds. See [browser evidence](./organizer-profile-web.md).
