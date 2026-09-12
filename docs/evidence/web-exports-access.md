# Web exports and event access

## Exports

Verified on 13 September 2026 against the local Worker at
`http://localhost:5173`, using a disposable account, event, order, and ticket.

Ticket and confirmation pages offer authenticated PDF downloads. PDF access is
independent of admission status: cancelled or blocked tickets can still be
exported, while the digital QR remains hidden when admission is blocked.
Downloads check HTTP status, media type, and the file signature. They use
same-origin credentials, disable caching and redirects, abort when their page or
account changes, and revoke temporary object URLs. Errors appear in the page
instead of being saved as files.

Event and confirmation views use the shared calendar response schema for the
server's current metadata, download URL, creation links, and localized manual
replacement note. Cancelled snapshots omit Google and Outlook links. Creation
links open only after an explicit click and omit the referrer. The UI explains
that the chosen provider receives the event details. Previously fetched links
are hidden after access or network errors.

Browser checks passed:

- The confirmation page downloaded a valid PDF and an ICS file. The ICS contained
  the event's stable UID, sequence, Asia/Almaty time zone, and confirmed status.
  Downloading did not reveal the on-screen admission QR.
- A cancelled fixture snapshot removed both calendar creation links and kept the
  replacement-file action. A blocked ticket retained PDF download and had no QR
  reveal button. These states were seeded directly for export acceptance; this
  task did not exercise an event cancellation command.
- Suspending the fixture account between page load and download produced a
  localized authorization error and created zero blob URLs. The account was
  restored after the check.
- A separate anonymous browser received 404 for the private calendar and 401 for
  the protected PDF; it rendered no private calendar links.
- The Kazakh replacement note and download label rendered at 390 px without
  horizontal page overflow. Axe 4.12.1 reported zero violations on that page.

Six download and calendar policy tests passed. Scoped `vp check`, the web
TypeScript check, and the web build passed. The build retained the existing large
entry-chunk warning. External calendar account creation was not submitted.

## Event access

The event owner can open staff and invitation management from the event editor.
Staff changes replace the selected account's explicit event permissions; saving
an empty selection revokes them. Invitation controls queue, reissue, or revoke
delivery. Both lists use bounded cursor pagination and the server's event
revision. A conflict offers a fresh read before another attempt. Delegated event
management does not expose owner access controls.

Invitation acceptance reads the bearer token from the URL fragment, strips it
before rendering, and keeps it only in memory for that page. Email/password
sign-in and account switching work in the same tab. Registration, password
recovery, and other sign-in options open a separate tab with a clean URL; the
original tab can refresh its account session. No token enters browser storage,
return paths, links, or rendered fields. Success and terminal rejection discard
it. Reloading asks the guest to reopen the original invitation. Requests abort
when their account or page changes, and an uncertain request keeps its operation
ID for retry.

Browser checks passed with three fresh, verified synthetic accounts and a
private event:

- The owner assigned event management and scanning permissions, then revoked
  both. The delegate could not use the owner access page. After revocation, the
  delegate also lost access to the private event details.
- The owner queued an invitation. A signed-out guest signed in on the invitation
  page, accepted it, and gained private event access. Another verified email
  received the generic unavailable message without recipient disclosure.
- Guest acceptance changed the event revision. A stale staff edit failed with
  a conflict; the visible reload action recovered the current revision, and the
  next edit succeeded.
- Reissuing immediately removed accepted guest access. The old link failed; the
  new link could be opened in the same tab, survived explicit account switching
  and sign-in, and restored access after acceptance. Owner revocation removed
  access again.
- Token checks after opening, sign-in, account switching, success, and rejection
  found no token in the current URL, rendered DOM, local/session storage, links,
  or resource request URLs. Reloading displayed the localized reopen message.
- English, Kazakh, and Russian owner pages fit a 390 px viewport. The Kazakh
  owner page and invitation success page each passed Axe 4.12.1 with zero
  violations. Browser error logs were empty. Focus moves to the acceptance
  action, mutation result, or error when the corresponding state changes.

Five invitation navigation tests and the existing auth/event/download policies
passed together: 24 tests. Scoped formatting, lint, and web TypeScript checks
passed. The web build passed with the existing entry-chunk warning (567.27 kB
minified). React review covered effect cleanup, stale account responses,
component keys, native form controls, and lazy route loading.

Invitation delivery is queued, not verified as sent. Acceptance browser checks
recovered each disposable invitation from the private encrypted outbox through
a local test helper. The UI never exposes that outbox or a token recovery
endpoint. Google OAuth and external email delivery were not exercised.

All owned browser sessions were closed. Both export and access fixtures and
their private helper credential files were removed from local D1/R2 as
applicable. The shared development server was left running.
