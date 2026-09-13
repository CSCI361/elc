# Attendee campaign resolution

`POST /api/events/:eventId/campaigns/resolve` accepts a JSON object containing one trimmed campaign `code` of 1–64 characters. A 4 KiB body limit rejects oversized requests before identity or database lookup. The response contains the event ID, campaign ID and name, the server-owned percentage or fixed-KZT discount, its validity window, applicable ticket type IDs, and server time. It carries `Cache-Control: private, no-store` and varies by cookie.

The resolver hashes the supplied opaque code with the existing campaign token hash function and scopes the lookup to the requested event. It does not return the code, token hash, reporting ID, redemption counts, admission credentials, or a response URL. Unknown, disabled and out-of-window campaigns return the same `PROMO_INVALID` response. Invalid request data returns `INVALID_INPUT`; oversized bodies use status 413.

Published public and unlisted events allow anonymous resolution. Private events require current event access through ownership, staff permission, moderation permission, or an accepted invitation that still matches the account's email. Draft, unpublished, suspended and cancelled events cannot resolve offers, including for their owner. After asynchronous hashing, a final D1 transaction rechecks the event, account, grant or invitation, campaign state and validity window. Production also checks the database clock to cover time spent waiting for D1.

Resolution describes the offer; it does not reserve inventory or a redemption. The existing checkout transaction still calculates the discount and enforces ticket applicability, event eligibility, sales windows, inventory and redemption limits. A fully redeemed campaign can therefore still resolve its terms while a new checkout is rejected. This follows the campaign and atomic checkout requirements in `docs/architecture-decisions.md`.

## Local verification

The integration tests use real migrations and the existing Miniflare D1/R2 payment fixture. They cover both discount kinds, enabled and disabled states, exact validity boundaries, wrong-event and unknown codes, strict input parsing, hash/code separation, public and unlisted access, private invitations and staff access, and account, permission, invitation, event and campaign changes during a read. Route tests check POST-only access, malformed and oversized bodies, private caching and credential-free responses.

One continuous test creates a disabled 25% campaign, enables and resolves it, reserves a discounted seat, completes payment with the synthetic provider, and reads the resulting canonical campaign attribution. It verifies the completed order, issued ticket, committed redemption, discount and net revenue. A second checkout cannot exceed the redemption cap and leaves no partial order or allocation. The same campaign URL is rejected by the mobile admission parser and the backend admission contract, with no check-in created.

All 29 integration cases passed in 77.17 seconds. The scoped check passed formatting for all four files and reported no warnings, lint errors or type errors in the three TypeScript files.

Run `vp check apps/api/src/campaigns docs/evidence/campaigns-api.md` and `vp test apps/api/src/campaigns/campaigns.integration.test.ts --maxWorkers=1`. Browser acceptance and external provider acceptance are separate checks; these tests use no live payment service.
