# Platform campaign activity API evidence

Implemented on 2026-09-13. `GET /api/admin/campaigns` returns retained campaign metadata and usage to current, verified, unsuspended accounts with `platform:moderate`. Event ownership and `platform:recover` do not substitute for that grant.

The shared query accepts a literal name search or exact campaign ID in `q`, optional `eventId` and `organizerId`, `enabled=all|yes|no`, a cursor, and a page size of 20 by default or at most 50. The cursor binds the actor and normalized filters, including page size. It uses the campaign ID as a keyset anchor, so deleting the preceding row does not skip the next row.

The response contains the requested page, `nextCursor`, and `generatedAt`. Each row includes campaign/event/organizer IDs, event title, campaign name, enabled state, the existing percentage or fixed-KZT discount shape, window, redemption limit, current usage, update time and retention metadata. The strict response schema excludes campaign codes, hashes, URLs, contact details and provider payloads.

Current moderation authority and retention are read in the final D1 batch, including empty pages. Retention uses the existing shared event expiry and refund, payment, financial-case and reported-admission holds. A payment-hold test confirms that resolving the hold immediately before the final read hides an expired event's campaigns.

Usage counts follow canonical records:

- Active holds require an unreleased, uncommitted allocation and a matching pending order with an active reservation whose expiry is strictly after server time. Campaign, order and reservation event IDs must agree.
- Committed redemptions require a committed allocation and a matching attributed order with a completion timestamp and a completed, cancelled or refunded state. Cancellation and refund do not restore a consumed redemption.

The SQL materializes at most `limit + 1` retained campaigns before calculating usage. Executed `EXPLAIN QUERY PLAN` confirms `campaigns_event` for an event filter and `promo_usage` for both usage branches, followed by canonical order/reservation lookups. No migration was needed. The tests also confirm that existing schema guards reject cross-event reservation/allocation changes and release of committed redemptions.

`GET /api/admin/operations` and its audited CSV export now accept `campaignId` only for order queries. Other kinds reject the filter. Existing defaults, column sets and export auditing remain unchanged.

Focused verification uses disposable D1 databases created from all current migrations:

- `vp test apps/api/src/administration/campaigns.integration.test.ts`: 12 tests passed in 12.98 seconds. Coverage includes campaign projection, counters, literal search, combined filters, page boundaries, cursor scope, permission loss, retention, query plan and campaign-filtered export.
- The focused combined run also passed all 20 existing tests in `apps/api/src/administration/operations.integration.test.ts` and `apps/api/src/db/schema.integration.test.ts`.
- Scoped `vp check --fix` passed for all seven code files, covering the new shared contract, shared exports, operations query, campaign reader/tests and administration wiring.

No provider or preserved local database was accessed. Browser acceptance and full regression are recorded separately by the integration task.

## Integration regression (2026-09-14)

The full suite passes 1,445 tests across 86 files in 645.91 seconds, including
the 12 campaign API cases. `vp check` passes 571 formatted files and 465 lint and
type-checked files, and `vp run build` exits 0 for the web, Worker and Astro
builds. Browser acceptance is recorded in the
[web evidence](./platform-campaigns-web.md).
