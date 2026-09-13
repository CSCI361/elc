# Saved organizer profile

`OrganizerProfilePanel` provides Kazakh, Russian, and English editing for the account's saved organizer profile. It reads `/me/organizer-profile` and saves through the shared PATCH contract. Fields match the activation profile schema: display name, simulated legal name, organizer contact, and a dummy payout reference. The page explains that the profile is an academic simulation, requires the `DEMO-` reference format, and does not activate events.

The form displays the reviewed revision and saved timestamp. A missing profile starts with empty fields. Background reads report newer revisions without replacing unsaved values. A stale response requires an explicit discard-and-reload before further editing. Locale changes preserve the form because locale is not a component key.

Each save holds its reviewed revision, normalized payload, and request ID together. An uncertain retry of the same payload retains its identity; a changed payload or explicitly changed revision receives a new one. Saves cannot overlap. A successful mutation acknowledgement triggers a fresh GET. The panel does not accept a subsequent response older than the acknowledged revision. If that read fails, retrying loads the profile without sending another save.

Transient read errors hide profile fields while preserving the pending request identity in component memory. Permission loss clears fields and pending payloads. The panel checks access on window focus and every 15 seconds while visible. Reads and writes abort on unmount; root integration keys the panel by account ID. No profile or request payload is stored in browser storage.

`SavedOrganizerProfileButton` fetches the current saved profile only when clicked and calls `onUse(profile)` once after a successful read. It never saves or changes identity, payout-check, or terms choices itself. Its optional `disabled` and `onPendingChange` props let the activation form prevent prefill/save races. The pending callback returns to false on completion or aborted unmount. Missing profile, access denial, loading, and failure states are localized.

## Scoped verification

- `vp check --fix apps/web/src/organizer-profile`: no formatting, lint, or type errors.
- `vp test apps/web/src/organizer-profile/policies.test.ts`: 22 tests passed.

The tests cover exact retry identity, changed payload and revision identities, canonical whitespace, field and dummy-reference limits, invalid revisions, missing profile initialization, preservation of unsaved fields during background reads, and explicit replacement.

## Browser integration

The private `.wrangler/web-organizer-profile-acceptance.mjs` runner passes real
local HTTP authentication, account profile saves and event activation-form use.
Its result is in `.wrangler/web-organizer-profile-results.json`. It verifies an
absent read without locale writes, a lost save acknowledgement followed by the
same request after a background read, one audit entry, and another account's
independent empty profile. Locale changes preserve the saved fields.

Kazakh, Russian and English forms fit a 390-pixel viewport. The first run exposed
a Russian discard-button overflow; a maximum-width constraint fixes it. The
final complete run passes and the Russian profile screenshot was visually
inspected. Stale server updates preserve the local draft and require explicit
reload before further editing.

Activation prefill runs only on request, disables save while its GET is pending,
and preserves identity/payout choices and terms acceptance. The event changes
only after a separate checklist save. A later account profile edit preserves
that event's checklist, eligibility, terms and fee data. Failed automatic reads
hide private fields; read-only retries recover them, and suspension clears them.
No browser errors occurred, and all synthetic accounts and event fixtures were
removed. No payment provider was called by this browser run.

Full checks pass across 440 files and web/Worker/Astro builds pass, with the
existing bundle warning (665.07 kB web entry). Full regression passes 1,316
tests across 79 files in 548.22 seconds. The first run exposed an existing
authentication-email fixture clock race; commit `e7b287e` aligns JWT and delivery
clocks, and the fresh full run passes.
The migration through 0030 and the new retention cascade check pass. The 34
backup safety checks and disposable full-schema restore rehearsal also pass.
This is local evidence; remote lifecycle, identity services and bank setup are
outside these checks.
