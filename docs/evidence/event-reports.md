# Reported event review evidence

Implemented on 2026-09-14 for SRS §4.12, "Review reported events". The
architecture document did not define reporting, so two product decisions were
confirmed with the team before implementation:

- Only verified, unsuspended accounts may report an event. Each account has at
  most one open report per event; submitting again updates that report.
- Platform moderators resolve a report as dismissed or action taken. Every
  resolution records a reason and an audit entry. Action taken requires the
  event to be suspended first through the existing audited suspension.

## Data model

Migration `0032_event_reports.sql` adds `event_reports` with the event,
reporter, category, details, state, revision, resolver, resolution reason and
timestamps. A partial unique index allows one open report per event and
reporter. A check constraint bounds details to 1–1,000 characters and requires
resolved rows, and only resolved rows, to carry a resolver, time and a 1–500
character reason. Indexes support the state queue, per-event open counts and
reporter lookups.

Retention deletes an event's reports in the same transaction that retires the
event. Inactive-account cleanup keeps any account that filed or resolved a
retained report.

## API

| Method and path                                      | Access and behavior                                                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/events/:eventId/reports`                  | Verified, unsuspended account that can read the event and is not its organizer. Creates or updates the open report.        |
| `GET /api/admin/event-reports`                       | Current `platform:moderate`. Filters by state and event with 20-record pages and cursors bound to the moderator and query. |
| `POST /api/admin/event-reports/:reportId/resolution` | Current `platform:moderate`, the report's current revision, a resolution and a reason.                                     |

Contracts live in `packages/shared/src/event-reports-api.ts`. Reporting a
private, unpublished, suspended or missing event returns `NOT_FOUND`, so the
endpoint cannot be used to discover hidden events. Queue items expose the
reporter ID but never an email address.

Submissions and resolutions use request receipts, so an exact retry replays the
stored response and a reused request ID with different input returns
`CONFLICT`. Each write is one D1 batch that asserts current authority and the
read revision before changing the row. Resolution rechecks moderation access
inside the batch and again after commit, and "action taken" asserts the event
suspension in the same batch.

## Web

The event detail page shows a collapsible report form to signed-in accounts
that do not organize the event; it is hidden in organizer preview. The platform
administration workspace adds `/admin/reports` for moderators, with a state
filter, report cards showing category, details, event status, open count,
reporter ID and submission time, and a resolution form on open reports. Choosing
action taken before suspension explains the requirement and links to the events
section. All strings have Kazakh, Russian and English translations.

## Verification

- `apps/api/src/reports/reports.integration.test.ts`: 12 tests on migrated D1
  cover creation and update, exact replay and request-ID reuse, unverified,
  suspended and organizer reporters, hidden events, input bounds, moderator-only
  queue access with counts and no emails, dismissal with audit, action taken
  only after suspension, stale revisions, authority revoked before commit,
  reopening after resolution, cursor binding and a lost resubmission race.
- `apps/api/src/retention/retention.integration.test.ts`: two new tests cover
  report deletion with the event and keeping reporter and resolver accounts.
- `apps/web/src/reports/policies.test.ts`: 6 tests cover report and resolution
  validation, the suspend-first rule, queue URLs and complete translations.
- An independent code review found one high-severity race: two concurrent
  resubmissions could both report success while one edit was lost. A failing
  test reproduced it, and the update now asserts the read revision before
  writing. No other issues were found.
- A disposable Playwright run against the local Worker passed all 19 checks:
  organizers see no form on their own event, a reporter's submission and
  resubmission update one open report, the queue renders in all three locales at
  390 pixels without overflow, the card shows no email, action taken is blocked
  until suspension and then resolves with one audit entry, the resolved filter
  hides the form, a non-moderator receives HTTP 403, and a suspended event can no
  longer be reported. Its accounts, events, reports, mail rows and R2 payloads
  were removed.
