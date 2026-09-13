# Event gallery and preview evidence

The organizer editor now supports the image workflow required by SRS section 4.2. An organizer saves a draft before uploading up to five JPEG/PNG images. Every image has editable alternative text; the first image is the cover. Reordering and removal take effect together when the gallery is saved. The editor loads the latest event revision after each successful operation so its event and ticket forms use the current version.

The upload panel preserves the request ID, file and revision when a response is uncertain. If the mutation is acknowledged but its follow-up read fails, retry reloads the gallery without submitting another mutation. Explicitly loading the latest gallery discards unsaved edits. Requests abort when the panel unmounts, local preview URLs are revoked, and image movement/removal restores keyboard focus to the affected item or gallery heading.

Discovery cards show the cover and event details show the ordered gallery. Image components accept only canonical URLs for their event and image IDs. Failed reads show a localized fallback. Organizer edits and detail pages periodically recheck their event access and clear protected content when that read fails.

The organizer's preview link works for drafts and published events. Preview mode uses the management-authorized preview APIs, displays a localized notice and link back to editing, and shows ticket types and assigned seats without purchase controls. It does not initialize event analytics.

## Browser verification

The private local runner `.wrangler/web-event-images-acceptance.mjs` uses the existing agent-browser Chrome session through Playwright, isolated browser contexts, the real Worker API, local D1 and local R2. Its result is saved in `.wrangler/web-event-images-results.json`.

The passing run verifies:

- PNG and JPEG uploads through the editor, returned image decoding and refreshed event revisions.
- A deliberately lost upload acknowledgement, followed by the editor's retry, with one image association and one revision increment.
- Draft galleries in Kazakh, Russian and English at a 390-pixel viewport, with no horizontal overflow, purchase form or analytics script.
- Browser reordering and alternative-text changes that set a new cover.
- Anonymous discovery covers and published galleries delivered through API image URLs with private/no-store and nosniff headers.
- Saved removal immediately rejecting the removed URL; unpublishing rejecting anonymous reads of the retained image.
- No browser page errors, followed by removal of the run's synthetic image objects, events, accounts and private mail data.

The three localized preview screenshots are saved as `.wrangler/web-event-images-preview-{kk,ru,en}.png`; the Russian phone layout was visually inspected. The earlier run stopped at an incorrect test selector that assumed the card image was inside its link. Correcting the selector produced a passing run without a product change.

See [API evidence](./event-images-api.md) for validation, access races, duplication and reference-aware retention tests. This local run does not establish deployed R2 behavior, a full accessibility audit or physical-device/browser-version acceptance.

Full integration passes 1,137 tests across 73 files in 473.37 seconds, checks
across 408 source files, web/Worker/Astro builds, the 34-test backup safety suite
and disposable restore rehearsal, and the local Worker ticketing regression.
