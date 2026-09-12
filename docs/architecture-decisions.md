# elc architecture decisions

Updated: 2026-09-13

This document defines the planned architecture for elc's academic MVP. The repository currently contains a React web starter; the applications, backend services, and deployment described here remain to be implemented.

The product requirements are in [elc SRS, initial draft v0.3](./elc_SRS_Initial_Draft.pdf). Section references below refer to that version. This document records technology choices and the product policies for implementation. Use `elc` as the project and product name. The product decisions listed in SRS Section 12 are resolved here for the academic release; provider integration and technical acceptance still need verification.

## Scope and interpretation of the SRS

The team commits to the core workflows and every SRS stretch feature, plus Google sign-in and the Astro marketing website. The delivery commitment includes:

- Free registration, paid-sales activation, KZT checkout, printable tickets, online mobile check-in, cancellations and full refunds, moderation, support cases, campaigns, basic analytics, and organizer history.
- Assigned seating with a predefined venue layout and an interactive seat map.
- Calendar export through `.ics` files and common calendar links.
- Advanced organizer analytics combining GA4 traffic/funnel data with authoritative elc records.
- Offline ticket verification and synchronization in the Event Admin app.
- Support-message attachments and real-time support delivery.
- Google sign-in and the deployed Astro marketing website.

All are part of the team's completion criteria.

Implement the assigned-seating requirements in Section 4.3.1 and the calendar-export requirements in Section 4.11. The team's decision supersedes the bonus classification in Sections 8 and 13, the online-only boundary in Section 4.8, and the optional treatment of enhanced support and GA4 reporting in Sections 4.13-4.15. The next SRS revision should record the expanded delivery commitment and the offline guarantees below.

The delivery remains an academic release with all SRS stretch features included. Payments, organizer payouts, and identity/payout verification use sandbox services or clearly labelled simulations. The Expo mobile app is for Event Admins and supports online and offline check-in. Attendees and organizers use the responsive web application.

The team retains these exclusions from SRS Section 8:

- Real-money payment processing and organizer payouts.
- Production KYC/KYB identity-verification workflows.
- Native attendee and organizer applications.
- App Store and Google Play publication.

Offline synchronization remains included with the provisional results and conflict reconciliation defined below. It does not guarantee prevention of physical double entry across disconnected devices. Basic cancellations and refunds remain required in sandbox or simulation; Section 13.4's contingency to cut refund simulation requires a recorded scope revision before it changes the acceptance criteria.

Plan and assign ownership for every committed feature from the start. Implementation order follows dependencies and does not make a committed feature optional. Changes to the delivery commitment require an explicit team decision recorded here and in the delivery plan.

## Technology stack

| Area               | Choice                            | Use                                                                                                                             |
| ------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Web UI             | shadcn/ui                         | Attendee, organizer, and platform-admin interfaces. Use Base UI, Phosphor icons, and Roboto.                                    |
| Web application    | React with TypeScript             | Responsive web application. Use Tailwind CSS and React Compiler.                                                                |
| Marketing website  | Astro with TypeScript             | Public marketing website and landing pages in `apps/marketing`.                                                                 |
| Backend            | Hono with TypeScript              | One API organized by feature, deployed on Cloudflare Workers.                                                                   |
| Tooling            | Vite+                             | Web development, builds, formatting, linting, type checking, and tests.                                                         |
| Mobile             | Expo React Native with TypeScript | Event Admin online check-in, provisional offline verification, and synchronization. Expo uses Metro for native bundling.        |
| Database           | Cloudflare D1                     | Canonical application records, including support and audit history. Validate the choice in the ticketing integration milestone. |
| File storage       | Cloudflare R2                     | Event images, generated ticket PDFs, and private support attachments. Authorize protected file access through the API.          |
| Deployment         | Cloudflare Workers                | Hono API and React static assets. Route `/api/*` to the API.                                                                    |
| Authentication     | Better Auth                       | Shared accounts across web and mobile, backed by D1. Use the Expo integration and SecureStore for native sessions.              |
| Email              | Resend                            | Verification, confirmations, ticket delivery, and other transactional messages.                                                 |
| Payments           | Polar sandbox                     | Develop checkout, payment webhooks, and refunds without real money movement.                                                    |
| Offline cache      | Expo SQLite with SQLCipher        | Encrypted event snapshots and pending scan operations; keys in SecureStore.                                                     |
| Live support       | Cloudflare Durable Objects        | Authorized case updates over WebSockets, with D1 history and REST catch-up.                                                     |
| Advanced analytics | GA4 and the GA4 Data API          | Traffic and funnel reporting combined with authoritative elc metrics.                                                           |

### Backend and database rationale

Use Cloudflare Durable Objects with WebSockets for live support-case updates, R2 for protected support attachments, and the GA4 Data API for aggregate traffic reports. The Expo app uses `expo-sqlite` with SQLCipher for its offline cache and pending scans, with the encryption key in SecureStore. These support the expanded scope; D1 remains the canonical application database. See the provider references below.

TypeScript extends the language already used in the web starter to the API, shared validation, and Expo app. Hono keeps one backend on the Workers deployment required by the SRS. Shared contracts reduce integration work for the five-person team. Confirm team familiarity with Hono, SQL, and Workers during the initial integration work; the repository alone does not establish that experience.

D1 explicitly replaces the PostgreSQL/MongoDB recommendations in SRS Sections 9 and 12 for the academic MVP. The event, order, ticket, staff-assignment, and audit model benefits from relational constraints and joins. D1 integrates with Workers bindings and avoids operating a separate database service during the term. Its SQL and deployment constraints make correctness and query performance an early delivery risk.

Keep D1 subject to the ticketing integration milestone proving concurrent inventory and promo reservations, idempotent payment processing, and check-in under representative reporting load. Record results before expanding the backend. If those guarantees cannot be demonstrated, revisit the database decision before other features depend on it. Update the next SRS revision with the selected database and runtime.

## Repository organization

Use a monorepo with separate applications and shared API contracts:

```text
apps/
  marketing/    Astro marketing website and landing pages
  web/          React web application
  api/          Hono API, authentication, and background job handlers
  mobile/       Expo Event Admin application
packages/
  shared/       API contracts, validation schemas, and shared types
```

Share contracts and validation between the clients and API. Keep web and native UI implementations separate. Keep secrets and server-only business logic out of client packages. Use one backend organized by feature.

Keep these feature boundaries within `apps/api`; they are modules of the same backend:

