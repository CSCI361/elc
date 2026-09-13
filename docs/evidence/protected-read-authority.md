# Protected read authority

Ticket, checkout, account-order, payment and activation readers now select their returned data with current database authority after any preliminary asynchronous work. A single statement or D1 batch supplies the final authorized snapshot. No asynchronous credential recovery, relationship lookup or provider work follows that snapshot.

## Existing access boundaries

Ticket metadata, order ticket lists and admission credentials remain available to the purchaser, current event owner, or staff with a current `event:manage` grant. Each path requires a verified account without a suspension. Scanner, history and platform permissions do not implicitly grant this access. Credential recovery happens before the final query, which checks the current account and relationship, ticket identity, order/event linkage and encrypted credential value before returning the recovered credential.

Ticket lists select their rows and order authority in one batch. This also checks access when the requested page is empty. Lists no longer perform one separate ticket read per row. Both ticket readers return current ticket and explicit order admission-block state.

Checkout details and payment status remain purchaser-only. Their final queries join the current verified, non-suspended purchaser. The checkout batch selects the order, reservation and item snapshots together. Payment state and refund state share one query, so a completed or failed payment cannot retain a pending checkout URL in the returned response. Account-order pagination also reads current account authority and its rows in one batch, including empty lists.

The checkout lifecycle uses the authorized snapshot directly when no expiry work is needed. After expiry work it reloads the order. Payment start/reconciliation handlers already call the payment reader after provider work, so the new final guard covers those returned payment responses too.

## Activation diagnostics

An event owner retains the existing diagnostic access to their activation checklist when their account is unverified or suspended. The final batch verifies that the owner account exists and still owns the event. It reads current event state, checklist, fee settings, owner blockers, paid ticket availability, latest payment/refund and successful payment together. A blocked owner can inspect the checklist and blockers, but receives no pending checkout URL.

Platform diagnostics still require a current verified, non-suspended account and `platform:moderate`. Event management does not grant owner diagnostics, and platform moderation does not grant owner operations. A moderator never receives the checkout URL. Removed or suspended authority during the read fails before checklist details are returned. Initial not-found behavior for missing events remains unchanged.

Final authority failures on ticket, checkout and payment resource reads use `NOT_FOUND` (404). Account lists and activation diagnostics use `FORBIDDEN` (403). Existing preliminary authentication and permission errors remain unchanged. These checks establish authority at the final database snapshot; they cannot recall data already returned before a later revocation.

## Verification

`apps/api/src/auth/read-authority.integration.test.ts` uses all real D1 migrations and the canonical paid-order, issued-ticket and activation fixtures. Synthetic provider responses create pending checkout URLs and reconcile payment transitions. Hooks inject revocation, suspension, verification removal, ownership changes or account deletion between preliminary authorization and the final read, without timing sleeps. The credential test also performs a real canonical scan after decryption and checks the returned current ticket state.

The focused cases cover existing role boundaries, credential and metadata disclosure, empty-list authority, current admission-block state, purchaser-only order/payment access, payment state changes, owner diagnostic preservation and platform separation. No production database, provider organization, access token or external message is involved.

All 110 tests across the five scoped files passed in 202.57 seconds, including all 28 new read-authority cases. The final scoped check passed with no formatting, lint or type errors.

Validation commands:

```sh
vp check apps/api/src/auth/read-authority.integration.test.ts apps/api/src/tickets/read.ts apps/api/src/orders/read.ts apps/api/src/orders/account.ts apps/api/src/payments/store.ts apps/api/src/activation/store.ts docs/evidence/protected-read-authority.md
vp test apps/api/src/auth/read-authority.integration.test.ts apps/api/src/activation/activation.integration.test.ts apps/api/src/tickets/flow.integration.test.ts apps/api/src/orders/checkout.integration.test.ts apps/api/src/payments/orchestration.integration.test.ts --maxWorkers=1
```

The integrated refunded-ticket browser flow also passes through the local Worker:
all three original sandbox-order credentials return `refunded` without a
check-in, and the KK/RU/EN ticket pages fit 390 pixels with no admission QR or
browser errors. The temporary scanner grant is restored after the check. No
provider operation was performed by this browser rerun. Full checks pass across
443 files, all builds pass, and the combined full regression passes 1,358 tests
across 81 files in 590.24 seconds.
