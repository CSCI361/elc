# Refund recovery controls

The existing order refund panel now exposes recovery to users whose order response has `canApprove: true`. The recovery panel independently reads `GET /api/refunds/:refundId/recovery` before offering an action. Conversation access and event management do not substitute for refund permission.

The panel reads current state, `updatedAt`, `canReconcile`, `canRetryRejected` and `recoveryPending` from the shared contract. Failed status alone never enables retry. A queued recovery or confirmed refund has no submit action. Reconciliation is described as a provider lookup that creates no refund. Retry is described as available only after a definite rejection that created no provider refund, with a fresh provider check before another attempt. Existing admission and organizer payout blocks remain in place.

Each request sends the fetched timestamp, an allowed action and a trimmed reason of 3–500 characters. The command helper supplies its operation ID and prevents concurrent submissions. A conflict or unconfirmed response removes submit controls until an explicit refresh. Refresh preserves the reason and loads current action flags. A queued response is described as queued, never as a confirmed refund. Recovery status polls every ten seconds through the existing abortable, same-origin, no-store resource helper.

Read errors replace the recovery controls, including previously loaded controls. Permission errors receive a focused denial notice. The component is keyed by account and refund. Kazakh, Russian and English labels cover status, permissions, action explanations, request uncertainty and conflict recovery.

## Validation

- `vp check apps/web/src/support` passed.
- `vp test apps/web/src/support/policies.test.ts apps/web/src/support/refund-recovery-policies.test.ts` passed ten tests, including three new recovery boundary tests.
- `vp exec tsc -p apps/web/tsconfig.json --noEmit` passed.
- `vp run --filter @elc/web build` passed. The existing entry chunk still exceeds the 500 kB warning threshold.
- React review checked conditional authorization reads, account/refund reset, controlled reason input, submitter action validation, duplicate suppression, status announcements and focused errors.

## Browser contract checks

The independent `elc-refund-recovery` agent-browser session used the local app at `http://localhost:5173`. One disposable account was registered and verified through the real authentication endpoints and private development mailbox. Account preferences also used the real endpoint.

An init script intercepted fetches for the synthetic order `ui-recovery-order` and refund `ui-recovery-refund`. It supplied schema-shaped order and recovery responses and recorded mutation payloads. These IDs had no database records. All four recovery POSTs were intercepted; the browser recorded zero actual network requests to the recovery endpoint. These checks verify browser behavior against the API contract, not provider calls, durable claims, authorization transactions or refund processing. The separate API recovery tests cover those backend behaviors with a recorded adapter.

The following checks passed:

- A whitespace-only reason sent no request. A valid rejected retry sent its trimmed reason, the timestamp returned by GET, the `retry_rejected` action and a generated request ID.
- A simulated 409 removed both actions and focused the conflict notice. Refresh preserved the reason, loaded the new timestamp and exposed only reconciliation for an uncertain refund.
- A simulated lost response left no submit action. The notice said the request could not be confirmed. Refresh then displayed the queued recovery without retry controls.
- A deferred response disabled both actions and refresh. A second click did not add another request. Resolving that response displayed the queued receipt and current queued state.
- A confirmed refund had no recovery action. Removing `canApprove` removed the entire recovery panel and financial fee rows. Independently returning 404 from the recovery read removed its controls and focused the permission notice.
- At 390 × 844, all three languages had no page overflow. Action labels wrapped inside their buttons. A mobile screenshot was inspected. Axe 4.10.3 reported zero violations in the page's main content for each language, and the browser page-error list was empty.

The browser session was closed. The exact disposable account, profile, development mail and any associated receipts/audit rows were removed; cleanup verified the account was absent and deleted the private fixture file. No actual recovery or provider operation was requested, and no financial database fixture was created.
