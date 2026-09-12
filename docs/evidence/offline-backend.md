# Offline backend foundation

The backend implements event-scoped device registration, signed snapshots, synchronization, rejected-operation journals, and reported-admission review. It uses the existing canonical tickets and check-ins. The Expo cache and scanner integration are separate work; these tests do not establish physical-device acceptance.

## Contracts and routes

`offlineRoutes` is exported for mounting under `/api`. The request and response contracts, page digests, and complete-snapshot verifier are exported from `@elc/shared` in `offline-api.ts`.

| Method and path                                                  | Purpose                                                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| GET/POST `/events/:eventId/offline/devices`                      | List visible devices or register a scanner's device                                          |
| POST `/events/:eventId/offline/devices/:deviceId/revoke`         | Organizer/platform-admin revocation, with revision and reason; optional lost-device incident |
| POST `/events/:eventId/offline/snapshots`                        | Freeze a snapshot and return its signed manifest                                             |
| GET `/events/:eventId/offline/snapshots/:snapshotId`             | Retrieve the currently authorized manifest                                                   |
| GET `/events/:eventId/offline/snapshots/:snapshotId/pages/:page` | Retrieve a frozen page containing at most 100 tickets                                        |
| POST `/events/:eventId/offline/sync`                             | Upload at most 25 sealed scan units, each optionally containing its local undo               |
| GET `/events/:eventId/offline/admissions`                        | Paginated operation results and review state for the organizer/check-in lead                 |
| POST `/events/:eventId/offline/admissions/:operationId/review`   | Resolve a reported admission using revision, reason, and a stable request ID                 |

Device and review lists default to 20 and permit at most 100 records. Cursors are scoped to the list, event, and caller. An account can register at most ten active devices per event. Registration requires explicit `ticket:scan`; ownership alone does not qualify. Revocation preserves the registration and appends an audit/outbox incident. It does not claim to recover data from a lost device.

## Snapshot trust and connected access

Snapshot ticket rows are frozen in a conditional D1 batch. They contain token hashes, ticket state, admission-blocked state, active check-in identifiers, attendee names, and seat details. They contain no raw admission credentials or contact information. The manifest binds the account, device, event, issue/expiry times, ticket count, page count, and SHA-256 digest of each page. Its ES256 signature uses the configured private P-256 JWK. [Cloudflare documents ECDSA signing and verification in Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/).

`verifyCompleteOfflineSnapshot` requires a deployment-pinned public key and expected account/device/event/key ID. It verifies the manifest, every page digest and binding, uniqueness, completeness, and lifetime before returning any usable tickets. Pages may arrive out of order. A partial, duplicated, substituted, or modified page set fails verification. Supplying a private key as the public verification key is rejected.

Snapshots expire four hours after issuance, capped at two hours after the event ends. Connected downloads recheck permission, account status, device registration, event cancellation/suspension, and expiry. The page data and final authorization are read in one D1 batch. Cancellation or suspension during signing prevents publication of the manifest. Frozen pages remain immutable.

The optional bindings `OFFLINE_SIGNING_PRIVATE_JWK` and `OFFLINE_SIGNING_KEY_ID` must be configured per environment. Local setup provisions a separate P-256 pair and writes its public pin to ignored `.wrangler/offline-public-key.json`, preserving existing credentials. These tests use generated disposable keys. Key distribution to the native app must pin the deployment public key; a public key supplied alongside untrusted cached data is insufficient.

## Synchronization and corrections

Each operation has a stable ID, device sequence, snapshot reference, device timestamp, and immutable sealed-unit hash. A scan with a local undo must upload both operations in the same unit. Both records commit together as `locally_reversed`, with no check-in. Retrying after an interrupted HTTP response preserves that result. A request interrupted between units resumes through the stored operations.

The client must freeze a unit before its first upload attempt. It cannot append a local undo to a unit that might already have reached the server. After an uncertain response it must replay that sealed unit; reversing a confirmed admission requires the separate authorized reversal endpoint. The API rejects attempts to change a previously sealed unit.

Synchronization rechecks current permission, device, event, order, ticket, and refund state in the admission batch. It shares `admissionOutcomeSql` with online scanning and the same unique active-check-in constraint. The first eligible server commit wins. Device timestamps are retained as reported facts; they do not choose the winner. Future timestamps, captures outside the snapshot lifetime, journals older than seven days, and detected sequence/timestamp rollback cannot grant admission.

The authenticated device account can submit its rejected operations after staff/device revocation or account suspension. Those records are journaled without admission authority. A matching reported physical admission that did not become canonical creates an unresolved report. Another account cannot upload or inspect the device journal.

`unresolvedOrderOfflineAdmissionSql(orderId)` in `offline/guards.ts` supplies the predicate used by voluntary financial transitions. If a report commits first, the voluntary refund/cancellation guard fails. If the financial admission block commits first, synchronization records the report but cannot create a canonical admission. Automatic event-cancellation refunds and technical compensation keep their separate rules.

An event owner or current explicit `checkin:review` assignee can review reports. A scan-only or reverse-only assignee cannot. Confirming admission preserves an existing canonical check-in or creates one only while the ticket remains currently eligible. Review never reverses the first canonical record. A reversal independently requires explicit `checkin:reverse`, including for an owner. Every review records a reason, audit entry, and outbox transition.

## Database and verification

Migration `0012_refund_authorization.sql` adds immutable voluntary-refund actor, support-case, and reason fields. `0013_offline_records.sql` adds the offline tables; `0014_offline_guards.sql` enforces scope and immutable facts. Their updates remain compatible with later retention deletion: the migrations add no permanent DELETE prohibition.

All 31 initial Miniflare/D1 tests passed, including 101-ticket signed pagination, tampering and partial pages, two-device admission races, interrupted synchronization, paired undo, expiry and clock rollback, revoked accounts/staff/devices, connected page-read races, signing cancellation/suspension, both financial/report commit orderings, and review authorization. Two additional focused tests for late undo and concurrent review also passed, bringing the file to 33 cases. Scoped lint and TypeScript project checks passed.

Pending native work includes SQLCipher storage, SecureStore keys, the one-minute refresh loop, sign-out journal locking, startup/running cleanup, 24-hour synchronization warnings, seven-day deletion deadlines, and physical iOS/Android camera and offline tests. Demonstration signing-key configuration and deployment acceptance are also separate from these automated tests.
