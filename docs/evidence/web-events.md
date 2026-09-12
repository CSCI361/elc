# Event web evidence

Verified on 13 September 2026 against the shared local worker at
`http://localhost:5173`, its D1 database, and Better Auth. Browser checks used
agent-browser 0.37.1 with Chrome. No provider payment was started by this task.

The web app supports public discovery and event details; organizer creation,
editing, publication, ticket types, and seat availability; attendee names and
campaign codes; reservation review; free ticket confirmation; order recovery;
and protected admission QR display. The organizer activation checklist uses the
shared API's fictional profile fields, simulated checks, versioned terms,
configured fee, blockers, and payment/refund state. Text is available in Kazakh,
Russian, and English.

Checkout sends ticket and seat IDs, quantities, names, and an optional campaign
code. The server calculates the price. Retries preserve their operation ID when
the payload is unchanged. The countdown uses the server's fixed expiry. QR
creation runs locally, and credentials are hidden until requested and removed
when the window loses focus. Payment return URLs retain only the attempt ID
before authentication links or page content are rendered. Provider customer
session tokens are also removed from previously constructed sign-in return URLs.

Browser results:

- A disposable account registered, verified its email through the private local
  mailbox, and signed in. Existing account navigation and locale preferences
  continued to work.
- A general admission event was created and edited through the UI. Its free
  ticket type was added, then the event was published, unpublished, and
  republished. Public discovery reflected publication and search changes.
- An invalid campaign produced an API error and created no order. A valid free
  reservation retained both attendee names and its original expiry after reload.
  Confirmation issued two tickets, recoverable through My orders.
- The protected QR was initially absent. After explicit reveal, Chrome's QR
  decoder read one `elc_admission` version 1 payload with an opaque token. A blur
  event removed it. The token was not printed or included in a screenshot.
- Creating the assigned layout produced 80 seats. Organizer controls disabled
  and re-enabled a seat. Ticket type edits changed both sections to free. Before
  the second edit, its 40 paid seats were unavailable because activation was
  pending.
- Arrow, Enter, End, and Space keys selected Premium A2 and Standard E8, with
  attendee fields and a selected-seat summary. A second account then reserved
  A2. The first browser received a server conflict; it had no order for that
  event, and E8 remained available. After the competing hold was released, the
  browser refreshed, reserved both sections, confirmed, and received two valid
  tickets. Inventory showed those exact two seats sold and no remaining hold.
- The activation form saved a fictional profile, dummy payout reference, passed
  simulated checks, and accepted terms. The API returned `fee_required` as its
  only blocker and the configured 500000 minor-unit fee. No fee was charged.
- A signed-out payment return containing synthetic bearer values was reduced to
  `/payments/return?attempt=local-dummy`; no rendered link contained those values.
- Desktop, 390 px, and 320 px layouts were checked. A fieldset minimum-width bug
  was fixed; the seat map now scrolls internally without widening the document.
  Kazakh and Russian text and the dark theme were checked visually.
- Axe 4.12.1 reported zero violations on ticket, editor, and seat-selection pages.
  SVG contrast required manual review. Computed dark-theme contrast for all 83
  SVG labels was at least 6.16:1. Keyboard focus and state labels were checked.
  The final browser session had no uncaught page errors.

Validation passed:

- `vp check apps/web/src/events apps/web/src/App.tsx`
- `vp test apps/web/src/events/policies.test.ts apps/web/src/auth` (20 tests)
- `vp exec tsc --noEmit -p apps/web/tsconfig.json`
- `vp -C apps/web build`

Route splitting puts the editor, checkout, payment, orders, and QR pages in
separate chunks. The build still reports a 548 kB entry chunk warning. Expiry
boundary behavior is covered by policy tests; the browser check verified the
fixed deadline across reload, not a natural ten-minute wait. External payment,
Google OAuth, and Resend success are outside this evidence. The main task owns
sandbox payment acceptance.

The two disposable accounts, two events, orders, tickets, activation checklist,
private mailbox messages, and related records were removed after verification.
The fixture credential files were removed and both owned browser sessions were
closed. The shared development server was left running.
