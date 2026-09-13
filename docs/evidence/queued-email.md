# Durable PDF and email delivery

The delivery coordinator in `apps/api/src/delivery/jobs.ts` keeps PDF preparation
and email status in separate D1 fields. Each delivery has an immutable source,
recipient, entity and part identity. Its provider key derives from that delivery
ID. Canonical orders and tickets are never changed by the coordinator.

Before the first send, the source loader checks the current account and resource
permissions and computes a version of every field affecting the message or PDF.
The coordinator prepares canonical PDFs and saves the exact message envelope
under a private, content-addressed R2 key. It verifies the stored object's size,
hash and schema before reuse. The source loader runs again after preparation,
immediately before the send attempt is persisted. Access loss suppresses the
message. Changed content can be rebuilt before the first attempt; a changed
message after an uncertain attempt is suppressed without changing its key or
payload.

D1 leases control which worker can prepare or send each job.
Every write after asynchronous work checks the lease token. A late worker cannot
replace another worker's payload or provider receipt. The first attempt time and
frozen payload are persisted before calling the provider. Lost provider responses
and crashes before receipt storage therefore retry the same request. Automatic
sends stop after 23 hours, within Resend's 24-hour idempotency window. Clock
rollback and exhausted uncertain retries require review. Missing configuration
does not start that window. No external email has been sent during these checks.

Provider acceptance remains distinct from delivery. A known provider ID is
looked up instead of submitting another message. A failed status lookup preserves
the accepted receipt and requires review; it does not establish delivery failure.
Delivered/opened/clicked events
confirm delivery; bounced/complained and failed/cancelled/suppressed results have
separate terminal outcomes. A still-pending provider status after seven days
requires review. Provider response bodies and private email content are excluded
from diagnostic codes.

The local environment always writes the protected development mailbox and
completion state in one D1 transaction. It never calls the external adapter.
PDFs and the frozen attachment envelope remain in private R2. Queue publication
failure leaves the job eligible for Cron recovery. A successful publication
delays only the outbox dispatch clock, so the queued consumer can run immediately
without skipping the delivery's own retry deadline.

The first 18 D1/R2 integration tests passed on 2026-09-13. They exercise concurrent
consumers, exact replay after uncertainty, a synthetic failure after provider
acceptance, access/content changes during preparation, recipient changes after
uncertainty, the retry deadline and backward clock, missing configuration, local
mailbox rollback, corrupt R2 objects, stale leases, queue publication failures,
provider outcomes, immutable identities and receipts, and failed PDF preparation.
The adapter and localized template suites add 74 and 107 tests. Eight independent
review regressions passed after fixing delayed send-permit responses, preservation
of uncertain outcomes, orphan payload tracking and atomic PDF/email failure.

Each private payload has a durable staging record before R2 receives it. An expired
worker cannot attach a deleted or expired staging record. Unused payloads become
eligible for deletion after 23 hours; the cleanup pass handles at most 50 objects
and repeats tombstone deletions hourly to catch writes already in flight. The
current unresolved payload remains available for reconciliation. A completed
delivery's payload expires after 30 days. Cleanup does not modify its receipt.

The Worker now dispatches notification sources and email deliveries, resumes
incomplete fanout from its saved cursor, and runs payload cleanup. A local
dead-letter queue is configured for exhausted queue retries. Canonical-source
tests passed all 15 cases. Two integrated workflow tests passed through a real
completed order, recipient fanout, canonical PDF generation and the protected
local mailbox. They verify one email after duplicate queue deliveries, the saved
Russian preference, one unchanged canonical ticket, and account revocation before
sending. No external transport was called. The full web/Worker/Astro build passed.

Bounded fanout passed 23 D1 tests. Operator inspection and replay passed 14 D1
tests and the [web recovery checks](./web-delivery.md). Deployed
Queues/dead-letter acceptance and actual Resend/email-client
delivery remain required work. This document does not establish those external
acceptance checks.
