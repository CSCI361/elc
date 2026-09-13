# Offline operations web workspace

The responsive web application now provides `/offline` for event discovery and `/organizer/events/:eventId/offline` for device management and reported-admission review. The implementation follows the offline policy in `architecture-decisions.md`, particularly device loss, conflict review and separate provisional/server-confirmed results. It uses the existing canonical offline API; it does not perform browser-based scanning or change admission, refund or retention rules.

The discovery page uses `GET /api/offline/events`. It includes owned events and current scanning or check-in-review assignments, so review-only staff can reach their event without event-edit access. Platform moderators reach device management from the administration event table. Other entry points are the active-account navigation, owner event cards, owner editor actions and the event access page.

## Current authority and records

The workspace first reads `GET /api/events/:eventId/offline/access`. Its independent `manageDevices`, `reviewAdmissions` and `openIncident` capabilities determine which controls and links appear. Scanning staff can inspect their own registered devices. Device management remains limited to the owner or a platform moderator. Admission review remains limited to the owner or an assigned check-in lead; platform moderation alone does not grant it.

Device cards display the label, device and account IDs, registration time, last synchronization, revocation and reported-loss state. They do not claim to know how many unsynchronized operations remain on a device. Admission cards display operation, account, device, ticket and order IDs, device-capture and server-report times, synchronization result and recorded review details. No raw admission credentials, token hashes or purchaser contacts are requested or displayed.

The device and admission lists have independent first/next pagination with 20 records per page and opaque server cursors. Lists poll every 15 seconds while the page is visible and refresh on window focus. Failed reads hide previous records and actions. Account/event changes isolate the workspace; capability changes replace the device view before it can show rows from its previous authority. Mutations remain subject to current server authorization and revision checks.

## Revocation, incidents and admission review

Revocation requires a reason of 1–500 characters and optionally records device loss. The page explains that revocation does not remotely erase disconnected devices, unsynchronized lost-device records cannot be recovered from the server, and a replacement device must sign in online and download a fresh snapshot.

An owner can open the existing event-linked organizer/platform support form with the technical category. This is a separate user action. Device-loss revocation records the server incident and audit entry; the UI does not claim that a support case was created automatically. Other roles receive the ordinary support landing link without implied access to an event's support cases.

Only unresolved, ticket-linked reports offer a review form. It requires an explicit resolution and a recorded reason. The explanation distinguishes report resolution from canonical check-in reversal. Confirming an admission keeps an existing eligible check-in or creates one eligible server check-in; declaring that no admission occurred does not reverse an existing canonical check-in. Separate reversal authorization remains necessary.

## Uncertain retries and interface behavior

A workspace-level command store captures the request ID, target, body and expected revision at submission. While a response is pending, duplicate submissions are blocked. A network error, ambiguous server failure, timeout or rate-limit response retains the exact envelope for an explicit retry. Polling, card remounts and temporary read failures do not change it. Forms lock their inputs while a result is uncertain, and a retry cannot substitute a newer revision or resolution.

Definite client failures require a new attempt; revision conflicts offer a reload before another decision. Authorization failures refresh current access. Successful operations show a server-confirmed acknowledgement and reload current records. Command memory is scoped to the current account/event workspace and is not stored in browser storage. The uncertainty message explains that a full browser reload discards this local retry memory.

All interface strings and server scan-result labels have Kazakh, Russian and English versions. Forms use labelled controls, required reasons, native details, explicit submit buttons and status/error announcements. The layout wraps long identifiers and uses a single column at narrow widths. React review checked stable component identities, subscriptions, asynchronous state, capability gating and lazy route loading.

## Local verification

Nineteen focused tests cover exact retries after changed polling data, report-resolution preservation through unsubscription/remount, duplicate submissions, definite versus uncertain failures, authorization classification, account/resource isolation, scoped pagination URLs, malformed routes, shared validation and complete KK/RU/EN result labels.

The root integration browser rehearsal used disposable local accounts, 22 free canonical admissions and signed offline duplicate reports. It passed all 12 recorded checks, including:

- Owner, review-only staff and platform-moderator discovery/control separation.
- KK/RU/EN workspaces at 390 pixels without horizontal overflow or browser errors.
- Admission pagination with 20 records, then 2, and return to the first page.
- A committed lost-device revocation whose response was dropped, followed by polling and an exact retry that produced one incident audit entry.
- Both review resolutions preserving the existing 22 canonical admissions without an implicit reversal or duplicate check-in.
- Revoked review access removing displayed reports on focus refresh.
- Owner incident navigation and separate support permissions.

All synthetic accounts, events, offline records and mail were removed. No Polar transactions or existing payment fixtures were used. The local result is recorded in ignored `.wrangler/web-offline-operations-results.json`; RU and EN screenshots were also visually reviewed by the integrating agent. These browser checks do not replace physical iOS/Android offline acceptance.

Validation commands:

```sh
vp test apps/web/src/offline-operations --maxWorkers=1
vp check apps/web/src/offline-operations apps/web/src/App.tsx apps/web/src/components/app-shell.tsx apps/web/src/events/list-page.tsx apps/web/src/events/editor.tsx apps/web/src/access/owner-page.tsx apps/web/src/administration/page.tsx docs/evidence/offline-operations-web.md
```

Integrated validation passes 1,408 tests across 84 files in 633.07 seconds. Full
checks pass 457 files; web/Worker/Astro builds pass. The backup rehearsal is
validated separately by its 34 safety cases and two nonempty restore cases.
