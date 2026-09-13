# Platform administration

The platform screens at `/admin/accounts`, `/admin/events` and `/admin/settings`
provide account/event search, suspension and resume, activation inspection,
paid-sales moderation and activation-fee configuration in Kazakh, Russian and
English. The navigation displays only sections allowed by the current platform
grants. Email-delivery recovery retains its separate recovery permission.

## Authority and transitions

`GET /api/admin/accounts` and `GET /api/admin/events` require a verified,
unsuspended account with `platform:moderate`. Search accepts a literal query,
a suspension filter and an ID cursor, with 20 records by default and at most 50.
The account projection contains identity, email-verification and suspension
status; it never returns sessions or credentials. Event search includes title,
event ID and organizer ID. The final D1 read rechecks current authority.

`POST /api/admin/accounts/:id/suspension` and
`POST /api/admin/events/:id/suspension` require a request ID, reviewed revision,
target suspension state and a reason. One guarded D1 transaction writes the
state, immutable response receipt and audit entry. A concurrent change rejects
the stale revision. Exact retries return the original acknowledgement without
reapplying the change; reuse with another payload conflicts. The account's own
moderator must ask another moderator to change its suspension.

Account suspension deletes its sessions. Resume permits fresh authentication
and does not recreate sessions. Event suspension blocks public visibility and
admission through the existing event guards. These actions retain tickets,
orders and payment records. Paid-sales suspension uses the existing activation
transition and remains separate from whole-event suspension. Fee settings use
`platform:configure`, exact KZT minor units and the existing settings revision;
recorded activation attempts retain their fee. Activation inspection rechecks
moderation authority before returning the record and omits the organizer's
checkout link. A separate pending-payment regression verifies that redaction.

Migration 0025 adds the independent account moderation revision. Migration 0026
adds `offline_snapshots.invalidated_at`, with a trigger preventing invalidation
from being cleared or moved. Suspension invalidates live snapshots without
changing their signed manifest, original expiry or pending operations. Downloads
and signing reject invalidated snapshots. On synchronization, captures at or
after invalidation become conflicts for review. Earlier captures can reconcile
after access resumes if current admission checks pass. Disconnected devices
cannot learn about suspension until reconnecting; their results remain
provisional. Resume requires a fresh snapshot for further offline scanning.

## Verification

The administration and offline D1 suites pass 48 tests. Coverage includes current
authority at read/commit, concurrent suspension, stale revisions, exact replay,
changed request IDs, atomic audit/receipt rollback, session removal, preserved
preferences, self-suspension rejection and immutable signed snapshots. Real
signed-snapshot tests exercise suspension/resume, denial of old downloads,
pre-suspension reconciliation, later-capture conflict review and fresh issuance.

The local browser acceptance uses real Better Auth, Worker HTTP and D1 with
synthetic accounts and an event. It exercises suspension/resume, old-session
denial, fresh sign-in, public visibility, stale updates, activation inspection,
paid-sales controls and fee configuration. The previous fee is restored after
the test. It also checks initial review focus, focus return on close, all three
locales at 390 pixels, and removal of private records/forms after permission
revocation. Fixtures and private local mailbox records are removed afterward.
The ignored browser script and results are `.wrangler/web-admin-acceptance.mjs`
and `.wrangler/web-admin-results.json`.

Broader operational order/payment/audit search, retention holds, backup recovery
and deployed acceptance remain part of the release work. This evidence covers
these administration controls and does not establish release completion.