| Module                | Owns                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accounts and access   | Organizer profiles, event staff assignments, platform permissions, and application access policies. Better Auth owns authentication records.           |
| Events                | Venue layouts, sections, rows, seats, event configuration, visibility, publication, cancellation, calendar exports, and paid-sales activation records. |
| Orders and payments   | General-admission and seat reservations, order items and price/seat snapshots, payment attempts, refunds, and simulated payout records.                |
| Tickets and check-in  | Canonical tickets, admission credentials, PDF generation, check-ins, reversals, offline snapshots, and scan synchronization.                           |
| Campaigns             | Campaigns, promo codes, temporary redemption allocations, and committed redemptions.                                                                   |
| Support               | Contextual cases, messages, protected attachments, assignment, status changes, and authorized live-update subscriptions.                               |
| Reporting and history | Queries over authoritative records, GA4 aggregate reporting, and event activity history.                                                               |
| Delivery              | Outbox dispatch, queue consumers, and notification delivery state.                                                                                     |

Orders coordinate inventory, promo redemption, and ticket issuance in a single database transition. Feature boundaries must not split that transition into separately committed API calls.

## API contracts

Define request and response schemas with Zod in `packages/shared`. Implement Hono REST routes in `apps/api` and use Hono's typed client in the web and mobile applications. Keep public API responses separate from database rows.

Before parallel client and backend work starts, encode the ownership rules, state transitions, and money/time policies below in shared entity and endpoint schemas. Specify error codes, pagination, and payment-adapter signatures at the same point. Review contracts through the first integrated flow and update clients and schemas together. Keep server imports used for client typing type-only.

## Authentication and authorization

Use Better Auth for authentication and session management. Host it in the Hono API so both web and Expo clients use the same account system.

Support email/password registration, email verification, sign-in, sign-out, password reset, and Google sign-in. Require a verified account for event publication, as specified by UC1. Include Google sign-in in the shared web and Expo authentication flow and its acceptance tests.

Use the Better Auth Expo plugin on the server and its client plugin with Expo SecureStore in the mobile application. Configure trusted web origins and native callback schemes. The mobile Hono client must attach the Better Auth session cookie to application API requests; storing the session alone does not authenticate those requests. Check authorization on the server for every operation.

Connect Better Auth to D1 through its Drizzle adapter.

Event-specific authorization belongs in the application model. A signed-in Event Admin may scan tickets only for assigned events. Organizer access must likewise be scoped to the events they manage. Authentication alone does not grant organizer or platform-admin permissions.

Separate permissions to manage events, handle support, initiate refunds, scan tickets, and reverse check-ins. An Event Admin assignment does not grant organizer support or refund access. One account may have different permissions for different events. Require an account with a verified email for free registration, paid checkout, ticket downloads, and support requests. Public browsing does not require sign-in. The purchasing account owns the order and its tickets; attendee names may differ from the purchaser, but entering a name does not grant account access. Recover access through Better Auth password reset or Google sign-in; do not use guest order-access links.

Apply the same relationship checks to ticket downloads, support cases, analytics, history, and exports. Public events can be discovered; unlisted events are accessible by link and omitted from discovery. Private events use organizer-issued email invitations that the matching verified account must accept. Invitation tokens expire after seven days or when the event ends, whichever comes first, and can be revoked or reissued. Event staff access follows their assignment. A private event URL alone must not grant access. Platform moderation permissions are explicitly provisioned and audited.

## Events and paid-sales activation

SRS Sections 3.2, 4.2, 4.5, and 4.12 apply. Store event visibility, publication state, and paid-sales activation separately. Derive Upcoming, Active, and Completed views from event times, with Cancelled taking precedence; these views do not replace publication or suspension state. Enforce event capacity, registration windows, ticket-type sales windows, and per-order limits on the server.

Paid sales are enabled for an event only when it contains a paid ticket type, simulated identity/payout checks are complete, a simulated payout account is registered, the event activation fee has been confirmed, and the organizer has accepted the paid-event terms. The demo checklist requires a verified email, organizer display/legal name and contact information, a labelled simulated identity check, and a dummy payout-account reference. Provide controlled pass/fail scenarios for the simulated checks. Record acceptance of versioned demo terms stating that no real money or identity verification is involved. Store each checklist result, the fee and terms version, and its timestamp. Production identity documents and bank credentials are outside scope.

Keep activation-fee payments separate from attendee ticket payments. The default simulated activation fee is KZT 5,000 per event, non-refundable once activation succeeds, including when that event is later cancelled. Collect it only after the other checklist items pass; refund it if a confirmed payment cannot complete activation. Activation is per event and is never inferred from the organizer's other activated events. Record the one-time fee independently of current eligibility so suspension or retry does not charge it again. Show pending, active, and suspended eligibility in the organizer checklist.

Check current eligibility whenever creating or confirming a checkout containing paid ticket types, even if a promo reduces its total to zero. A paid-sales suspension blocks paid checkout. Suspending an event blocks all new registrations and sales. Cancellation blocks new orders and ticket issuance. In-flight payments that can no longer produce eligible tickets follow the compensation rules below.

Platform Admins can inspect activation records, configure the activation fee, suspend users or events, and search operational records. Persist and audit those actions. Snapshot the configured fee when an activation checkout begins; subsequent configuration changes apply only to new activation attempts.

### Assigned seating

Support general admission and assigned-seating events. Use a predefined 80-seat demo hall with Premium and Standard sections, each containing rows A-E and seats 1-8. Seats A1 and A8 in each section are accessible, giving four accessible places within the total capacity. Seed Premium at KZT 5,000 and Standard at KZT 3,000; organizers can change prices and mark seats unavailable. Store event-specific seat inventory so separate events at the same venue can sell the same physical seat independently.

Build the interactive seat map in React with SVG. Show available, selected, temporarily held, sold, unavailable, and accessible seats using labels or symbols as well as color. Support keyboard operation and mobile screens. Show the selected seats and their prices before checkout.

Use the order reservation mechanism for seat holds, with server-enforced expiry and atomic acquisition of every selected seat. Prevent two orders from acquiring the same event seat. A failed multi-seat reservation must not leave a partial hold. Release seats on abandonment or expiry, and commit seat ownership with payment or zero-total order completion. Recheck availability on the server; the displayed map does not establish ownership.

Persist section, row, and seat snapshots on order items and tickets, and include them in digital and printed tickets and staff attendee lookup. Preserve sold-seat assignments when event configuration changes. Event duplication copies reusable layout configuration into fresh event inventory and never copies holds or sales.

## Orders, payments, and refunds

SRS Sections 4.4, 4.6, and 4.9 apply. Keep order, reservation, payment-attempt, refund, and ticket state distinct. Persist immutable order-item snapshots of quantities, prices, discounts, charges, and currency. Calculate totals on the server.

