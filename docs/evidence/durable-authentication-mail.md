# Durable authentication mail

Registration verification and password-reset callbacks now commit an email intent, delivery row and outbox entry in one guarded D1 batch. The application uses this path in local, preview and demo environments. An unavailable queue leaves the committed work for Cron. Outside local development, registration and recovery still report unavailable when email transport is not configured.

The intent contains the original localized message, account binding and token deadline. Better Auth's authenticated encryption protects it in D1 using a domain-separated server secret. Delivery metadata and queue messages contain no authentication links. Repeated callbacks for the same account, message and deadline resolve to one delivery ID. Database triggers forbid changing its deadline or replacing cleared ciphertext.

Before dispatch, the source verifies the signed verification token or the stored reset token, its account and current email address, suspension state and one-hour deadline. A verified account no longer receives verification mail. A consumed reset token, changed email, suspended account, expired link or unreadable encrypted intent suppresses dispatch. The delivery coordinator repeats these checks after preparing its private payload and immediately before sending.

Uncertain sends retain the exact frozen request and idempotency key. Authentication expiry stops retries even though the general email transport permits a longer retry window. An accepted provider ID is reconciled by lookup after expiry without sending again. Expiry cleanup clears the encrypted intent and completes unaccepted pending jobs, including when the provider remains unconfigured. Active leases prevent cleanup from taking over an in-flight job. The already-frozen private R2 payload follows the existing 30-day delivery-payload policy for reconciliation; its authentication link remains unusable after the one-hour deadline.

Local development writes the same durable delivery to the private `development_mail` table and never calls Resend. The fixture cleanup helper removes these deliveries, outbox records and R2 payloads before deleting test accounts. No authentication payload, token or cookie is returned by administration queries.

A successful Better Auth session creation records `account_activity.last_sign_in_at`. This survives session deletion and supports account retention. It does not create a profile or imply a saved language preference. Existing accounts receive a full retention period from migration rollout because their earlier sign-in history cannot be reconstructed.

## Verification

The eleven D1/R2 integration cases cover concurrent enqueueing during queue failure, immutable uncertain retries, expiry, missing provider configuration, consumed reset tokens, completed verification, suspension between preparation and send, accepted-ID reconciliation after expiry, forged or foreign links, key rotation and a real Better Auth registration/reset flow.

`vp run verify:local-auth` passes against the running local Worker and persistent D1. It verifies registration, private verification mail, cookie authentication, language preferences and sign-out, then removes its fixture and mail objects.

The browser acceptance run in `.wrangler/web-auth-durable-acceptance.mjs` passes in Kazakh, Russian and English at 390 pixels. Each case registers through the interface, checks the localized durable mail, follows verification and signs in. The English case also requests and completes a password reset through the interface, then signs in with the replacement password. There are no page errors or horizontal overflow. Screenshots and a redacted result summary are retained locally; all synthetic accounts, links and private mail objects were removed.

Resend delivery and Google OAuth still require external configuration and acceptance. Local mail and injected provider outcomes do not establish either result.
