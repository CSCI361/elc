# Payment reconciliation evidence

Recorded on 2026-09-13. `vp test apps/api/src/payments/orchestration.integration.test.ts` passed all 17 tests against local Cloudflare D1 through Miniflare and all repository migrations. `vp check apps/api/src/payments/orchestration.integration.test.ts` passed formatting, lint and type checks without warnings.

The tests call the application checkout, payment reconciliation, refund and ticket issuance services. A recorded `PaymentAdapter` supplies synthetic normalized provider results and counts each external operation. No provider account, credential or financial API is used. The D1 database, transaction guards, request receipts, audit entries, outbox rows and canonical ticket issuance are real application code.

## Verified behavior

Three simultaneous identical payment requests produce one payment attempt, one provider checkout POST, one preparation audit entry and one reconciliation outbox job. The request freezes the order basket. A different payment request for the same order conflicts. Concurrent success reconciliation creates one canonical ticket and one completion outbox job, with the order's snapshotted processing fee preserved.

A publication change before payment preparation commits rejects the transition. The entire batch rolls back its payment attempt, reservation payment link, request receipt, audit entry and outbox row. No provider POST occurs.

A checkout POST whose response is lost retains its dispatch claim. Later calls use provider lookup to recover the checkout, even when it is initially absent from lookup results. They never repeat the checkout POST. A definite provider rejection records a failed attempt and also prevents another POST.

Success received after reservation expiry, purchaser abandonment or event cancellation remains a succeeded payment fact. Each case creates one full-amount compensation refund, releases unsold allocations and creates no ticket. Reconciliation retries do not repeat the refund POST. The purchaser can still read the unfulfilled order with its original lifecycle state and a null completion timestamp.

An uncertain refund follows the same durable dispatch rule. Recovery uses lookup until the refund becomes visible, without issuing another refund POST. Refund confirmation uses the supplied reconciliation clock.

Mismatched amount, order, account, request hash or provider checkout identity fails before recording success or issuing a ticket. Duplicate success reports share one fact receipt and one success audit entry. A later failed report cannot downgrade a succeeded payment or change its success timestamp. A later pending refund report and an old payment success cannot reopen a refunded order or recreate its tickets.

Provider-reported refunded funds block admission even when the application does not yet know the corresponding refund identity. This case remains unresolved for later reconciliation; the service does not issue tickets or send a blind replacement refund. A compensation request also fails if a competing finalizer has already completed the order, leaving that order's valid ticket intact.

## Review corrections

The service review added a commit-time guard against compensating an already completed order. It also preserved the lifecycle state of orders refunded before fulfillment and propagated the injected reconciliation clock into refund confirmation. The regression tests exercise each correction.

The preparation rollback test proves the payment attempt, receipt, audit entry and outbox job commit together. The successful concurrency test proves one completion job accompanies canonical paid issuance. The suite does not independently force a database failure at every refund or outbox transition.

## Remaining acceptance

These service tests do not establish Polar checkout or refund behavior. Provider transport and signed webhook verification need their separate adapter tests and sandbox acceptance. No live sandbox transaction, actual refund, external webhook delivery, deployed queue processing or remote D1 deployment is proved here.

The running Worker HTTP acceptance currently proves the authenticated free-ticket flow described in [checkout.md](checkout.md). Paid HTTP checkout, return-page reconciliation, duplicate webhook delivery and queue retries still require acceptance through the integrated Worker. Provider configuration and transaction evidence remain in [provider-readiness.md](provider-readiness.md).
