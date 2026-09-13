# Delivery review regression evidence

`apps/api/src/delivery/review.integration.test.ts` adds eight independent regressions for the delivery coordinator and private payload cleanup. Each test creates isolated D1 and R2 databases through `createAuthTestDatabase` and Miniflare. The database loads the repository migrations, including delivery payload tracking in `0022_delivery-payload-cleanup.sql`. The tests dispose both runtimes afterward and do not use the shared development database.

The actual Resend adapter receives an injected HTTP transport. That transport records the serialized request and idempotency header and returns synthetic provider responses. No request reaches Resend or another external provider. Synthetic PDFs contain no real ticket or admission credential.

## Verified regressions

- An accepted email followed by a forbidden provider lookup ends in `review_needed`. Its provider ID and accepted status remain available for investigation. A failed status lookup does not establish failed delivery.
- A lost POST response followed by a permanent rejection also ends in `review_needed`. Both attempts use the same serialized body and `elc-email/review` key.
- A real D1 send-attempt update commits, but its returned result is withheld from the first worker. After 30 seconds, the account loses verification and a second worker suppresses the delivery. Releasing the first response produces no provider request and does not undo suppression.
- A database trigger rejects the PDF failure transition. PDF state, email state and outbox completion remain pending together. After removing the injected failure and expiring the lease, retry atomically finalizes PDF failure, email failure and outbox completion without sending mail.
- R2 successfully stores a payload, but its response is lost before the coordinator attaches the database pointer. The payload already has a durable tracking record. Recovery uses a different object; cleanup removes the abandoned object while preserving the current unresolved payload. A late write under the abandoned key is removed by the next hourly sweep.
- A worker pauses before its R2 write. Its lease expires and a second worker attaches the replacement payload. Cleanup tombstones the abandoned key before the paused write arrives. The late worker cannot replace the current pointer, and a later sweep removes its object without deleting the current payload or sending a second email.
- Content changes during preparation leave a superseded render. Cleanup removes that object while retaining the completed delivery's current payload until its 30-day retention boundary. Cleanup does not change the delivery receipt.
- A backlog of 51 expired objects takes two cleanup passes. The first deletes 50, the second deletes the remaining object, and the canonical pending delivery is unchanged.

Clock advancement is injected; the tests do not wait through leases or retention periods. The delayed-result test executes real D1 statements and withholds only one response. It does not simulate a successful database commit with an in-memory replacement.

## Results

- `vp test apps/api/src/delivery/review.integration.test.ts` passed all eight tests.
- `vp check apps/api/src/delivery/review.integration.test.ts docs/evidence/email-review.md` passed formatting, lint and type checks.

These tests cover coordinator recovery and storage retention. They do not claim live provider delivery, sender-domain configuration, or recipient fanout acceptance. No production source files, manifests or lockfiles were changed by this regression-test unit.
