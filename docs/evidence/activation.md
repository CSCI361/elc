# Paid-sales activation

The activation API implements the per-event checklist and fee policy in
`docs/architecture-decisions.md`, following SRS sections 3.2, 4.5, 4.12 and UC2.
An organizer can complete the checklist while the event is a draft. Publication
and paid-sales activation remain separate.

## API contracts

The Hono module is `activationRoutes` in `apps/api/src/activation/index.ts`.
The root API mounts it at `/api`. Request and response schemas are exported from
`packages/shared/src/activation-api.ts`.

| Method and path                                  | Access and input                                                                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/events/:eventId/activation`            | Event owner; returns `ActivationResponse`, including blockers, check timestamps, current fee, latest payment and retained successful fee. |
| `PATCH /api/events/:eventId/activation`          | Verified, active event owner; `updateActivationSchema`.                                                                                   |
| `POST /api/events/:eventId/activation/payment`   | Verified, active event owner; `{requestId, expectedRevision}`; returns the shared `PaymentResponse`.                                      |
| `GET /api/platform/activation-settings`          | `platform:configure`; returns the fee, KZT currency and settings revision.                                                                |
| `PATCH /api/platform/activation-settings`        | `platform:configure`; `{requestId, expectedRevision, feeMinor}`.                                                                          |
| `GET /api/platform/events/:eventId/activation`   | `platform:moderate`; inspect the event checklist.                                                                                         |
| `PATCH /api/platform/events/:eventId/activation` | `platform:moderate`; `{requestId, expectedRevision, suspended, reason}`.                                                                  |

The owner PATCH contains the complete demo profile (`displayName`, `legalName`,
`contact`, `dummyPayoutReference`), controlled `identityCheck` and `payoutCheck`
values (`passed` or `failed`), and `acceptedTermsVersion`. The payout reference
must match the dummy `DEMO-…` format. Terms must be the exported
`DEMO_PAID_TERMS_VERSION` or null to withdraw acceptance. The versioned text states
that payments and checks are demonstrations and explains activation refundability.
There is no identity-document upload or bank-credential field.

`expectedRevision` is the activation checklist revision, not the event revision.
The response returns both. Event-management staff cannot manage the owner's
activation, and owners cannot assign themselves platform permissions. Read access
lets an owner inspect a suspended or unverified checklist; mutations and payment
preparation recheck account eligibility in their transaction.

## Persisted state and transitions

`event_activations` stores the current profile, separate simulated check results
and timestamps, terms acceptance, suspension and revision. Each owner update
appends an `activation_checklist_history` record. The immutable history preserves
failed checks and earlier terms acceptance after a later update.

`activation_settings` starts at `500000` KZT minor units, or KZT 5,000. An
authorized settings change is audited with its amount and revision. The API
accepts positive sandbox fees between KZT 300 and KZT 1,000,000. The lower bound
matches the adapter's supported positive KZT minimum; this is an implementation
constraint, not a new percentage fee.

`prepareActivationPayment` checks the owner, paid ticket type, complete checklist,
current terms, event state and current settings inside the D1 batch. It writes a
`payment_attempts` row with purpose `event_activation`, a frozen
`PaymentCheckoutRequest`, an `activation_attempts` snapshot, request receipt,
audit entry and payment reconciliation job. The snapshot includes the checklist
revision, configured fee and settings revision. Later fee changes affect only
new attempts. Client amounts are not accepted.

`activationEligibilitySql` rechecks that snapshot and current eligibility before
dispatch and completion. Changing the checklist or moderating the event while a
fee payment is unfinished invalidates its snapshot. A confirmed payment that
cannot complete activation enters the shared compensation workflow.

`completeActivation` requires a recorded successful provider payment, linked
checkout and order IDs, current ownership and complete checks. The same D1 batch
retains the successful payment ID and activation timestamp, enables paid sales,
and records the audit and outbox entries. It does not change the financial fact.
Concurrent completion and compensation can have only one winner: a pending
refund prevents activation, and a successful activation prevents refund creation.

The retained successful payment is independent of current eligibility. Completion
replays return it after suspension or cancellation. Fixing failed simulated checks
or an administrator resuming paid sales can restore eligibility without another
fee. Owner edits cannot remove a moderator's suspension.

`paidSalesEligibilitySql` supplies the current checklist, owner and successful-fee
predicate for checkout and ticket finalization, including paid ticket types
discounted to zero. Owner email revocation or account suspension also demotes
active event sales in the database. Passing checks alone does not establish
activation, and one event's payment does not activate another event.

## Retry and retention rules

A repeated request returns its recorded payment. A new request also reuses an
unresolved attempt. A pending or failed compensation blocks another fee. A new
attempt is permitted after a conclusive failure/cancellation with no provider
checkout, or after a confirmed full compensation. An ambiguous provider response
requires the shared reconciliation flow; it does not release the dispatch claim.

Migrations `0008_demonic_brood.sql` and `0009_activation_guards.sql` add checklist
history, seed the default fee, and enforce immutable attempt/history updates,
retained activation success, revision increments and activation/refund exclusion.
No activation API exposes deletion. The migrations permit a future retention
process to purge records in foreign-key order after the required retention period.

## Validation

`vp test apps/api/src/activation/activation.integration.test.ts` passed all 34
tests using Miniflare's D1 binding and every repository migration. The tests cover
owner and administrator permissions, runtime contracts, check history, versioned
terms, duplicate requests, concurrent preparation/completion, fee snapshots,
permission changes before commit, checklist/cancellation/suspension races,
compensation exclusion, retained fees and the shared payment dispatcher. Scoped
lint and the API/shared TypeScript project build pass.

The tests inject a payment adapter with recorded responses; they make no provider
requests. This evidence does not claim a real sandbox activation checkout, remote
webhook delivery, email delivery, or deployed acceptance. Those results belong in
the provider and deployment evidence. Activation notification jobs are committed
to the outbox; this module does not itself send email.
