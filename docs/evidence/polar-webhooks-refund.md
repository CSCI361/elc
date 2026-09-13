# Polar signed delivery and fulfilled-order refund

Verified on 2026-09-13 through the running local Worker, its real Polar sandbox
adapter and a temporary HTTPS tunnel. The existing completed mixed-ticket order
was refunded through the application's support and organizer approval APIs.
No new checkout or payment was submitted.

Order `afe29372-a6b2-41e2-9519-5a7de409abac` was completed, eligible for voluntary
refund and held three valid tickets before this run. The buyer opened an attendee
refund case; the organizer approved it at the current order revision. Repeating
the same approval returned the same acknowledgement. Admission was blocked after
approval. Authoritative provider reconciliation confirmed one KZT 9,000 refund
(`900000` minor units), refund `2ffeca61-7cfb-4228-b01d-14dbb46f6331`, for payment
`f7ab71a7-3fb6-4c87-85e5-1340df756327`.

All three canonical tickets became refunded and blocked. Their original
credentials each returned `refunded` from the online check-in API, with no
check-in created. The original processing-fee snapshot was preserved. The
buyer's ticket pages passed KK/RU/EN checks at 390 pixels, displayed refunded
status and blocked admission, and exposed no admission QR. No browser errors
occurred; the English page was visually inspected. A temporary scan grant was
restored to its previous state through the authorized staff API.

## Signed provider delivery

The webhook-only proxy exposes only POST `/api/webhooks/polar`, limits bodies to
256 KiB and requires signature headers. Public GET returned 404; unsigned POST
returned 400. Cloudflared connected over HTTP/2 and forwarded to the local
Worker. Its QUIC precheck still failed; the working HTTP/2 connection was tested
through the public URL.

The scoped sandbox organization token created endpoint
`93bb7dc1-ab64-4984-b08a-2f1fa5c61707`, pinned to API version `2026-04` and Standard
Webhooks signing. Creation must omit `organization_id` with an organization
token. Polar returned 422 when that redundant field was supplied; the corrected
request succeeded. The setup script now omits it and still verifies the returned
organization ID. The signing secret was saved without logging it, in ignored
`apps/api/.dev.vars` with mode 0600. The local Worker was restarted to load it.

| Actual event     | Unique events | Original delivery | Concurrent exact replays | Tampered body |
| ---------------- | ------------: | ----------------- | ------------------------ | ------------- |
| `refund.created` |             1 | 202               | 202, 202                 | 400           |
| `order.updated`  |             1 | 202               | 202, 202                 | 400           |
| `order.refunded` |             1 | 202               | 202, 202                 | 400           |
| `refund.updated` |             2 | 202 each          | 202, 202 each            | 400 each      |

Each verified event retained exactly one `provider_events` row and one
`provider.event` outbox entry after duplicate and tampered requests. The raw
captured body and original signature headers were reused without reserializing
for the exact-replay test. Adding a trailing space invalidated the signature and
left those records unchanged. Polar's redelivery API then delivered an existing
`refund.updated` event again. Its delivery list recorded six successful provider
deliveries for five event IDs, all HTTP 202, and the redelivered event still had
one canonical row and one outbox entry. Polar documents signature validation and
redelivery in its [delivery guide](https://polar.sh/docs/integrate/webhooks/delivery).

After acceptance, the temporary endpoint was disabled and read back as disabled.
The proxy and tunnel were stopped. The local Worker remains available; no build
output was deployed. The 21 private capture files for these five events were removed after the
checks. Sanitized results retain event IDs, payload hashes, statuses and
assertions.

## Evidence and limits

Private results are `.wrangler/polar-voluntary.json`,
`.wrangler/polar-webhook-results.json` and
`.wrangler/polar-refunded-ticket-results.json`. The acceptance helpers in
`.wrangler/` preserve operation identities and avoid logging secrets. Keep the
existing sandbox accounts and transaction records for subsequent acceptance.
The earlier `verifiedPaidOrderId` records historical payment success; that order
is now refunded, so do not expect it to remain completed or submit its checkout
again.

The previous abandoned-order compensation fixture was checked again after this
refund. It still has exactly one confirmed KZT 9,000 refund, zero tickets and no
sold or held inventory. See [compensation evidence](./polar-compensation.md).

This proves signed Polar delivery into the local Worker, provider redelivery,
application deduplication, and an actual fulfilled-order voluntary refund. It
does not establish deployed Queues/D1 behavior, the mixed-load target, physical
scanner behavior or a paid event-cancellation refund. Those acceptance gates
remain open.
