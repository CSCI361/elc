# Event staff and private invitations

The access module implements the staff and invitation rules in `architecture-decisions.md` and the corresponding SRS workflows. It uses the existing permissions, invitations, receipts, audit, and outbox tables. It adds no database migration.

`accessRoutes` is mounted under `/api`. Request and response schemas are exported from `@elc/shared` through `access-api.ts`.

| Method and path                                           | Contract                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| GET `/events/:eventId/staff`                              | Paginated staff, active permissions, and grant/revocation timestamps                        |
| PATCH `/events/:eventId/staff`                            | Replace one account's explicit permissions using email, `requestId`, and `expectedRevision` |
| GET `/events/:eventId/invitations`                        | Paginated invitation metadata without tokens or token hashes                                |
| POST `/events/:eventId/invitations`                       | Create an invitation using email, `requestId`, and `expectedRevision`                       |
| POST `/events/:eventId/invitations/:invitationId/reissue` | Revoke the previous invitation and queue a fresh token                                      |
| POST `/events/:eventId/invitations/:invitationId/revoke`  | Revoke current access using `requestId` and `expectedRevision`                              |
| POST `/invitations/accept`                                | Accept using `requestId` and the invitation token                                           |

Owner mutations share the event revision. Pagination defaults to 20 and permits at most 100 records; cursors bind the event, list kind, and revision. A changed revision requires a fresh list. Staff pagination starts from the event's permission index.

## Authorization and privacy

Staff and invitation management requires the verified, active event owner. Delegated `event:manage` and platform moderation do not grant assignment authority. Assignments target an existing account by normalized email. Granting permissions requires an active, verified target; revocation remains possible after the target is suspended. An empty permission list revokes all explicit permissions for that account in this event.

All eight existing event permissions are available. Ownership alone still grants neither scanning nor check-in reversal. An owner can explicitly assign those permissions to their own account. A staff grant permits its defined operations and does not replace an attendee invitation when purchasing private-event tickets.

Invitation tokens contain 32 random bytes. The invitation row stores a SHA-256 hash. The delivery outbox contains an AES-GCM encrypted token using the existing ticket encryption key and invitation-specific associated data. Owner responses, lists, receipts, and audit records contain no bearer token. Delivery uses an acceptance URL fragment so the token is excluded from the HTTP request URL. There is no public endpoint that reveals the recipient email from a token.

The module queues delivery only. A future email worker must recheck that the invitation is still pending and eligible before decrypting and sending it. This evidence does not claim delivery through an email provider.

## Transitions

An invitation requires a private event that has not ended, been cancelled, or been suspended. Its pending acceptance deadline is the earlier of seven days and the event end. Acceptance also requires a published event and the currently verified account email to match the invitation email. Expired pending tokens fail. Once accepted, access survives token expiry while the event and current account remain eligible.

Reissue creates a new invitation and revokes the previous one, including previously accepted access. Revocation is checked by the existing private-event purchase guards. Wrong-recipient, expired, revoked, and unavailable invitation acceptance returns a generic not-found response without disclosing invitation metadata. Account verification and suspension errors remain account-level errors.

Mutations use conditional D1 batches that recheck authorization and state alongside the receipt, revision, audit record, and outbox event. An unsuccessful guard rolls back the entire batch. Repeating a request returns its receipt; reusing a request ID with different input fails. Concurrent independent acceptance requests produce one acceptance audit/outbox event and retain a receipt for each successful request.

## Verification

The 29 Miniflare/D1 integration tests cover owner-only assignment, explicit scanner permissions, delegated and cross-event denial, target/account changes before commit, bounded pagination, concurrent mutations, token secrecy and authenticated encryption, email matching, expiry, reissue, revocation, and the Hono contracts. They also revoke invitations immediately before reservation and free-ticket issuance to verify that those existing transaction guards reject the purchase without issuing tickets.

All 29 tests passed. The eight acceptance tests affected by the final concurrent-receipt refinement were rerun and passed. The final pagination query was checked with the two pagination tests. Scoped lint and TypeScript project checks passed. No provider payment or email request was made for this work.
