# Transactional notification templates

The pure renderer in `apps/api/src/delivery/templates.ts` produces a text subject and body for nine canonical notification kinds. It has no database, network, transport, attachment-generation, or delivery-state operations. The durable delivery coordinator supplies the current authorized source facts, recipient, saved language, and actual canonical ticket PDFs before freezing a delivery request.

`renderNotification(input, { appOrigin, locale })` returns a frozen `{ subject, text }`. `NotificationInput` comes from the exported strict `notificationInputSchema`. Unknown fields are rejected. `notificationLocale(value)` accepts `kk`, `ru`, or `en` and otherwise returns `kk`; background notifications have no browser language to inspect. The caller supplies the saved account or purchaser preference. `formatNotificationKzt(minor, locale)` formats safe integer minor units without floating-point division.

All kinds except `support.changed` require `eventId` and `eventTitle`. The remaining fields are:

| Kind                   | Required fields                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `order.tickets`        | `orderId`, `amountMinor`, total `ticketCount`, this message's `attachmentCount`, one-based `part`, total `parts`              |
| `payment.failed`       | `paymentAttemptId`, `amountMinor`                                                                                             |
| `event.updated`        | No additional fields                                                                                                          |
| `event.cancelled`      | No additional fields                                                                                                          |
| `refund.completed`     | `paymentAttemptId`, `amountMinor`                                                                                             |
| `payout.status`        | `status` (`completed`, `adjusted`, or `held`), signed `amountMinor`                                                           |
| `support.changed`      | `caseId`, `action` (`created`, `message`, `assignment`, or `status`); canonical `status` is required only for a status change |
| `activation.completed` | `feeMinor`                                                                                                                    |
| `order.cancelled`      | `orderId`                                                                                                                     |

Ticket delivery counts must describe a feasible complete delivery, with one to six ticket PDFs per message. This renderer reports the total order count and the current part; it does not assemble PDFs or verify that the coordinator attached them. Payout refund adjustments are nonpositive. Other amounts are nonnegative. The renderer accepts zero-cost orders and does not describe them as paid.

The text is authored in Kazakh, Russian, and English. Organizer event titles remain exactly as entered in the body. Subjects collapse whitespace and line separators and truncate without breaking Unicode pairs. Malformed Unicode, disallowed control characters, empty titles, and fields beyond their bounds are rejected. A fixed `NotificationTemplateError` omits input values and validation details.

Every message identifies the academic demonstration. Payment, refund, activation, and paid-order messages explicitly identify sandbox transactions without real money transfers. Payout messages identify simulated entries without bank transfers. Activation confirmation describes a recorded activation and directs the organizer to current eligibility. Cancellation does not imply that a refund has completed. Support messages contain an action and protected case link, without a case subject, message body, author name, attachment name, or admission credential. The wording works for both customer and assigned staff recipients.

Application links use a validated configured origin and individually encoded entity IDs. HTTPS origins are allowed; HTTP is restricted to localhost, loopback, and private IPv4 addresses for local development. Credentials, paths, queries, fragments, and noncanonical origins are rejected. Templates accept no arbitrary link fields.

The route audit checked the existing web event, support, and payout modules and the API calendar export:

| Destination                   | Existing route                                        |
| ----------------------------- | ----------------------------------------------------- |
| Order and tickets             | `/orders/:orderId`                                    |
| Payment and refund status     | `/payments/:paymentAttemptId`                         |
| Event details                 | `/events/:eventId`                                    |
| Event settings and activation | `/organizer/events/:eventId`                          |
| Simulated payout ledger       | `/organizer/events/:eventId/payouts`                  |
| Support case                  | `/support/cases/:caseId`                              |
| Updated calendar export       | `/api/events/:eventId/calendar.ics?locale=kk\|ru\|en` |

Event update and cancellation emails include the event page, the current calendar export, sign-in instructions, and a replacement reminder. Calendar imports may create a separate entry. The templates do not claim automatic calendar synchronization or create a second calendar event link as an update. Existing calendar read authorization remains in force, including private-event checks; the existing public calendar behavior is unchanged. Calendar UID, sequence, and cancellation metadata remain the export service's responsibility.

This implements the notification and localization policies in `docs/architecture-decisions.md`, including integer KZT values, saved recipient language, untranslated organizer content, and an updated calendar file in cancellation notices.

Validation completed on 2026-09-13:

- `vp test run apps/api/src/delivery/templates.test.ts`: 107 tests passed.
- `vp check apps/api/src/delivery/templates.ts apps/api/src/delivery/templates.test.ts`: formatting, lint, and scoped type checks passed.
- `vp exec tsc -p apps/api/tsconfig.json --noEmit`: passed.

The tests exercise all nine kinds in each locale, compatibility with the frozen email transport schema, exact minor units up to `Number.MAX_SAFE_INTEGER`, subject injection and Unicode boundaries, origin and ID encoding, support privacy, cancellation links, and impossible ticket-part counts. They make no external sends. This evidence covers rendering and validation; actual recipient fanout, PDF attachment delivery, provider acceptance, and email-client display belong to the delivery integration and acceptance checks.
