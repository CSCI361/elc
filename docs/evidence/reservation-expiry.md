# Scheduled reservation expiry

The Worker now schedules one batch of at most 50 expired reservations on each
Cron invocation. The batch selects active reservations whose order is pending
and whose ten-minute deadline has passed. Its atomic statements recheck those
conditions for the selected IDs before recording expiry, releasing unsold
inventory and uncommitted promo allocations, and updating order and reservation
states. Pending payment attempts remain available for reconciliation. A later
successful payment follows the existing compensation path.

Each expired reservation retains one `checkout.expired` audit entry and one
`system:expiry` receipt. Repeated or concurrent sweeps do not increment the
order revision again or duplicate those records. A failed statement rolls back
its entire batch. If acknowledgement is lost after commit, the next invocation
finds the remaining active rows and leaves the completed batch intact.

Checkout retains lazy cleanup. It drains the requested event at a fixed server
cutoff through transactions of at most 50 reservations, without waiting for a
scheduled invocation. Other events remain outside that cleanup. Subsequent
checkout transitions still verify the reservation deadline and current inventory
inside their own committing transaction. A checkout that needs several cleanup
batches can retain completed cleanup work if its request is interrupted; a retry
continues from the remaining active reservations.

The scheduled wrapper checks the recovery gate before reading D1 and again
before committing its selected batch. The Worker also retains its existing
scheduled-handler recovery gate. The global selection uses `reservation_expiry`;
migration 0031 adds `reservation_event_expiry` for event-scoped selection and
`inventory_reservation` for release. Promo release selects by the allocation's
primary order key. Query-plan assertions inspect the executed selection and
inventory-release statements, including their bound values.

## D1 verification

All 14 new integration cases pass in 30.77 seconds on the full migrated schema.
They cover the exact deadline, batch limits and continuation, concurrent
selection, lazy event isolation, audit/receipt rollback, lost acknowledgement,
recovery pause before reads and after selection, promo capacity reuse, and index
selection.

The payment race cases use the canonical paid-order flow with a recorded
provider. If completion commits after selection and before expiry, the completed
order, consumed reservation, sold slot and ticket survive. If expiry commits
before issuance, issuance fails, no ticket is created, and repeated payment
reconciliation records exactly one successful compensation refund. Another case
preserves an abandonment that commits after expiry selection.

```sh
vp test apps/api/src/orders/expiry.integration.test.ts --maxWorkers=1
```

## Actual Worker scheduled handler

A disposable Wrangler Worker ran the application entry point with local D1,
R2, Queue and Durable Object bindings. It had no Polar, Resend, Google or GA4
credentials and used separate persistence from the preserved application state.
All migrations through 0031 were applied before seeding 52 expired reservations
and one live reservation, each with inventory and an uncommitted promo allocation.

Requests to `/cdn-cgi/local/scheduled?format=json&cron=*+*+*+*+*` invoked the actual
Worker handler and returned `{"outcome":"ok","noRetry":false}`. This is the
local scheduled-event route documented by
[Cloudflare](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/).

| Invocation             | Expired reservations/orders | Remaining active holds | Released promos | Expiry audits/receipts |
| ---------------------- | --------------------------: | ---------------------: | --------------: | ---------------------: |
| Recovery paused        |                           0 |                     53 |               0 |                      0 |
| Running, first tick    |                          50 |                      3 |              50 |                     50 |
| Running, second tick   |                          52 |                      1 |              52 |                     52 |
| Running, repeated tick |                          52 |                      1 |              52 |                     52 |

Held inventory matched the remaining active count at each step. The live
reservation remained active throughout. No payment attempt or ticket was created.
The browser displayed the recovery response while paused and the healthy local
API response after resuming, without browser errors. The disposable Worker and
browser were stopped, and their D1/R2 state was removed. Private results are in
`.wrangler/expiry-runtime/results.json`.

## Integration

Migration 0031 is applied to the preserved local application database. A protected
pre-migration SQL export and checksum/expiry manifest are saved as
`.wrangler/pre-migration-0031.sql` and `.wrangler/pre-migration-0031.json`, both
mode 0600. Their retention deadline is 30 days after capture. This local export
does not establish provider Time Travel or remote backup lifecycle behavior.

Full checks pass across 443 files; web/Worker/Astro builds pass with the existing
665.07 kB web-entry warning. All 34 backup safety cases and the disposable
full-schema restore pass. The combined full regression passes 1,358 tests across
81 files in 590.24 seconds. An independent code review found no actionable issue.
Deployed Cron cadence, workload performance and remote recovery acceptance remain
pending.