Checkout holds last ten minutes from server creation and cover general-admission inventory, selected seats, and any limited promo allocation. Retrying a request, refreshing a page, or starting a payment redirect does not extend the deadline. Allow one active checkout reservation per account per event; changing its contents atomically replaces its allocations without resetting the original deadline. Freeze quantities, prices, and discounts once a provider payment attempt exists; the attendee must abandon that checkout before starting a different one. A later successful payment for an abandoned attempt follows the compensation rules. Default to six tickets per order, configurable by the organizer within the event's capacity.

Deduct a simulated processing fee of 3% of the amount paid after discounts from organizer revenue, rounded half up to the nearest minor unit. Attendees pay the displayed discounted ticket total with no added processing charge. Zero-total orders have no processing fee. Snapshot the rate and calculated amount on the order. On a full refund, return the entire amount the attendee paid and reverse the simulated processing fee. These are configurable demonstration rules and do not represent Polar's actual charges.

For acceptance, a KZT 10,000 order with a 10% discount charges the attendee KZT 9,000, records a KZT 270 simulated processing fee, and contributes KZT 8,730 to the organizer's estimated payout. A full refund returns KZT 9,000 and reduces that order's fee and payout contribution to zero. The event's successful KZT 5,000 activation remains a separate, non-refundable transaction.

Simulate organizer payouts seven days after the event ends. Hold the full simulated balance until that date, with no additional rolling reserve. The payout is completed ticket payments minus confirmed refunds and remaining simulated processing fees; the separately paid activation fee is not deducted again. Withhold the amounts of orders with pending refunds, disputes, or compensation cases until resolution; release the remaining eligible balance on schedule. A later refund of an already simulated payout creates a linked adjustment in the demonstration records. No bank transfer occurs.

Recheck event eligibility and reservation expiry in the conditional statements that commit each order transition. Apply the same rule to admission and reversal so a concurrent cancellation or refund cannot be bypassed by an earlier successful read.

| Transition                                      | Required behavior                                                                                                                                                                                                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start checkout                                  | Validate event eligibility and ticket rules, calculate the price, and atomically reserve inventory and any limited promo allocation with an expiry time. Retrying the same request must not create another hold or payment attempt.                              |
| Complete a zero-total order                     | Require no payment information or provider checkout. Atomically consume the valid reservation, commit promo attribution, create the completed order and canonical tickets, and record audit/outbox entries.                                                      |
| Confirm a paid order                            | Verify the provider event, linked payment attempt, expected amount, currency, and current order eligibility. Atomically complete the order, consume its unexpired reservation, commit redemption, issue tickets, and record audit/outbox entries.                |
| Expire or abandon checkout                      | Make the reservation unusable and release inventory and promo allocation exactly once. No valid ticket is created.                                                                                                                                               |
| Receive a late or ineligible successful payment | Record the payment without issuing tickets or reclaiming released inventory. Schedule an idempotent full refund and notify the attendee of its progress. Do not refund a payment again if its refund is already pending or completed.                            |
| Cancel a free registration                      | Check organizer authority and invalidate its tickets atomically with cancellation and audit/notification records.                                                                                                                                                |
| Initiate a full refund                          | Check authority and the event's refund policy. Persist a pending refund and block admission for its tickets before requesting the provider refund. Finalize refunded status on verified confirmation; retain failed attempts for retry or authorized resolution. |

Duplicate or out-of-order events must not reopen a completed, cancelled, or refunded order. Reconciliation uses the same transitions as webhooks. A delayed payment-success event for a refunded payment must never issue tickets.

An authorized organizer can approve a voluntary full refund only before the event starts and when none of the order's tickets has an active canonical check-in or an unresolved reported offline admission. Attendees request refunds through an order-linked support case. Apply the same cutoff and admission rule to voluntary cancellation of free registrations. Event cancellation automatically cancels free registrations and fully refunds paid orders regardless of the voluntary cutoff or check-in history. Technical compensation refunds always apply. Partial refunds are outside this academic workflow.

Restore inventory after a free cancellation or confirmed refund only if the event remains published, eligible for sales, and within its event and ticket-type sales windows. Released seats must also remain enabled. Otherwise retain the cancelled/refunded allocation as unavailable to new orders. Event cancellation never reopens inventory. Keep completed promo redemptions consumed after refunds or cancellations; release only allocations belonging to checkouts that never completed. Preserve all historical attribution.

Store a refund-policy snapshot for each order. Organizers can provide event-specific refund instructions while preserving these platform rules. Event cancellation stops server-confirmed admission immediately; refund requests and notifications can complete asynchronously. Disconnected scanners learn of invalidation through synchronization or snapshot expiry, as specified below. Record every payment and refund action in the audit log.

### Payment integration

Use Polar's sandbox behind a small server-side adapter exposing checkout creation, payment-status lookup, refunds, and webhook verification. Keep elc's orders, activation, inventory, ticket issuance, and refund state independent of Polar-specific objects. Label checkout, reports, confirmations, and refunds as demonstrations. A checkout redirect alone is not proof of payment.

Polar's current [product documentation](https://polar.sh/docs/features/products#multiple-payment-currencies) lists KZT pricing. Before relying on the integration, prove sandbox KZT totals, multiple ticket quantities/types, discounts, charges, duplicate and delayed webhooks, and full refunds. Use elc's Resend integration for ticket delivery. Model organizer payout requirements and estimated payouts internally as clearly labelled simulations.

If the sandbox cannot satisfy these flows, use the SRS-permitted internal KZT simulation through the same adapter and record the change here. Live provider selection remains a future decision: Polar's [acceptable-use policy](https://polar.sh/legal/acceptable-use-policy) prohibits marketplaces and requires closer review for ticket sales. The sandbox choice does not establish production suitability.

## Tickets, campaigns, and admission

SRS Sections 4.7, 4.8, and 4.14 apply. Use a securely random opaque admission token bound to one canonical ticket. Treat the human-readable ticket identifier as an identifier, not an admission credential. Use a versioned admission payload without attendee personal information or trusted price fields. Digital and printed copies contain the same credential and represent one admission.

Campaign QR codes contain HTTPS event links with opaque campaign tokens. They use a separate payload format, token lookup, and visual treatment. Resolve the campaign and calculate its discount on the server; never accept a client-provided discount amount. The scanner and admission endpoint must reject campaign links before attempting check-in.

