# Durable notification fanout

`apps/api/src/delivery/fanout.ts` converts committed notification sources into recipient delivery records. It does not send email, render PDFs, or change orders, tickets, payments, refunds, activation facts, or payouts.

The Worker uses two exported functions:

- `dispatchNotificationOutbox({ DB, DELIVERY }, now?)` queues at most 20 due source IDs. A queue failure leaves its committed source available to a later dispatch.
- `consumeNotificationOutbox({ DB }, sourceId, { now?, beforeCommit? }?)` processes one bounded page. It returns `false` for sources owned by another consumer. `beforeCommit` is a test hook for authorization and state races.

Each transaction compares the persisted source envelope and fanout cursor, inserts eligible recipient records, creates their `email.send` outbox jobs, and advances or completes the source. An insertion or guard failure rolls the entire page back. The source remains pending with a retry time. Concurrent consumers cannot advance the same cursor twice.

Delivery IDs are SHA-256 digests of the source ID, recipient account ID, and part key, prefixed with `delivery_`. The database independently enforces uniqueness on source, recipient, and part. Email job IDs are `email:` followed by the delivery ID. Queue payloads contain only IDs. Delivery metadata contains the canonical ticket IDs and part counts, a support change ID, or a payout adjustment ID where needed. It contains no email addresses, admission credentials, private case messages, or arbitrary URLs.

Source handling matches the canonical loader in `delivery/sources.ts`:

| Source                   | Delivery and entity                                                    |
| ------------------------ | ---------------------------------------------------------------------- |
| `order.completed`        | `order.tickets`, order ID, sorted canonical ticket slices of up to six |
| `payment.failed`         | `payment.failed`, payment attempt ID                                   |
| `activation.completed`   | `activation.completed`, the recorded activation payment attempt ID     |
| `event.changed`          | Only `event.updated` and `event.cancelled`, event ID                   |
| `refund.changed`         | Only a succeeded source and confirmed canonical refund, refund ID      |
| `payout.simulated`       | `payout.status`, payout ID                                             |
| `payout.adjusted`        | `payout.status`, payout ID with canonical adjustment ID metadata       |
| `support.notify`         | `support.changed`, case ID with its exact change ID                    |
| `registration.cancelled` | `order.cancelled`, completed free order ID                             |

Source JSON is bounded and strictly validated. Entity IDs must agree with the payload and canonical records. Irrelevant actions, stale event updates, invalid identities, and sources with no currently eligible recipients finish without an email job. The database already rejects malformed JSON. Recipient account verification, suspension, current ownership, and applicable support permissions are checked again in the insertion transaction. The delivery loader repeats authorization before message preparation and sending.

Event fanout scans 20 raw completed-order keys at a time using `(completed_at, id)` within the event. Filtering occurs when inserting recipient jobs, so a page of unverified or suspended buyers cannot hide later eligible buyers. Repeated orders for one account create one notification. Purchases completed after the source timestamp are excluded. Event updates require a current completed, unblocked order; cancellation notices include prior completions even if refund or cancellation processing has already changed the order state. A newer update or cancellation suppresses an older event notice.

Ticket fanout reads a count and at most 120 sorted ticket IDs per page, producing at most 20 email parts. It persists the last ticket ID and completed part count. The commit guard verifies the count, states, prefix, and exact selected IDs. A changed ticket cannot cause a committed part to be repacked. The renderer's canonical loader later checks those same part identities before generating attachments.

Support recipients are the requester and current authorized assignee, or responsible staff if the assignee is absent, suspended, unverified, or no longer authorized. The change actor receives no notification. Assignment alone grants no case access. Event owners and `support:manage` staff can receive attendee-case notices; organizer-platform conversations require platform support or moderation authority. Overlapping roles are deduplicated.

Support lookup reads at most 20 keys from each indexed grant branch, plus the requester, assignee, and event owner, then selects 20 candidate keys. It retains revoked keys in raw pagination and applies current authorization at insertion. The bounded union has five compound SELECT terms, which passes the actual D1 limit. An assignment, assignment-validity, or case-revision change restarts candidate paging with the existing delivery uniqueness constraint, so fallback recipients before the old cursor are considered without duplicating earlier jobs.

Migrations `0021_delivery-fanout-indexes.sql` and `0022_delivery-payload-cleanup.sql`, owned by the delivery integration, add the matching order, ticket, grant, and source indexes. Query-plan assertions verify their use. Source progress and delivery state are separate from business state, as required by the notification policy in `docs/architecture-decisions.md`.

Validation completed on 2026-09-13:

- `vp test run apps/api/src/delivery/fanout.integration.test.ts`: 23 tests passed against Miniflare D1 and the complete migration chain.
- `vp check apps/api/src/delivery/fanout.ts apps/api/src/delivery/fanout.integration.test.ts`: formatting, lint, and scoped type checks passed.
- `vp exec tsc -p apps/api/tsconfig.json --noEmit`: passed.

The suite covers atomic failure and replay, concurrent consumers, 121 tickets across 21 parts, ticket invalidation, event pages containing no eligible accounts, repeated purchasers and equal timestamps, post-refund cancellation notices, support pagination and assignment races, private platform cases, canonical financial identities, empty sources, bounded queue dispatch, and indexed lookups. Fixtures are isolated synthetic records; activation uses real application transitions with a synthetic provider confirmation. The tests make no external sends or provider requests. Resend acceptance, actual mailbox display, and delivery retention are covered by their separate adapter, coordinator, and acceptance work.
