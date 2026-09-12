# Events and campaigns API evidence

Validated locally on 2026-09-13 against the generated D1 schema and all committed and working migrations. The implementation is in `apps/api/src/events`; its request and response schemas are in `packages/shared/src/events-api.ts`.

## Implemented routes

The module exports `eventsRoutes` for mounting at `/api`. Production requests obtain the account from Better Auth. The injectable identity function in `createEventsRoutes` exists for isolated integration tests and is never populated from request fields or arbitrary headers.

| Method | Path below `/api`                                | Behavior                                                                                                         |
| ------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| GET    | `/events`                                        | Public published discovery, text/category/time/phase filters, cursor pagination.                                 |
| GET    | `/organizer/events`                              | Events owned by the caller or covered by an active `event:manage` grant, including drafts and past events.       |
| POST   | `/events`                                        | Create a draft, including its calendar and reporting identifiers. Assigned events receive fresh hall inventory.  |
| GET    | `/events/:eventId`                               | Event details and visible ticket types, subject to public, unlisted, private-invitation, and staff access rules. |
| GET    | `/events/:eventId/preview`                       | Manager preview including hidden ticket types.                                                                   |
| PATCH  | `/events/:eventId`                               | Replace editable event details and advance the calendar sequence.                                                |
| POST   | `/events/:eventId/publish`                       | Publish an uncancelled, unsuspended event that has a ticket type and has not ended.                              |
| POST   | `/events/:eventId/unpublish`                     | Remove an event from public access and discovery.                                                                |
| POST   | `/events/:eventId/ticket-types`                  | Create a general-admission ticket type and exactly its configured number of inventory rows.                      |
| PATCH  | `/events/:eventId/ticket-types/:ticketTypeId`    | Change ticket details, price, sales window, visibility, or general-admission quantity.                           |
| GET    | `/events/:eventId/inventory`                     | Ticket counts and assigned-seat availability. `preview=true` requires event management permission.               |
| PATCH  | `/events/:eventId/inventory/:seatId`             | Enable or disable an unallocated assigned seat. Seat labels and identity are immutable through this API.         |
| POST   | `/events/:eventId/campaigns`                     | Create a disabled campaign with generated opaque code/link token and a separate reporting ID.                    |
| GET    | `/events/:eventId/campaigns`                     | Manager-only campaign list with cursor pagination.                                                               |
| GET    | `/events/:eventId/campaigns/:campaignId`         | Read one campaign as a manager.                                                                                  |
| POST   | `/events/:eventId/campaigns/:campaignId/enable`  | Explicitly enable a reviewed campaign.                                                                           |
| POST   | `/events/:eventId/campaigns/:campaignId/disable` | Disable a campaign.                                                                                              |

List limits default to 20 and cannot exceed 100. Public discovery defaults to upcoming and active events; an explicit phase filter can request completed or cancelled public events. Event cursors use start time and ID; campaign cursors use last update time and ID. Event PATCH accepts the complete editable definition. Every mutation accepts a caller-generated `requestId`; all mutations after creation also require the latest event `expectedRevision`. A successful mutation returns `{ eventId, resourceId, revision }`. Read the detail or preview route for the resulting representation.

## Transaction rules

Each mutation checks a verified, active account before planning and again inside one D1 batch. Existing-event writes also recheck the exact event-management relationship, cancellation state, and event revision inside that batch. The batch contains the domain changes, inventory postconditions, one audit entry, an `event.changed` outbox job, and the request receipt. A failed guard rolls back all of them. Identical retries return the saved response; reusing a request ID with different normalized input conflicts.

Total configured ticket quantities and inventory rows cannot exceed event capacity. Each ticket type must have exactly its configured number of inventory rows. Capacity guards run before inventory expansion as well as after the proposed changes. Quantity reductions delete only unallocated rows without historical tickets; an insufficient number of removable rows rejects the whole edit.

Assigned seating uses the predefined 80-seat hall, two 40-seat sections, rows A–E, seats 1–8, and four accessible places. Premium starts at KZT 5,000 and Standard at KZT 3,000. Inventory IDs belong to an event. Price edits preserve seat labels and historical order/ticket snapshots. Section quantities remain fixed; organizers disable individual unallocated places instead. Switching layout or seating mode requires an event with no ticket types, inventory, or orders.

Publishing does not activate paid sales. The separate activation service must satisfy the recorded checklist and fee requirements. Campaign defaults are 10% off, 100 completed-order redemptions, and the event registration window. Every new campaign is disabled. Applicable ticket types must belong to the event. Campaign codes also supply the opaque campaign-link token; its SHA-256 hash is stored for lookup. Responses expose the usable code/link to authorized managers, and never return the hash. Admission credentials remain a separate format.

## Verification

`vp test apps/api/src/events/events.integration.test.ts` passes 14 tests using Miniflare's actual D1 runtime and the application migrations. Coverage includes:

- Verified-account enforcement, draft privacy, owner preview, unlisted access, private invitations, and the separation of scanning and management grants.
- Public discovery filters, event and campaign cursor pagination, malformed input, and rejection of request-supplied ownership or activation state.
- A real Better Auth signup, private verification email, sign-in cookie, and event creation through the production route factory.
- Publishing and unpublishing, with paid-sales eligibility preserved as pending.
- Exact retry replay, changed-input rejection, stale revisions, calendar sequence changes, and matching audit/outbox counts.
- Competing ticket-type edits, overflow rollback, and absence of partial inventory, receipts, or audit jobs.
- Permission revocation after authorization but before the batch, using actual SQL to revoke the grant.
- General-admission quantity edits around live checkout holds.
- Fresh 80-seat inventory, accessibility markers, seed prices, and immutable seat identities.
- Held and sold seat protection through real checkout and zero-total issuance, followed by a price edit that leaves the issued ticket snapshot unchanged.
- Campaign defaults, explicit enable/disable, cross-event applicability rejection, opaque token hashing, and manager-only reads.

Scoped formatting and lint checks pass. `vp exec tsc -b --pretty false` passes for the current workspace.

## Remaining work outside this module

Event duplication, cancellation/refund orchestration, image upload, activation, moderation, invitation issuance, calendar file/link rendering, campaign QR rendering and public token resolution are separate work. This module supplies calendar metadata and campaign management records but does not claim those complete workflows. Ticket refund and check-in reporting also require their reporting endpoints. The outbox consumer must handle `event.changed` jobs idempotently. Local correctness tests do not establish deployment throughput, browser accessibility, or provider behavior.
