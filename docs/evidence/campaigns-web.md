# Organizer campaign workflow

The organizer page at `/organizer/events/:eventId/campaigns` implements the campaign management workflow from SRS 4.14 and architecture decisions 187–189. The page reads the manager preview and paginated campaign API. All new labels are available in Kazakh, Russian, and English.

Creation defaults to a 10% discount, 100 redemptions, and the event registration window. Managers can select percentage or fixed KZT discounts, dates in the event's time zone, a positive whole redemption limit, and applicable ticket types. Client validation uses the shared campaign schema and exact minor-unit parsing. Every create request explicitly sets `enabled: false`. A separate review action exposes enable or disable controls. Cancelled events allow viewing only.

Commands keep the reviewed event revision and request ID together across uncertain retries. A changed payload receives a new request ID. Stale revisions offer a fresh server read before another review. Successful writes reload both event and campaign data. Transient polling failures disable changes and remove QR/link content while preserving the form and mutation retry identity. Permission failures clear the workspace. Requests used for mutations and QR sharing abort on unmount.

QR generation uses the installed local `qrcode` library. Before showing, copying, or downloading a campaign link, the page rereads the campaign through the manager API. The URL must exactly match this origin's `/events/:eventId?campaign=:code`, with no additional parameters, credentials, or fragment. HTTPS is required. Development builds allow HTTP only on `localhost`, `127.0.0.1`, or `[::1]`; the page and downloaded SVG label this exception as local development only.

The SVG includes the campaign name, a promotional label, and an explicit statement that it is not an admission ticket. User text is escaped. The title wraps into at most four lines above the QR. A four-module quiet zone and integer module scaling preserve QR contrast and edges. No external QR service or image URL is used. Download object URLs are revoked. Locale changes discard previously generated QR content so the next reveal uses the current language.

## Scoped verification

- `vp check --fix apps/web/src/campaigns`: no formatting, lint, or type errors.
- `vp test apps/web/src/campaigns/policies.test.ts`: 40 passing cases. Coverage includes exact KZT and percentage conversion, invalid limits and windows, preserved default window seconds and milliseconds, required unique ticket applicability, unsafe URLs, local-development host boundaries, escaped SVG text, maximum title length, and permanent promotional labels.

## Browser integration

The private runner `.wrangler/web-campaigns-acceptance.mjs` exercises the real
local Worker, D1, R2 and browser application. Its result is recorded in
`.wrangler/web-campaigns-results.json`. It creates and removes isolated accounts,
events, campaigns, activation records, reservations and tickets. The activation
payment is an explicitly synthetic local fixture; this run makes no provider
request and does not establish activation-payment acceptance.

The passing browser run verifies the initial 10%/100-redemption defaults and
exact event window, lost create acknowledgement with one revision and campaign,
explicit enabling, and SVG download/decoding in Kazakh, Russian and English.
The native browser BarcodeDetector decodes the downloaded SVG, and the runner
compares its result with the exact event-scoped campaign URL. The three campaign
cards fit a 390-pixel viewport without horizontal overflow. The Russian card
screenshot was visually inspected.

Following the decoded 10% link creates a KZT 10,000 reservation with a KZT 1,000
discount, KZT 9,000 total and KZT 270 simulated processing fee. That reservation
is released without payment. A separate 100% campaign completes through the
browser with exactly one canonical ticket and one committed campaign redemption.
The admission API rejects the decoded campaign link without a check-in.
Disabling the campaign removes its attendee terms, and suspending its manager
prevents another QR download and clears the organizer workspace. No page errors
were recorded, and all synthetic fixtures were removed.

The expanded run also verifies clipboard-denial fallback with a selectable link,
exact KZT 500.25 fixed-discount creation and resolution, and pagination over 21
campaigns (20 records, then one, then back to the first page). An intermediate
run stopped during the first reservation; a complete rerun passed without a
source change.

The attendee page now resolves campaign codes through the server before showing
terms. It labels the pre-discount subtotal, lists applicable ticket types and
validity, and explains that final discount and availability are checked during
reservation. Changed codes, read failures and expired terms do not reuse old
results. The organizer read API also rechecks current management access before
returning codes; its new revocation regression passes.

Local build and checks pass across 421 source files. Full regression passes
1,207 tests across 75 files in 505.91 seconds. These checks do not establish deployed HTTPS, physical-device
scanning or production payment-provider acceptance.
