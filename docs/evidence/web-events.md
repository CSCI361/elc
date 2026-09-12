# Event web checkpoint

Work paused at the user's request on 13 September 2026. The event frontend is
implemented but its complete browser acceptance flow has not been verified.

The current source includes public event discovery and details; organizer event
creation, editing, publication, ticket types, and seat availability; quantity and
attendee entry; campaign-code submission; reservation review and expiry;
zero-total confirmation; order and ticket recovery; protected admission QR
display; and payment status polling and reconciliation. Routes use the shared
API contracts. Interface text is provided in Kazakh, Russian, and English.

The assigned-seat SVG uses the API's inventory records, keyboard navigation,
availability labels, and a selected-seat summary. Checkout submits ticket IDs,
seat IDs, quantities, names, and an optional campaign code. The server calculates
prices and discounts. Identical mutation retries retain their request ID. The
countdown uses the reservation's fixed `expiresAt` value. QR generation runs
locally with qrcode 1.5.4; credentials are neither sent to a QR service nor placed
in URLs or browser storage.

Checks completed before the pause:

- Scoped `vp check` passed with no warnings, lint errors, or type errors.
- `vp exec tsc --noEmit -p apps/web/tsconfig.json` passed.
- Seven policy tests passed for minor-unit conversion, fixed expiry deadlines,
  event time zones, payment URL safety, and assigned-seat checkout input.
- The browser loaded discovery without uncaught page errors.
- A disposable account completed registration, email verification, and sign-in.
- The organizer creation form rendered with its schedule and seating controls.

No event was submitted in this browser session. The disposable account and its
private mailbox messages were removed, and the browser session was closed.

Still required before calling this slice complete:

- Run the full event creation, editing, publication, reservation, confirmation,
  ticket recovery, and QR flow against the local worker and D1.
- Exercise the 80-seat map, conflicts, expiry, and campaign errors in the browser.
- Verify responsive layouts, keyboard behavior, and accessibility, and fix any
  findings.
- Verify the payment return and reconciliation UI against the sandbox workflow.
- Run the final web build and integration checks after any fixes.

Paid-sales activation is currently shown as inactive when the API reports it.
The activation API contract was published during this work, but its organizer
form is not yet integrated. Paid checkout uses the real payment API; no external
payment success is claimed by this checkpoint.
