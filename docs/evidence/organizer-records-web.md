# Organizer registration records

The organizer registrations page at `/organizer/events/:eventId/registrations` reads the event-scoped records API. It provides Kazakh, Russian, and English views for attendees, orders, and check-ins. It contains no mutation controls and does not request ticket credentials, admission QR codes, buyer contacts, or purchaser checkout data.

Search, view selection, exact order and ticket filters, and keyset pagination are stored in the URL. Native GET forms preserve browser navigation. Changing views drops the old cursor while preserving search and exact filters. Record links clear unrelated search and identifiers so the linked order or ticket remains visible. First-page and next-page links retain the current filters. Invalid and duplicate query parameters produce a resettable error instead of silently changing the query.

Attendee cards show ticket type, seat, ticket state, admission blocks, active check-in references, and unresolved offline admission reports. The offline warning explicitly distinguishes a report from server-confirmed admission. Order cards label monetary values as original order amounts; they do not present a pending order total as received payment. Refund state and amount are separate. Check-in cards retain capture and server commit times plus reversal time, actor reference, and reason.

Each response displays its server snapshot timestamp and the event's time zone. The existing retention component shows the retention deadline and any hold reasons. Related editor, history, analytics, support, and refund links follow independent server capability flags. Refund navigation uses the existing authorized refund page. Links to exact order and ticket views remain within the records endpoint.

The page polls every 15 seconds while visible and refreshes on window focus through the existing resource hook. Any failed read removes private records and related actions. Loading, no matches, invalid filters, denied access, and retry states have localized labels. Content is keyed to the current account and event. A single-column layout below 760 px, wrapping identifiers, semantic descriptions, labelled search, native navigation links, and touch targets support narrow screens and keyboard use.

## Scoped checks

- `vp check --fix apps/web/src/organizer-records`: passed with no lint or type errors.
- `vp test apps/web/src/organizer-records/policies.test.ts`: 24 tests passed.

The policy suite checks query limits, duplicate parameters, encoded names and identifiers, opaque cursor round trips, first/next-page filters, cursor reset between views, exact-record drilldown, and independent capability links. It also guards against introducing purchaser checkout or admission credential links.

## Browser integration

The private runner `.wrangler/web-organizer-records-acceptance.mjs` passes against
real local HTTP authentication, Worker routes and D1. Its result is stored in
`.wrangler/web-organizer-records-results.json`. It creates 23 free tickets,
cancels one registration, and records a check-in, reversal and subsequent
canonical admission through the existing APIs.

The browser verifies the editor link, all three locales at 390 pixels, attendee
pagination over 20 then three records, name search, order-to-ticket drilldown,
and retained reversal details. History-only staff can read records without
financial or management links. Revoking their grant clears previously displayed records on automatic window-focus
refresh. A simulated failed focus refresh also clears private data and capability
links without resetting the request version through a manual reload. No
page errors occurred, and all synthetic accounts and event records were removed.
The Russian phone overview and attendee-card screenshots were visually inspected.

Full checks pass across 430 files. All builds pass, with the existing web bundle size warning (664.24 kB entry).
Full regression passes 1,264 tests across 77 files in 574.34 seconds.
These checks do not establish deployment or physical-device acceptance.
