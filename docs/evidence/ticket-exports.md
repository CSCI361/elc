# Ticket PDF and calendar export evidence

Recorded on 2026-09-13. The export module implements the printable-ticket fields in SRS Sections 4.7 and 7 and the calendar requirements in Section 4.11, with the access and snapshot rules in [architecture-decisions.md](../architecture-decisions.md).

## Protected canonical PDFs

`GET /api/tickets/:ticketId/pdf?locale=kk|ru|en` requires a verified active purchaser account or `event:manage` permission for the ticket's event. Scanner permission alone does not grant a PDF or raw admission credential. Authorization precedes the credential and R2 reads, and is checked again after rendering and storage I/O.

The PDF includes the event title, date/time and IANA zone, venue name/address, ticket type, attendee, assigned section/row/seat when present, ticket and order identifiers, current status, face price and whole-order discount/total. It labels all payment amounts as sandbox records. A black vector QR with a four-module quiet zone carries the same opaque admission payload recovered for the digital ticket. It has no separate issuance or admission path.

The renderer uses `pdf-lib` 1.17.1, `@pdf-lib/fontkit` 1.1.1 and `qrcode-generator` 2.0.4. It works from bytes and QR modules without a filesystem, canvas or browser process. The bundled OFL Noto Sans font covers Kazakh, Russian and English. Its source, license and digest are documented beside the [font asset](../../apps/api/src/exports/assets/README.md). Custom font embedding follows the [PDF-LIB API](https://pdf-lib.js.org/docs/api/classes/pdfdocument#embedfont).

PDFs are stored under private R2 keys containing the ticket ID, locale and a hash of all printed fields, canonical token hash and renderer version. A changed event, attendee, seat, price or admission state selects a new object. Missing objects regenerate from canonical records. Cached objects remain behind the same download authorization; responses use `private, no-store`, attachment disposition and `nosniff`. Older private objects are not reachable through a caller-selected key. Their eventual retention cleanup still needs the general retention worker.

## Calendar snapshots

`GET /api/events/:eventId/calendar` returns a download URL, Google/Outlook event-creation links and a localized replacement note. `GET /api/events/:eventId/calendar.ics` returns the file. Both apply the existing event read rules, including accepted private invitations and revocation. The exports contain event details only, with no attendee, order, ticket or invitation credentials.

The file keeps `calendar_uid` and `calendar_sequence` from D1 and includes updated timestamps, start/end, venue, description, URL and cancellation status. It uses CRLF, escaped text and UTF-8-aware 75-octet folding. IANA time-zone observances cover both event endpoints and adjacent years; work is bounded for unusually long events. An ambiguous second occurrence during a daylight-saving fallback uses its UTC instant. These fields follow [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545).

Cancellation retains the UID and current sequence, sets `STATUS:CANCELLED`, and removes event-creation links from the response. The export does not increment sequence itself; event mutations own that change. Creation links are labeled as creation actions, and the replacement note instructs the attendee to remove the old entry, import the revised file and check that one entry remains. Imports save snapshots and do not automatically receive updates, as documented by [Microsoft](https://support.microsoft.com/en-us/outlook/import-or-subscribe-to-a-calendar-in-outlook-com-or-outlook-on-the-web).

## Verification

`vp test apps/api/src/exports/exports.integration.test.ts` passed all 11 integration tests with real local D1 and R2. Fixtures execute activation, assigned-seat checkout, normalized payment success and canonical issuance before rendering. Coverage includes locale output, private caching, regeneration without credential changes, successful scanning of the canonical credential, purchaser/manager access, scanner denial before R2 reads, revocation during generation, event/status changes, private invitation access, cancellation, text injection and line folding, and daylight-saving fallback.

`ELC_WRITE_EXPORT_SAMPLES=1 vp test apps/api/src/exports/exports.integration.test.ts` writes three disposable samples under `test-results/ticket-exports`. Poppler rendered the kk, ru and en samples at 150 dpi in grayscale. Visual inspection found one A4 page per sample, legible Cyrillic/Kazakh text, clear identifiers and prices, and no overlap or clipping. Text extraction confirmed the required multilingual fields. The sample PDFs contain no opening action or encryption.

The local macOS verifier in `apps/api/src/exports/verify-pdf-qr.swift` used Vision to decode each rendered QR. All three matched the canonical admission token hash from the disposable D1 fixture. The verifier prints only the comparison result, never the token. This is raster-image verification, not a physical print or native mobile acceptance test.

`vp run verify:local-ticketing` passed against the running Worker at `http://localhost:5173`. Real email verification and sign-in sessions led to free issuance, protected downloads in all three languages, scanner PDF denial, unchanged digital credentials, calendar files/links, and the existing scan/retry/reversal flow. This proves the bundled font and PDF libraries execute inside the local Worker. The script deleted only its synthetic D1 records and exact-ticket private R2 prefixes and verified cleanup. Formatting, lint and type checks passed for the exports and HTTP verification script.

## Remaining acceptance

Physical grayscale A4 scanning on supported iOS/Android devices remains pending. Google Calendar web, Outlook web and Apple Calendar iOS/macOS import, time-zone display, update replacement and cancellation procedures still need checks that leave one entry per event. No automatic calendar synchronization is implemented or claimed. Frontend buttons, external ticket email, background PDF delivery jobs and remote R2/Worker deployment are separate integration work; these tests do not establish their completion.