Support percentage and fixed-KZT campaigns, ticket-type applicability, validity windows, disabling, and maximum redemptions. For the MVP, apply at most one promo per order and count one redemption per completed order. A new campaign defaults to 10% off eligible ticket types, 100 completed-order redemptions, and the event's sales window. Organizers must review and explicitly enable it; allow percentages from 1% to 100%, a positive fixed-KZT amount capped at the eligible subtotal, and a positive redemption limit. Temporarily allocate limited redemptions during checkout, release expired allocations, and commit them atomically with order completion. Keep campaign attribution and discount snapshots after refunds so historical reporting remains accurate.

Online admission validates the token, assigned event, current ticket/order/event eligibility, and scan permission on the server. Check-in is an atomic transition that permits only one active canonical admission record per ticket. Return clear outcomes for invalid, wrong-event, cancelled, refunded, and already-used tickets. A retry of the same scan request returns its recorded outcome; an independent later scan reports already used.

Authorized reversals retain the original check-in and add a reversal record and audit entry. A reversed check-in makes an otherwise eligible ticket available for admission again. Provide event-scoped attendee search and registered/check-in counts in the mobile app. Distinguish server-confirmed results from provisional offline results. A network error alone must never be presented as a confirmed check-in.

Generate A4 PDFs from canonical ticket records using a Workers-compatible renderer. Include the SRS ticket fields and fonts covering Kazakh and Russian characters. Prove QR readability on paper in grayscale using both supported mobile platforms. Persist PDFs in protected R2 storage and authorize downloads against the ticket owner or permitted event staff. Regeneration must preserve the ticket credential; online admission and synchronization check current server state.

### Offline verification and synchronization

Before going offline, an authenticated Event Admin downloads a server-signed, expiring snapshot for an assigned event and registered device. Include ticket-token hashes, ticket status, existing check-ins, seat details, and attendee names needed for staff lookup; omit contact details. Store the snapshot and pending scans in encrypted local SQLite. Never download raw admission credentials. Bind cached data to the account, device, and event. A snapshot is valid for four hours after server issuance, capped at two hours after the event ends. Refresh it every minute while the event is open in the connected scanner, preserving pending local operations.

Remove expired snapshot data and stop offline validation until a new authorized snapshot is available. Keep acknowledged local operations for 24 hours after synchronization and unsynchronized operations for seven days after capture. Warn staff after 24 hours without successful synchronization and show the deletion deadline. Sign-out removes snapshots and locks the encrypted pending journal until the same account authenticates online again. Another account must never see or synchronize it. Purge expired local data on app startup and while running; a device that remains powered off cannot perform cleanup.

On device loss, an organizer or Platform Admin revokes its registration. A replacement device must authenticate and download a fresh snapshot online. Unsynchronized records on a lost or erased device cannot be recovered from the server. Record that loss as an operational incident; staff reconcile it through the event's support case and audit history.

Offline validation requires a valid snapshot and a matching admission-token hash. Atomically record each local scan with a stable operation ID, snapshot version, and device timestamp. Reject repeat scans on that device and known invalid tickets, including campaign QR codes. Display the snapshot age, provisional outcome, and pending-sync count. Unknown tickets and expired snapshots require connectivity or staff resolution.

On reconnect, authenticate again and upload scans in bounded, retryable batches. Recheck event assignment and current ticket state, deduplicate operation IDs, and apply the normal atomic check-in transition in D1. The first eligible server commit wins; conflicting scans remain recorded for staff review without creating another canonical admission. Retain both device and server timestamps; client clocks must not decide which scan wins. Return a result for every operation and retain unsynchronized records across application restarts.

Disconnected scanners cannot share immediate knowledge of other admissions, refunds, cancellations, or revoked staff access. The prototype prevents duplicate admission on one device and detects cross-device conflicts during synchronization; it does not guarantee prevention of physical double entry across disconnected devices. Immediate invalidation applies to connected operations. Show this distinction to check-in staff and keep provisional counts separate from confirmed attendance analytics.

Allow local undo of an unsynchronized scan as another operation referencing the original scan, retaining both for audit and preventing sync from creating an active admission for that locally reversed pair. Reversal of an already confirmed check-in requires the server's current authorization and state checks. The organizer or an explicitly assigned check-in lead reviews sync conflicts. Keep the first eligible server admission unless that lead makes an authorized correction with a recorded reason; a conflict must never issue another ticket or create a second active admission. Accept rejected operations into the audit journal, including operations from staff whose scan permission was revoked, without granting them admission authority.

Test two disconnected devices scanning the same ticket, refund/revocation while offline, interrupted sync, clock skew, expired snapshots, sign-out with pending scans, and lost-device recovery. Suspected clock rollback requires connectivity; server time remains authoritative.

## Calendar export

Implement SRS Section 4.11 with downloadable iCalendar (`.ics`) files and one-click links on event pages and order confirmations. Support Google Calendar on the web, Outlook on the web, and Apple Calendar on iOS and macOS. Provide Google and Outlook event-creation links and use `.ics` for Apple Calendar and file import. Include the event title, start and end times, configured time zone, venue name and address, description, and event URL. Apply event-access rules before producing exports or links for private events. Export event details only, with no attendee, ticket, or invitation credentials.

Keep a stable `UID` for each event and increment `SEQUENCE` when its details change. Event duplication creates a new identifier. Provide an updated file with `STATUS:CANCELLED` when an event is cancelled and include its link in the cancellation notification. Calendar export must not request write access to the attendee's calendar account.

