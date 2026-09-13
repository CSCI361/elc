# Offline operations access and cached attendees

`GET /offline/events` discovers owned events and events with a current scanning
or admission-review assignment. It supports bounded cursor pagination. Platform
moderators discover other events through the existing administration list.
`GET /events/:eventId/offline/access` returns the current event title and separate
capabilities for managing devices, reviewing admissions and opening an incident
support case. This lets review-only staff reach their work without an event-edit
permission.

Device management remains limited to the owner or `platform:moderate`.
Admission review remains limited to the owner or `checkin:review`. Opening an
organizer/platform incident case remains an owner operation. The new access
response grants no support-case reading, scanning or mutation authority.
Individual endpoints continue to enforce their own permissions.

Device and admission list readers now return rows from a final authorized D1
batch. Empty pages check current authority too. Losing management permission
while reading a device list rejects that response; a fresh request can still
return the caller's own devices under the existing policy. Admission lists
reject revoked reviewers, and discovery rereads the active account and current
event relationships. Cursor scope includes the actor and list context.

## Cached mobile attendee details

The encrypted attendee search shows the seat section, row, number and accessible
seat marker alongside the downloaded ticket status. Labels in KK/RU/EN state
that these facts come from the signed snapshot. They do not account for later
server changes or pending local scans and do not authorize entry. Scanning
remains the admission decision path.

Explicit admission blocks and invalidated ticket states take precedence over
historical check-in identifiers. Incomplete cached seat data does not produce a
fabricated seat label. Search results are scoped to the account, event, snapshot
and query so results from an earlier selection remain hidden while a new search
runs.

## Verification

The migrated-D1 offline and scanner suites plus mobile presentation cases pass
75 tests across three files in 94.37 seconds. This includes 17 new API cases and
14 new presentation cases. The initial API run exposed two incomplete test
fixtures missing `profiles.updated_at`; the fixtures were corrected and all
cases passed on the fresh run.

API cases cover owner/reviewer/scanner/moderator separation, unrelated roles,
review-only discovery, pagination, cursor isolation, revoked management and
review access, and suspension or deletion during empty-list reads. Existing
canonical synchronization, review and scanner tests remain green.

Mobile type checking and Metro exports for iOS and Android pass. These exports
establish that the new code bundles for both platforms; physical device and
SQLCipher runtime acceptance remain pending. This host currently has no `adb`
command, and `xcrun xctrace list devices` reports that the utility is unavailable,
so connected-device inspection could not run through those tools.

```sh
vp test apps/mobile/src/offline/attendee-display.test.ts apps/api/src/offline/offline.integration.test.ts apps/api/src/offline/scanner.integration.test.ts --maxWorkers=1
vp run --filter @elc/mobile typecheck
vp run --filter @elc/mobile bundle
```

Integrated validation passes 1,408 tests across 84 files in 633.07 seconds. Full
checks pass 457 files; web/Worker/Astro builds pass. The backup rehearsal is
validated separately by its 34 safety cases and two nonempty restore cases.
