# Web support, refunds, and cancellation

Verified on 13 September 2026 against the local Worker at
`http://localhost:5173`. Three disposable verified accounts, one event, one
zero-total order, and one support case supplied the browser fixtures.

## Implemented behavior

The support area offers personal, staff, and assigned queues with event, status,
and category filters. Case creation links preserve the event/order/ticket
context. Conversations display plain text and ordered changes in pages of 20.
Managers can choose an eligible assignee, unassign a case, and change its status.
Resolved cases stop accepting replies until a manager reopens them.

A same-origin WebSocket receives typed invalidation frames. Displayed content
always comes from an authorized REST read. Duplicate update IDs and old
sequences are ignored; gaps, reconnects, and heartbeat progress trigger fresh
reads. Connections use the shared protocol, a 30-second heartbeat, and bounded
reconnect backoff. Hidden pages close the socket; unmounting or an access error
removes the subscription and private conversation. REST polling remains
available at a bounded interval. Background refresh preserves an unsent reply.

Case management and financial authority are separate. Refund views use the
server's frozen amount, processing-fee snapshot, payout contribution, current
eligibility, and refund status. Only financial staff can approve a paid refund
or cancel a free registration. Paid approval requires an unresolved matching
attendee refund case reference and a reason. A financial reviewer can supply
that reference without opening a conversation they cannot read. Attendees can
open a refund or cancellation request from their order.

The event editor offers cancellation with an explicit explanation and required
reason. After cancellation, editing controls disappear and the page retains
support and calendar replacement actions. Refund and notification states use
queued/processing language until the server confirms completion.

## Browser evidence

- A guest created a refund-category case from an existing free order. The owner
  found it in the filtered event staff queue. Applying status/category filters
  kept the staff view and returned the expected case.
- The owner assigned an eligible support staff member, changed the case to
  waiting for customer, resolved it, reopened it, and unassigned it. The
  requester had no assignment, status, or financial-action controls.
- A support-only staff member could read and handle the case but had no
  registration-cancellation button. Its financial panel explained that separate
  financial permission was required.
- An incoming guest reply increased that staff browser's timeline from four to
  five records within 235 ms. Its unsent draft remained unchanged. Submitting a
  browser reply saved the text, cleared the composer, and showed the queued
  notification notice.
- Revoking the assigned staff member's support permission and posting another
  guest reply immediately removed the case subject, history, and draft from the
  revoked browser. It showed a generic unavailable message. Assignment remained
  present in the case record and granted no access.
- A 31-change fixture rendered 20 records on its first page and 11 on the next,
  with the expected ordered boundary and no duplicate records. First-page and
  latest-update actions remained available.
- The owner cancelled the free registration through the case's financial panel.
  A fresh API read confirmed the order was cancelled. The guest's order showed
  its cancelled ticket and retained the protected PDF action.
- The owner cancelled the event through the editor. A fresh event read confirmed
  cancellation; the calendar response was CANCELLED with null creation links.
  The browser removed editing, Google Calendar, and Outlook controls and kept
  the ICS download.
- The support case fitted a 390 px viewport in English, Kazakh, and Russian.
  Axe 4.12.1 reported zero violations on the Kazakh case page. All three browser
  page-error logs were empty.

## Checks and limits

Seven focused policy/live tests pass. They cover financial authority versus
eligibility, the matching unresolved refund-case requirement, contextual
financial categories, bounded links/routes, current subscription startup,
duplicate/out-of-order signals, sequence gaps, and typed heartbeat frames.
Scoped `vp check`, the web TypeScript check, and the web build pass. The build
retains the existing large entry-chunk warning (584.45 kB minified).

Paid refund UI is connected to the real API, but this browser run submitted no
paid refund and made no external payment or email action. It verified financial
permission denial and zero-total cancellation; provider refund settlement is
covered separately by backend/provider evidence. Notification text says queued,
and no email delivery is claimed.

Owned browser sessions were closed. The exact synthetic accounts, event, order,
tickets, support history, receipts, notifications, and related local R2 objects
were removed. The private fixture credential file was deleted, and the shared
server was left running.
