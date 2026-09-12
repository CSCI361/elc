# Checkout transaction evidence

Recorded on 2026-09-13 against local Cloudflare D1 through Miniflare. The tests execute the application services and all repository migrations. They do not substitute an in-memory collection or mocked database adapter.

## Implemented boundary

`POST /api/checkouts` creates a pending order, immutable monetary and refund-policy snapshots, attendee names, and a reservation expiring ten minutes after creation. `PUT /api/orders/:orderId/checkout` replaces the full basket only when the purchaser supplies its current revision. Replacement preserves the reservation ID and original deadline. Any existing ticket-order payment attempt freezes basket edits, including failed attempts.

`GET /api/orders/:orderId` returns the purchaser's order and performs lazy expiry when needed. `POST /api/orders/:orderId/abandon` releases unsold inventory and uncommitted promo allocation while preserving payment records for later compensation. A background caller can use `expireReservations` for the same expiration transition. Event-wide cleanup uses a set-based batch, so an older page of expired reservations cannot hide another stale hold.

Routes obtain the actor from a verified session. The committing batch rechecks verification, suspension, event publication/cancellation/suspension, event and ticket sales windows, paid-sales activation, ticket visibility, quantities, capacity and private invitation access. Private invitation acceptance must have occurred before its token deadline and event end. Accepted access survives token expiry; revocation or a changed purchaser email removes purchase access. Management preview permission does not grant private purchase eligibility.

## Atomic ordering

1. Insert the actor/request receipt. Reusing its identifier with different normalized input fails. An identical retry returns the recorded response.
2. Assert current eligibility and the server-resolved ticket prices, names, campaign terms and applicability used in the proposed snapshot.
3. Create the order and reservation, or compare the existing revision and active deadline before releasing its old uncommitted allocations and replacing its item snapshots.
4. Claim general-admission places inside the transaction, or claim all requested assigned seats. Assert exact basket quantities and current event/type capacity. A failed assertion rolls back every claim and preserves the previous basket on replacement.
5. Allocate a promo only when committed redemptions plus active, unexpired allocations remain below its limit. Assert that this order obtained its allocation.
6. Record the audit entry. Production also checks the D1 clock before the batch commits, including the reservation deadline and event/type/campaign sales windows.

Conditional SQL updates that affect no rows are not treated as success. Explicit CHECK-backed transition guards fail the whole D1 batch. General-admission selection uses a partitioned row number over currently available inventory, so concurrent requests can select different remaining places without relying on an earlier availability read. JSON plans keep statement bindings below D1's per-statement parameter limit for multi-item baskets.

Expiration and abandonment clear only unsold inventory, release only uncommitted promo allocations, and retain provider attempts. Their audit/receipt and state changes commit in the same batch. These transitions need no external side effect; ticket completion owns its delivery outbox entries.

## Verification

`vp test apps/api/src/orders/checkout.integration.test.ts` covers:

- Server prices, fees, policy instructions, attendee snapshots and the exact deadline; identical retries, identifier mismatch, and purchaser-only reads.
- Last-place, overlapping assigned-seat, and last-promo races with one winner and no partial loser records.
- Basket replacement, simultaneous revision conflicts, rollback to the original basket on shortage, and no deadline extension.
- Payment-attempt edit freeze, idempotent abandonment, lazy expiry, inventory reuse and released promo capacity.
- Event, account, ticket-price, campaign-term and invitation-revocation changes between initial reads and commit.
- Current capacity, delayed checkout requests, production D1-clock predicates, mixed ticket types with selective discounts, paid-sales activation for fully discounted paid tickets, and a selected seat losing its physical label before commit.

`vp check apps/api/src/orders packages/shared/src/checkout-api.ts` checks the service, routes, contracts and integration tests.

## Issuance and admission review

The review added completion guards for the current per-order limit and occupied event/type capacity. These are checked after credential preparation in the same batch that consumes the hold and creates tickets. The production path also checks the D1 clock, so an application clock behind the database cannot issue after the reservation deadline. Admission evaluates the final scan outcome with the D1 clock in production and records separate captured and committed timestamps.

Authorized reversals are attendance corrections and remain available after event end when the order, event and ticket otherwise permit reversal. The correction retains the original check-in and audit history. A new scan of that ticket still fails because the event has ended. Refund, cancellation, suspension and admission-block guards continue to apply to corrections.

The ticket-flow suite passed all 12 D1 integration tests, including independently lowered order/event/type limits, production clock predicates, rejection under a stale application clock, a scan crossing event end, and post-event correction. The complete checkout run passed 16 tests. Its subsequently added physical-label race passed a targeted run with the other 16 skipped. All 10 changed TypeScript files passed formatting, lint and type checks without warnings. These runs supplement the existing credential and schema tests.

## Running Worker HTTP acceptance

`vp run verify:local-ticketing` passed on 2026-09-13 against the running Cloudflare Worker at `http://localhost:5173`. The script creates separate synthetic organizer, purchaser and scanner accounts through Better Auth HTTP endpoints, rejects unverified sign-in, reads each verification link from the private local development mailbox, verifies the email and obtains an actual session cookie through sign-in. It does not insert authenticated sessions or bypass account verification.

The HTTP flow creates an unlisted event, adds a free ticket type, publishes the event, reserves a ticket, completes the zero-total order, and retrieves its canonical admission credential. Replaying reservation and completion requests returns the original results. The test rejects an unassigned scanner, rejects implicit organizer scan authority, and denies credential access to scanner staff. Until the staff-assignment endpoint exists, a private local Wrangler command grants the fixture scanner explicit `ticket:scan` and `checkin:reverse` permissions.

With those grants, the first HTTP scan succeeds, an identical retry returns its recorded response, and an independent duplicate reports `already_used`. An authorized reversal is idempotent, and a new scan succeeds afterward. Sign-out revokes the scanner's session, and a later scan request returns 401.

Private D1 assertions confirmed one canonical ticket, two retained check-in records, exactly one active admission, one completion outbox job, no payment attempt, a completed order and a consumed reservation. The script then deleted only its generated accounts and their event records, including audit/outbox entries and private development mail, and verified cleanup. It never prints passwords, verification links, cookies or admission credentials. Formatting, lint and type checks passed for the verification script.

Provider payment confirmation, compensation and refunds are separate transitions. No Polar transaction, external email delivery, remote deployment or mobile acceptance is established by these checkout tests. The provider access gap remains recorded in [provider-readiness.md](provider-readiness.md).