Downloads and event-creation links save a snapshot. Imported entries do not automatically follow changes, as documented by [Google](https://support.google.com/calendar/answer/37118) and [Microsoft](https://support.microsoft.com/en-us/outlook/import-or-subscribe-to-a-calendar-in-outlook-com-or-outlook-on-the-web). Notify attendees of updates and provide the revised file plus instructions for updating or replacing their existing entry. Do not present another event-creation link as an update action. Calendar subscriptions and automatic account synchronization are outside this export workflow. Acceptance checks must cover correct times, stable identifiers, cancellation metadata, and a documented replacement procedure for each supported client that leaves one entry.

## Support cases and notifications

SRS Sections 4.10 and 4.13 apply, extended with committed attachments and real-time delivery. Persist case messages and status changes through authenticated REST endpoints. Use a Cloudflare Durable Object per case with the WebSocket Hibernation API to notify authorized participants after D1 commits. Keep bounded polling and cursor-based catch-up for reconnects; D1 is the source of conversation history.

Store requester, issue category, available event/order/ticket context, assignee, messages, and case status. Support Open, In Progress, Waiting for Customer, and Resolved. Validate contextual references when creating a case so linking another user's order or ticket cannot expose its data.

Attendee cases are accessible to their requester and authorized organizer support staff, with Platform Admin access for moderation or escalation. Organizer-to-platform cases are accessible to their requester and authorized Platform Admins. An event link on an organizer's payment or account case must not grant event staff access to that conversation. Recheck access for messages, assignments, and status changes.

Record case changes and notification jobs atomically. Send email for verification, order confirmation, payment failure, ticket delivery, event updates/cancellation, refund completion, simulated payout status, and relevant support replies, assignments, and status changes. Keep delivery failure separate from the underlying order or case result.

Publish committed case-update IDs through the outbox and attempt immediate dispatch for live delivery. Deduplicate updates on the client and fetch missing records after reconnect. Authenticate WebSocket subscriptions and recheck participant access before delivery; close connections when permissions are revoked. Durable Object bindings are internal to the API. Live delivery failure must not lose a saved message or bypass case permissions.

Store support attachments in a private R2 area with D1 metadata linking each file to its case, message, and uploader. Allow JPEG, PNG, and PDF files, at most 5 MiB each and three files per message. Authorize uploads and downloads through the API. Validate declared type, file signature, size, and successful parsing before release. Re-encode images to remove metadata; reject encrypted PDFs and PDFs containing scripts, actions, or embedded files. Reject content that the validator cannot inspect. These checks do not constitute a production malware-scanning service.

Keep uploads quarantined until validation succeeds. Return per-file errors and let the sender remove rejected files before submitting the message. Serve authorized downloads as attachments with content sniffing disabled. Remove rejected and abandoned uploads within 24 hours. Accepted attachments follow their case's retention deadline, and live notifications reference only committed messages with validated attachments.

## Organizer history and analytics

SRS Sections 4.15 and 4.16 apply. Retain completed and cancelled events with their operational records. Duplicate a past event using an explicit allowlist of reusable event and ticket configuration into a new draft. Never copy attendees, orders, tickets, payment/activation records, refunds, check-ins, support cases, or activity history. The new event starts with fresh inventory and requires its own paid-sales activation.

Write append-only audit entries in the same database transition as publication/cancellation, price/capacity changes, staff/permission changes, activation/moderation, payment/refund actions, campaign changes, support status changes, check-ins, and reversals. Include timestamp, actor, action, affected entity, event context when applicable, and a short description. Record a system actor and correlation ID for automated actions. Do not expose audit edits or deletion through normal organizer APIs.

Build the activity timeline from these entries, filtered by date and activity type. Preserve each entry's access scope: event membership must not expose platform-only case content or unrelated account activity. Full field-level versioning and rollback are outside scope. The outbox and provider logs do not replace the retained audit history.

Calculate required analytics from elc records, with event-level access checks and event/date/ticket-type filters:

| Metric                                | Definition                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capacity and remaining inventory      | Use current configured capacity and inventory/reservations. Do not derive remaining inventory solely by subtracting historical sales.                                                                                                                                                                                  |
| Tickets sold and percentage sold      | Count tickets issued by completed orders, including free registrations; report refunded/cancelled counts separately. Use non-cancelled, non-refunded issued tickets divided by capacity for current percentage sold, with an explicit zero-capacity result.                                                            |
| Gross sales and discounts             | Sum original ticket-price and discount snapshots for completed orders. Keep processing charges and activation fees separate from ticket sales.                                                                                                                                                                         |
| Refunds and net demonstration revenue | Report confirmed refunds with ticket amounts, charges, activation fees, and compensation for unfulfilled payments separated. Net ticket revenue is completed-order gross ticket sales minus discounts and refunded ticket amounts attributable to those sales. Derive estimated payouts using the selected fee policy. |
| Sales over time and by ticket type    | Group by order completion time in the event's time zone and by order-item ticket type. Retain original amounts when later refunds occur and report refunds by confirmation time.                                                                                                                                       |
| Campaign performance                  | Count committed redemptions, distinct completed orders, attributed ticket quantities, original gross sales, discounts, refunds, and net ticket revenue from persisted attribution.                                                                                                                                     |
| Attendance                            | Count active check-ins among eligible issued tickets. Exclude cancelled/refunded and admission-blocked tickets from both numerator and denominator; retain their check-ins in history. Absent holders equal eligible issued tickets minus active check-ins. Show 0% when no eligible tickets exist.                    |

Default the dashboard to the last 30 calendar days including today, using the selected event's time zone. Offer seven-day, 30-day, and custom ranges capped at 180 days per query. Use daily line charts for sales and net ticket revenue, horizontal bars for ticket types and campaigns, and labelled counts and progress bars for capacity and attendance. Provide a matching table for each chart. Capacity and attendance describe current event state and carry an explicit label; the date filter applies to sales, refunds, and campaign activity. Use Asia/Almaty for an organizer's multi-event overview and label that reporting zone.

Keep queries indexed and date ranges bounded. Test reporting concurrently with checkout and scanning; introduce rebuildable aggregate tables if measured load requires them. Record aggregate freshness if introduced. Confirmed attendance uses synchronized check-ins; provisional offline scans and sync conflicts are displayed separately.

### GA4 traffic and funnel analytics

Implement advanced organizer reporting alongside the authoritative metrics above. Configure a dedicated `elc-demo` GA4 property with separate web and marketing streams, reporting time zone Asia/Almaty, and currency KZT. Property IDs and credentials are deployment configuration. Collect `page_view` for approved public/marketing routes, `view_item` for public event details, `campaign_visit` for resolved public campaigns, and `begin_checkout` for public-event checkout starts. Allow only sanitized page metadata, event/campaign reporting IDs, locale, currency, value, and item quantity as application-supplied parameters. Register the event/campaign reporting IDs as custom dimensions. Do not collect private or unlisted event activity.

Fetch aggregate traffic/funnel reports through the GA4 Data API on the server and combine them with elc order and campaign totals by reporting IDs and date range. Show page views, event views, campaign visits, and checkout starts beside completed elc orders. Treat this as an aggregate comparison, since consent and multiple visits prevent it from being an exact person-level conversion funnel. Enforce organizer event access before returning reports; never expose property-wide data or reporting credentials to clients.

Use separate reporting IDs for events and campaigns. Do not send names, email addresses, phone numbers, ticket identifiers, order-access links, admission credentials, redeemable campaign tokens, or support content to GA4. Sanitize page URLs, referrers, and event parameters before collection, including campaign-link query strings. Disable automatic collection on protected account, order, ticket, support, and scanner pages; instrument approved funnel events explicitly.

Analytics collection requires explicit opt-in on each origin and defaults to off. Do not load GA4 or send analytics requests before consent; withdrawing consent stops collection and clears application-controlled analytics cookies. Disable Google Signals, advertising personalization, and User-ID. Set user/event data retention to two months with activity-based retention resets disabled. This setting does not govern standard aggregate reports; see [GA4 data retention](https://support.google.com/analytics/answer/7667196).

Use the same dashboard date controls for GA4 and elc data, cache fetched GA4 reports for one hour, and show the selected period and last successful fetch. GA4 results use the property's Asia/Almaty date boundaries; label the difference when an event uses another zone instead of silently joining mismatched days. Label GA4 figures separately from exact elc sales, discounts, refunds, and attendance. Missing or delayed GA4 data must not block checkout or suppress the basic dashboard. Verify submitted payloads, consent withdrawal, report filtering, and behavior when GA4 is unavailable.

## Background work

Use Cloudflare Queues with Cron Triggers and a D1 outbox table for background work.

| Component         | Responsibility                                                                    |
| ----------------- | --------------------------------------------------------------------------------- |
| Cloudflare Queues | Generate ticket PDFs, send emails and notifications, and retry failed jobs.       |
| Dead-letter queue | Retain jobs that exhaust retries for inspection and replay.                       |
| Cron Triggers     | Recover pending jobs, clean up expired reservations, and reconcile payment state. |
| D1 outbox table   | Record pending jobs together with the application changes that require them.      |

Keep queue consumers under `apps/api`.

For an order that requires ticket delivery:

1. Persist the order transition, canonical ticket records, audit entries, and an outbox entry atomically.
2. Publish the pending job to Queues. A scheduled recovery pass can find entries that were not published successfully.
3. Generate the PDF from the canonical ticket record, store it in R2, and deliver the email.
4. Track PDF and email completion separately so retries do not issue additional tickets or repeat completed work unnecessarily. Use stable job IDs and provider idempotency keys where supported.

Queue delivery is at least once, so jobs need stable IDs and idempotent processing. A failure after publication can result in another publication during recovery; consumers must handle that safely.

Use the same outbox for refund requests, support-case updates, and other external side effects. Queue consumers must recheck current state before acting on delayed jobs. Ticket validity and canonical admission transitions remain server database decisions; provisional offline scans become canonical only through synchronization. Sending an email or generating a PDF does not make an order paid or a ticket valid.

Check reservation expiry during checkout and inventory operations. Scheduled cleanup must not be the only mechanism that makes an expired reservation unavailable to its previous holder or releases its inventory.

## Database queries and migrations

Use Drizzle ORM with the D1 driver for database queries and TypeScript schema definitions. Keep database code under `apps/api`, with schemas organized by feature.

Generate the auth schema with the Better Auth CLI. Manage auth and application tables together with Drizzle Kit, which generates SQL migration files. Commit and review those files, then apply them to local and deployed D1 databases with Wrangler. Use Wrangler to track applied migrations.

## Database correctness

Use conditional writes, database constraints, and concurrency tests for ticketing operations in D1.

The design must prevent:

- Selling more tickets than the available inventory.
- Selling the same assigned seat twice within an event.
- Redeeming a promo code beyond its configured limit.
- Committing more than one active canonical check-in for a ticket without an authorized reversal, including during offline synchronization.
- Issuing duplicate tickets when payment events or jobs are delivered again.
- Partially committing an order without its inventory, promo redemption, tickets, audit entries, or required outbox jobs.
- Reopening cancelled or refunded orders through delayed notifications.

D1 supports transactional batches that roll back on SQL failure. An update affecting zero rows is not automatically a SQL failure, so batching statements alone does not establish these guarantees. Design and test each state transition explicitly.

Keep queries indexed and bounded, particularly analytics queries that share the database with checkout. Each D1 database processes queries one at a time; the documented maximum database size on the paid plan is 10 GB.

## Money, time, localization, and quality

SRS Section 7 applies. Store monetary values as integer minor units with an explicit currency code; use KZT throughout the MVP. Calculate percentage discounts on the applicable order subtotal with integer arithmetic, rounding half up once to the nearest minor unit. Cap discounts at that subtotal. Allocate the rounded discount proportionally to order items, distributing remainder units by largest fractional remainder with a stable item-order tie-break. Persist allocations so item totals equal the order total and refunds use the original calculation. Keep activation fees and processing charges distinct and never trust client totals. Future currency support must use currency metadata rather than assuming every currency has the same minor-unit scale.

Store timestamps as UTC instants and retain an IANA time-zone identifier on each event, defaulting to Asia/Almaty. Evaluate expiry on the server. Use the event's time zone for sales windows, display, history, and event reporting date boundaries. Calendar export must preserve that zone and a stable event identifier.

Keep interface strings in shared locale resources with Kazakh and Russian translations and English available as an additional locale. Cover web, mobile, marketing, notifications, and ticket templates. Use the saved account preference, otherwise the first supported browser/device language, falling back to Kazakh. Persist explicit language changes and use the purchaser's saved language for ticket and order messages. Organizer-authored event content is displayed as entered without automatic translation. Include localization in the acceptance criteria for each interface.

Meet the SRS WCAG 2.1 AA target for event pages and verify keyboard navigation, focus, labels, error messages, and contrast through checkout. Support the current and previous stable desktop releases of Chrome, Edge, Firefox, and Safari at release freeze, plus mobile Safari and Chrome. Record exact browser versions in the acceptance report.

Target iOS 16.4 or later and Android 10 or later for the Event Admin app. Test camera scanning, grayscale ticket prints, secure storage, offline restart/sync, and Google sign-in on at least one physical iPhone and one physical Android phone. Test the minimum supported OS versions in a simulator/emulator where compatible; camera and offline acceptance still require physical devices. Record device models, OS versions, and build identifiers. Check the selected [Expo SDK's platform requirements](https://docs.expo.dev/versions/latest/) when pinning dependencies.

Measure online validation from scan submission to displayed server result; target at least 95% within two seconds. Use a repeatable dataset of 50 events and 10,000 issued tickets, with 20 concurrent checkout attempts, five scanner clients each submitting one scan per second, and two organizers refreshing dashboard reports every ten seconds for ten minutes. Seed both general-admission and seated events, campaigns, refunds, and completed check-ins. Run against the deployed demonstration environment and record network latency, throughput, failures, and scan percentiles. Correctness must hold under the separate last-ticket, seat, promo, and duplicate-scan race tests even if a performance target fails.

Use HTTPS, provider encryption at rest, secure password hashing through Better Auth, and server-only secrets. Keep ticket PDFs and backups separate from public event-image access. Do not store payment-card data. Validate inputs, sanitize displayed organizer content, and protect cookie-authenticated mutations with the configured authentication/origin controls. Log request/job correlation IDs and failures without admission tokens, passwords, or payment credentials.

## Integration milestones and acceptance

### 1. Establish contracts and the foundation

Implement the product policies in this document through shared contracts before parallel client work. Establish the monorepo, authentication, migrations, automated checks, and a Workers development/deployment path. Include seat inventory, calendar identifiers, offline scan operations, attachment metadata, and analytics reporting IDs in the shared model. Prove email/password and Google sign-in and authenticated API calls from web and Expo, including denial for an unassigned event. Establish the Astro application, Durable Object bindings, and protected attachment storage. Prove the encrypted offline cache in native development builds. Select a Workers-compatible PDF/QR implementation before ticket delivery depends on it.

### 2. Prove the ticketing flow and infrastructure choices

The first ticketing integration milestone is:

```text
Publish event -> complete simulated paid-sales activation
-> reserve ticket and limited promo -> complete KZT sandbox checkout
-> issue and deliver QR/PDF ticket -> check in once -> reject duplicate check-in
```

Prove this flow for general admission and assigned seating, plus free registration and a fully discounted zero-total order without provider checkout. Exercise concurrent attempts for the same event seat, last available general-admission ticket, and promo redemption; atomic multi-seat reservation failure; expired holds; duplicate and out-of-order payment events; payment success after cancellation; refund failure/retry; simultaneous scans; reversal; and queue failure/replay. Verify the resulting records and audit history, including absence of partial commits.

Run these tests against the D1/Workers execution path used by the application, with a deployed smoke test. Include concurrent reporting queries and the scan latency target. Record D1 and Polar results before expanding the backend.

Prove offline synchronization against the same admission transitions: cache an event, disconnect two devices, scan the same ticket, restart a device, reconnect, and replay batches. Confirm one canonical admission and an auditable conflict. Exercise snapshot expiry, local undo, refunds and staff revocation during disconnection, and partial batch failure.

### 3. Complete the required demonstration

Integrate every committed workflow and verify SRS Section 11 success criteria together with the team's expanded scope:

- Complete Google sign-in on web and Expo, and verify the deployed Astro marketing website links to the application and works in the supported locales.
- Create, preview, publish, manage, and moderate events, including stopping registrations/sales through suspension.
- Configure the predefined venue layout, choose seats through the accessible map, complete checkout, and verify the correct section/row/seat on order items, tickets, PDFs, and staff lookup.
- Export events through `.ics` files and supported calendar links; verify time zones, update/cancellation metadata, the documented replacement procedure in each supported client, and distinct identifiers for duplicated events.
- Distribute a Campaign QR Code, open the correct event, validate/apply its discount, complete an attributed order, and reject that campaign code at admission.
- Deliver an authorized downloadable ticket and scan its grayscale A4 printout on iOS and Android. Verify attendee search, counts, and authorized check-in reversal.
- Complete provisional offline scans on iOS and Android, synchronize after interrupted connectivity, and verify duplicate conflicts, invalidation, local undo, and separate pending/confirmed counts.
- Open contextual attendee and organizer support cases, exchange messages and allowed attachments, assign/change status, and receive live updates and email notifications. Verify reconnect catch-up, duplicate update handling, file validation, and denial of unauthorized file and WebSocket access.
- Cancel free registrations, complete full refunds, and verify invalidation, audit entries, notifications, and reporting totals.
- Verify the recorded policy defaults: verified-account ownership and private invitations, activation refundability, the fee calculation example, payout holds, ten-minute reservation expiry, refund cutoffs, inventory restocking, and consumed promo redemptions after refunds.
- Review capacity, sales, revenue, ticket-type, campaign, and attendance analytics; inspect retained event history; duplicate a past event without copying historical transactions or activation.
- Combine GA4 traffic/funnel reports with elc campaign and order totals. Verify sanitized payloads, event-level access, data freshness labels, and basic-dashboard availability when GA4 fails.
- Verify the required locales, accessibility, retention cleanup including restored data, backup recovery, and demonstration labels.

The first ticketing milestone alone does not establish MVP completion. Every committed feature needs integration, peer review, validation, and documentation. Schedule all core and former stretch features, Google sign-in, and marketing with time reserved for integration and stabilization. If the schedule changes, revise the plan with the team rather than silently dropping committed features.

## Development and deployment

Use the Cloudflare Vite plugin with Vite+ for Workers development and builds. Deploy the API and web assets to Cloudflare Workers, including the academic demonstration. The SRS uses Workers deployment.

Serve the React application and `/api/*` from the same application origin, with API routing taking precedence over the SPA fallback. Expo calls that API over HTTPS. Keep HTTP, queue, scheduled handlers, and support Durable Object classes in the API application, with explicit D1, R2, Queue, and Durable Object bindings. Route authenticated WebSocket upgrades through the API. Build Astro as static marketing content and deploy it as a separate Workers static-assets application on a separate origin linking to the React application. Marketing does not own checkout, sessions, or campaign resolution.

Use isolated local, preview, and demonstration resources and sandbox credentials. Commit Wrangler configuration, reviewed SQL migrations, and Durable Object class migrations; keep secrets out of the repository. Keep GA4 reporting credentials server-side and separate demonstration traffic from any future live property. Validate Workers runtime and library compatibility in the first integration, including the Cloudflare Vite plugin with Vite+ and the separate Expo/Metro build. Use native development builds for the SQLCipher configuration; Expo Go is not the acceptance environment for encrypted offline storage.

Automated checks must run formatting/lint/type checks, applicable application builds, API/state-transition tests, and interface/payment/QR tests. Include seat races, calendar exports, offline replay/conflicts, support WebSocket/file access, and analytics payload/report filtering. Use `vp run <script>` for configured package tasks. Mobile, offline, and printable-ticket acceptance also require the recorded device/print checks.

### Backup and recovery

Use D1's automatic [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) recovery and record the provider plan's actual recovery window in the deployment runbook. Keep daily SQL exports for 30 days in a separate private R2 backup bucket, accessible only to the deployment service and Platform Admin recovery role. Capture a restore bookmark and an additional protected export before schema migrations and the final demonstration. Apply the same 30-day expiry to these exports. Time Travel retention does not define the retention period of event or audit records.

Keep uploaded event images and support attachments under immutable object keys and retain referenced files under the deadlines below. Ticket PDFs are regenerable from canonical records. Document bucket bindings and recovery commands; perform a restore rehearsal against disposable test resources before the demonstration. Pause mutations, offline synchronization, and background consumers during recovery. Reapply retention cleanup so a restore does not expose expired records. Invalidate stale offline snapshots and reconcile payment/refund, scan-operation, and delivery state before resuming. Record any data loss or unresolved admissions requiring manual review.

### Academic data retention

Use the following retention periods for the academic environment and show the event-history expiry date to organizers. These are demonstration policies, not production financial-record retention rules.

| Data                                                                                                                           | Retention                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Completed/cancelled events and linked orders, tickets, payments, campaigns, check-ins, audit entries, support cases, and files | 180 days after the latest of event end, cancellation, or last linked support-case activity.                           |
| Unpublished drafts with no orders or unresolved workflows                                                                      | 180 days after the last edit.                                                                                         |
| Support cases without an event, their attachments, and account/platform audit entries                                          | 180 days after the case's last activity or the audit entry's creation.                                                |
| Inactive account profiles                                                                                                      | 180 days after the last sign-in, once no retained event, order, case, or audit record needs the account relationship. |
| Application logs                                                                                                               | 30 days, with credentials and personal content excluded.                                                              |
| SQL backup exports                                                                                                             | 30 days from export; provider-managed Time Travel uses its documented plan window.                                    |
| Offline snapshots and journals                                                                                                 | Snapshot expiry, 24 hours after acknowledgement, or seven days for unsynchronized operations, as defined above.       |
| Rejected/abandoned support uploads                                                                                             | At most 24 hours.                                                                                                     |

Run server cleanup daily and delete expired D1 records and related R2 objects together through retryable jobs. Pending refunds, payment compensation, or unresolved scan incidents postpone deletion of the affected records until resolution; expose the reason and deadline to Platform Admins. Remove completed outbox payloads after 30 days while retaining their business audit entries for the applicable period. Keep backup objects inaccessible to normal application queries and expire them independently. GA4 uses the settings above; delete its demonstration property when the environment is permanently retired.

## Product decision record

The team confirmed account access, private invitations, demonstration fees, activation checks, payout timing, refund rules, and checkout holds on 2026-09-13. This revision sets the remaining operational defaults under the team's request to close product decisions. The following policies are the implementation baseline, with details in their sections above.

| Area                               | Decision                                                                                                                                                                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name and scope                     | `elc`; all SRS stretch features, Google sign-in, and Astro marketing are committed. Retain the production, native attendee/organizer app, and store-publication exclusions.                                                                        |
| Accounts and private events        | Verified accounts for transactions and support; public browsing without sign-in; private invitations accepted by the matching verified email account.                                                                                              |
| Activation and verification        | KZT 5,000 simulated event activation, non-refundable after successful activation; demo profile, simulated checks, dummy payout account, and versioned demo terms.                                                                                  |
| Fees, payouts, and reserves        | Organizer pays a simulated 3% processing fee; full refunds reverse it. Hold funds until seven days after event end, then release eligible amounts with unresolved orders withheld and no additional rolling reserve.                               |
| Refunds, inventory, and promotions | Organizer-approved full refunds before event start with no active or unresolved reported admission; automatic event-cancellation refunds and technical compensation. Restock only eligible on-sale inventory; completed redemptions stay consumed. |
| Reservations and seating           | Ten-minute holds; six tickets per order by default; one active reservation per account/event; the predefined 80-seat hall.                                                                                                                         |
| Campaign defaults                  | Percentage or fixed-KZT discounts, one promo and one redemption per completed order; start new campaigns disabled with 10% off and a 100-redemption limit.                                                                                         |
| Offline operations                 | Four-hour snapshots, seven-day unsynchronized journals, explicit device revocation/recovery, and organizer/check-in-lead conflict review.                                                                                                          |
| Support files and delivery         | JPEG/PNG/PDF, 5 MiB per file, three files per message, validation before release, authorized WebSocket updates with catch-up.                                                                                                                      |
| Calendar clients                   | Google and Outlook on the web, Apple Calendar on iOS/macOS; `.ics` snapshots with stable identifiers, update/cancellation files, and documented replacement steps.                                                                                 |
| Analytics                          | Thirty-day daily charts by default, bounded date filters, current capacity/attendance counts, separate GA4 aggregates with opt-in consent and hourly report caching.                                                                               |
| Retention and compatibility        | 180-day academic history, 30-day exports/logs, iOS 16.4+, Android 10+, supported browsers and physical-device acceptance as defined above.                                                                                                         |

Changes to these policies require a recorded revision and updated acceptance criteria. Carry these decisions into the next SRS revision, including its expanded scope and qualified offline/calendar guarantees.

## Implementation verification still required

No product-policy questions remain open in this document. The repository is still a starter, so this decision record does not establish that the system works. Engineering work still includes the shared API/schema design, Workers-compatible PDF/QR and file-validation libraries, provider and authentication configuration, D1 concurrency/load proof, Polar sandbox proof, device tests, and recovery rehearsal. The milestones above define those checks. Assign implementation owners and dates in the delivery plan without treating committed features as optional.

## References

Verify provider capabilities against these references during implementation.

- [Hono on Cloudflare Workers](https://hono.dev/docs/getting-started/cloudflare-workers)
- [Hono typed client and RPC](https://hono.dev/docs/guides/rpc)
- [Hono validation](https://hono.dev/docs/guides/validation)
- [Cloudflare Workers static assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/)
- [Better Auth releases and D1 support](https://better-auth.com/blog)
- [Better Auth Expo integration](https://better-auth.com/docs/integrations/expo)
- [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)
- [Drizzle ORM with D1](https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Expo Metro bundler](https://docs.expo.dev/guides/customizing-metro/)
- [Resend on Cloudflare Workers](https://resend.com/docs/send-with-cloudflare-workers)
- [Cloudflare Queues](https://developers.cloudflare.com/queues/)
- [Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [D1 database API and transactional batches](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/)
- [D1 data import and export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [Polar sandbox](https://polar.sh/docs/integrate/sandbox)
- [Polar product currencies](https://polar.sh/docs/features/products#multiple-payment-currencies)
- [Polar acceptable use](https://polar.sh/legal/acceptable-use-policy)
- [Durable Objects WebSockets and hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Expo SQLite and SQLCipher](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [GA4 ecommerce event collection](https://developers.google.com/analytics/devguides/collection/ga4/ecommerce)
- [GA4 Data API reports](https://developers.google.com/analytics/devguides/reporting/data/v1/basics)
- [GA4 guidance on excluding personal information](https://support.google.com/analytics/answer/6366371)
