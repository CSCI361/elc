# Consent and public GA4 collection

The React app and Astro marketing site now share a consent controller and Google
tag transport. Each origin stores its own explicit choice under
`elc.analytics-consent.v1`. The initial state is undecided and collection is off.
No tag, analytics request or public-event reporting-context request starts until
the visitor allows analytics. Consent controls remain available on protected
pages. Kazakh, Russian and English copy explains the choice and withdrawal.

The collector accepts fixed page kinds, reporting IDs, locale, currency, amount
and quantity. It constructs page locations from the origin and reporting ID,
uses fixed titles, and sends an empty referrer. It never forwards the current
URL, search query, campaign code, event title, attendee name, email, order ID or
admission credential. Campaign parameters supplied by the Google tag are set to
empty values. Automatic page views, Google Signals, ad personalization and
User-ID are disabled. The tag uses a dedicated data layer and host-only cookies
with an application prefix and a 60-day lifetime without rolling renewal.
[Google tag configuration](https://developers.google.com/analytics/devguides/collection/ga4/reference/config)

Only the public directory, confirmed public event details and approved marketing
home routes receive page views. Event details also emit `view_item`; an active,
resolved public campaign adds `campaign_visit`. A successful reservation emits
`begin_checkout` with its canonical amount and selected quantity before entering
the protected order page. Collection is best effort and never delays checkout.
A changed promo code does not inherit the previous campaign's reporting ID.

The public context endpoint accepts a bounded campaign code in a POST body and
returns only reporting IDs. One D1 statement requires a currently public,
published, unsuspended event and resolves any campaign within that event and its
active validity window. Private and unlisted events return 404 even to owners.
The browser checks the returned event reporting ID against the event it loaded.

Withdrawal sets Google's per-stream disable flag before any further events,
discards pending application commands and removes application-controlled
analytics cookies. It propagates to other same-origin tabs through the storage
event. A subsequent opt-in requires fresh page context. Navigation disables the
previous document; protected pages never initialize the tag. The transport does
not load a denied-consent tag, which could otherwise send cookieless requests.
[Google privacy controls](https://developers.google.com/tag-platform/security/guides/privacy),
[consent behavior](https://developers.google.com/tag-platform/security/concepts/consent-mode)

## Validation

All 26 controller/transport tests and eight D1 context tests pass, together with
18 existing shared contract tests. The complete suite passes 1,044 tests across
68 files in 436 seconds. Full checks and web/Worker/Astro builds pass; the web
entry is 644.04 kB minified and retains the existing bundle-size warning. They cover opt-in, denied and malformed saved
choices, cross-tab withdrawal, cookie isolation, protected page kinds, sanitized
payloads, invalid values, changed campaign attribution, storage/transport
failures and current public-event eligibility.

Browser acceptance uses real local BetterAuth sessions, public/private event
records, a campaign and an actual reservation. The test injects synthetic stream
IDs and intercepts the Google tag. Before consent there is no tag or context
request. After consent, captured commands contain only approved metadata.
Withdrawal reaches another tab and removes the prefixed cookies. The checkout
emits its amount and quantity without the attendee name, and the order page
loads no tag. Private-event collection is rejected. The consent controls fit
390-pixel screens in all three locales. Marketing requires an independent
choice on its separate origin. The completed run has no page errors, and all
synthetic accounts, events, campaign allocations, reservations and private
mailbox records were removed.

The ignored script and result are `.wrangler/web-consent-acceptance.mjs` and
`.wrangler/web-consent-results.json`. An initial marketing test intercepted the
HTML document, which triggered Chromium's local-network restriction and an Astro
HMR error loop. Injecting only the synthetic configuration into the DOM fixed the
test setup. No application or browser security setting was weakened.

Live collection, Google-side processing and the dedicated property's settings
still require external acceptance. The intercepted tag establishes application
payload and consent behavior; it does not establish that Google received data.
