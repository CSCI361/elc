# Resend email transport

Implemented on 2026-09-13 in `apps/api/src/delivery/email.ts`, with focused tests in `email.test.ts`. This unit is an adapter only. It does not create delivery rows, consume outbox jobs, send local development mail, or claim external email acceptance. Every test injects its HTTP transport; no message was sent to Resend.

## Contract

`freezeEmailRequest(raw)` validates, clones and freezes an `EmailRequest`, including its attachment objects and array. The strict schema accepts only `deliveryId`, `idempotencyKey`, `from`, one `to` mailbox, `subject`, plain `text`, and optional PDF attachments shaped as `{ filename, content }`. The key must be `elc-email/${deliveryId}`. The adapter never rotates that key, trims content, substitutes a new sender, or changes a payload after a provider refusal. The delivery coordinator must durably retain the frozen request and its original timestamps across retries and process restarts.

`createResendEmailAdapter({ apiKey }, { fetch?, now? })` exports:

```ts
send(request: EmailRequest, context: {
  firstAttemptAt: number
  lastAttemptAt?: number
}): Promise<EmailSendResult>

lookup(providerEmailId: string, request: EmailRequest): Promise<EmailLookupResult>
```

Timestamps are integer Unix milliseconds from the server. `send` rejects automatic attempts at or beyond 23 hours from `firstAttemptAt`. It also rejects invalid time, a clock before the first attempt, a regression within an adapter instance, or a clock before the optional persisted `lastAttemptAt`. The coordinator should pass its persisted last-attempt timestamp when recreating an adapter. Payload validation and serialization finish before the send-window check. Resend documents 24-hour idempotency retention; the local 23-hour cutoff leaves an hour of margin. Neither expiration nor a changed-payload conflict authorizes a new key. [Resend idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys)

A successful POST returns only `{ provider: 'resend', deliveryId, providerEmailId, status: 'accepted' }`. Acceptance does not mean that the recipient's mail server received the message. A valid UUID email ID is required even when the HTTP response is successful.

`lookup` performs a GET with the adapter's currently configured credentials. It validates the returned provider ID and the frozen sender/recipient mailbox bindings. Domains are compared without case; local parts retain case. Sender display-name formatting is not part of mailbox identity. A successful lookup returns only the provider/delivery IDs and its allowlisted `last_event`. It preserves `sent`, `delivered`, `delivery_delayed`, `bounced`, `failed`, `suppressed`, `complained`, `opened`, `clicked`, `queued`, `scheduled` and `canceled` as distinct values. Unknown or malformed status payloads are uncertain. A missing provider ID, lookup refusal or lookup failure never causes an implicit send. Lookup remains available after the send window closes. [Retrieve email API](https://resend.com/docs/api-reference/emails/retrieve-email), [email event definitions](https://resend.com/docs/dashboard/emails/manage-emails)

## Bounds and transport rules

Local bounds are stricter than Resend's documented 40 MB allowance after base64 encoding. The adapter permits at most six PDFs, 2 MiB decoded per file, 12 MiB total base64 attachment content, 200 subject characters, 64 KiB of UTF-8 plain text, and 13 MiB for the serialized provider request. It validates canonical base64 and the PDF signature; canonical ticket generation remains responsible for valid PDF contents. Filenames are bounded ASCII `.pdf` names without path traversal. Headers reject control characters and line separators. Addresses accept a single bare recipient and a bare or simple named sender. Remote attachment paths, HTML, extra recipients, arbitrary headers and unknown request fields are rejected. [Send email API](https://resend.com/docs/api-reference/emails/send-email)

POST and GET use only `https://api.resend.com/emails`, with the validated provider ID appended for lookup. Requests set `redirect: 'error'` and a ten-second deadline spanning the response body. The timeout aborts transport and cancels an active body reader. Successful send responses and conflict responses are bounded to 4 KiB; lookup responses are bounded to 256 KiB. Missing or unusable credentials return an unavailable error before network I/O. The adapter contains no retry loop and does not read retry headers or expose provider headers, response bodies, messages or secrets.

`EmailTransportError` contains an application-owned `code`, a `disposition`, and an optional numeric `httpStatus`. Its message is fixed from the code; it has no provider error as a cause. These are the retry decisions:

| Outcome                                                                                              | Disposition     |
| ---------------------------------------------------------------------------------------------------- | --------------- |
| No usable configured credential                                                                      | `unavailable`   |
| Network failure, timeout, HTTP 5xx/408, malformed successful response                                | `uncertain`     |
| HTTP 429                                                                                             | `retryable`     |
| HTTP 409 `concurrent_idempotent_requests`                                                            | `retryable`     |
| HTTP 409 `invalid_idempotent_request`, expired send window, unsafe clock, or lookup binding mismatch | `review_needed` |
| Invalid local request/provider ID, authentication failure or other definite HTTP 4xx                 | `permanent`     |

The two 409 machine names are the only provider error fields used. Other provider error content is discarded. “Retryable” and “uncertain” describe a result for the durable coordinator; each subsequent send still requires the exact original key/payload and must pass the time guard. [Resend error reference](https://resend.com/docs/api-reference/errors)

## Executed checks

- `vp test run apps/api/src/delivery/email.test.ts`: 73 tests pass, including parameterized input/status cases.
- `vp check apps/api/src/delivery/email.ts apps/api/src/delivery/email.test.ts`: formatting, lint and type checks pass.
- `vp exec tsc -p apps/api/tsconfig.json --noEmit`: API TypeScript passes.

The tests cover deep freezing, header injection, one-recipient enforcement, base64/PDF/size limits, exact request/key construction, missing credentials, the 23-hour boundary and backwards clocks. They exercise ambiguous network and malformed-success outcomes, rate limits, both documented idempotency conflicts, definite refusals, and the absence of automatic resend/key rotation. Fake-clock tests prove the ten-second deadline for a nonresponsive transport and a stalled body, including body cancellation. Lookup tests cover every documented status, ID/address mismatch, invalid IDs, no resend after 404, and safe reconciliation after the send window. Returned values and errors contain no provider body, message or secret.

Provider-account/domain setup, actual external email receipt, durable attempt claims, payload persistence, delivery fanout, retry scheduling and local `development_mail` integration belong to the delivery coordinator unit. No evidence here claims those steps are complete.
