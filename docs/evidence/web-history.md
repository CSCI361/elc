# Web organizer history

Verified locally on 2026-09-13. The real Worker/browser flow, six policy tests, scoped format/lint/type checks, web TypeScript check and web build pass.

The web history module exports `HistoryRoute({ path })` and `isHistoryPath(path)`. The main app selects this route group before the general event route matcher. Each page is loaded through React `lazy` and uses the existing account protection and authenticated API helpers.

| Browser path                           | Purpose                                      |
| -------------------------------------- | -------------------------------------------- |
| `/organizer/history`                   | Retained completed/cancelled event overview. |
| `/organizer/events/:eventId/history`   | Event-local chronological activity.          |
| `/organizer/events/:eventId/duplicate` | Allowlisted duplication into a new draft.    |

The overview labels its Asia/Almaty time zone, offers title search, phase/date filters, and cursor paging. An event timeline uses the event's time zone, activity type and seven-day/30-day/custom civil-date filters. Both pages show expiry information and general retention-hold categories returned by the server. Canonical descriptions remain original audit text; navigation, filters, activity categories and workflow messages have Kazakh, Russian and English copy.

History reads use only the history API. A denied response hides event metadata and entries rather than retaining the previous payload on screen. The timeline shows duplication only when `canDuplicate` permits it. The separate duplication page reads the protected event preview, allowing manager-only staff to duplicate without granting them history access. History-only staff cannot open that preview. The backend still enforces all scope and case permissions described in [history evidence](history.md).

The duplication page explains the allowlist, fresh ownership, excluded historical records and separate paid-sales activation. It accepts new event and registration times in the event's named time zone. Conversion is independent of the browser's time zone and rejects ambiguous or nonexistent local times during DST changes. The request contains only the dates, current source revision and request ID.

Before sending, the page saves the exact request in account/event-scoped session storage. This contains identifiers, revision and dates; it contains no auth token, attendee or support content. An ambiguous response freezes that request, including across reload. The retry button sends the same request ID and payload. A subsequent authorization error cannot prove an earlier uncertain operation failed, so it cannot silently create a replacement request. A confirmed response navigates to the returned draft editor. A first, definite validation/conflict rejection permits correction, and a conflict reloads source metadata. Storage failure prevents the initial POST. Leaving the page during a request preserves the pending operation for recovery.

Inputs have associated labels, filter forms use normal GET navigation, timeline entries use semantic list/time elements, and details use native keyboard controls. Page headings receive focus after navigation. Layouts collapse to one column at narrow widths. A duplicate authorization failure clears source metadata immediately.

Six focused policy tests pass for routing, filter/cursor preservation, event-zone conversion and DST edge cases, allowlisted/current-revision input, idempotent recovery/account isolation, and required locale strings. Scoped format/lint/type checks and the web TypeScript check pass. The React review checked lazy loading, effect cleanup, account-bound component state, request cancellation and current error handling.

The local browser verification uses synthetic accounts authenticated through real HTTP signup, private development-mail verification and signin. Its ignored script is `test-results/web-history/verify.mjs`. Private Wrangler commands are restricted to exact fixture aging, event grants, synthetic audit rows and cleanup. Cookies/passwords remain in process memory. The script closes browser contexts and removes exact fixture accounts/events/support history in `finally`; it keeps a non-secret scope manifest if cleanup fails.

The completed Chromium run used four separately authenticated accounts against the running local Worker. It verified:

- Overview paging across 21 retained events, title/phase filters, Almaty overview labels, and chronological timeline paging across more than 20 entries.
- Activity and custom civil-date filters; the owner saw the attendee support activity while platform conversation and platform-scoped audit entries stayed absent. History-only staff saw an empty support filter and could not duplicate. Manager-only staff could duplicate but could not read history.
- A real duplication committed successfully before the browser deliberately lost its response. After reload, the retry sent exactly the same ID and body. The receipt returned the one existing fresh draft, with the acting manager as owner, pending paid-sales activation and the reusable ticket type. Entered Almaty dates produced the correct UTC payload while the browser used America/Los_Angeles.
- Revoking the manager before a new duplication POST produced a denial, immediately removed source metadata and created no second draft. Revoking a history grant removed the previously rendered timeline on the next focus-triggered authorized read.
- Heading focus and keyboard Tab progression into the overview and duplication forms. All three locale pages rendered at 390 × 844 with no horizontal overflow. The saved KK/RU/EN screenshots were visually inspected for readable text, wrapping and button layout. No browser page errors occurred.

The browser check initially exposed an imprecise accessible name on the shared select wrapper. History controls now supply explicit localized accessible labels; the full rerun passed. The script respected a real local authentication rate limit and retried after its window instead of changing the limiter.

All synthetic accounts, source/draft events, grants, audit entries, support conversations, associated outbox/receipt records and private development mail were removed. Browser contexts closed, and the fixture scope manifest was removed after cleanup verification. No credentials were printed or saved in the evidence. Screenshots remain in the ignored `test-results/web-history/` directory.

This is local Chromium acceptance. Physical mobile devices, Safari/Firefox and screen-reader testing remain unverified. No remote resources, provider transactions or email delivery were used.
