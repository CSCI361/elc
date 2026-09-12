# Cloudflare preview deployment plan

Reviewed on 2026-09-13. This plan records read-only account and repository checks. No remote resources were created or changed.

## Account findings

- Wrangler authentication succeeds with Workers, D1 and Queues grants.
- The only listed remote D1 database is the unrelated `bahandi-db`. Its contents were not queried. Never use it for elc migrations or fixtures.
- Queue listing succeeds and returns no queues. The named Worker `elc-preview` does not exist.
- R2 listing fails with API error 10042, requiring account enablement through the Cloudflare dashboard. [R2 setup](https://developers.cloudflare.com/r2/get-started/) includes a subscription checkout, so this needs browser access and an account billing decision before resource creation.
- The current Workers plan and account `workers.dev` subdomain have not been verified. Do not assume paid-plan recovery, retention or CPU limits.
- The local tunnel could not establish outbound connectivity over UDP or TCP port 7844. Signed webhook delivery therefore needs a deployed endpoint.

## Isolated resources

| Resource                        | Proposed name              | Binding or purpose                                         |
| ------------------------------- | -------------------------- | ---------------------------------------------------------- |
| Worker                          | `elc-preview`              | React assets and API on one HTTPS origin                   |
| D1                              | `elc-preview`              | `DB`; a new database UUID                                  |
| Private R2 bucket               | `elc-preview-files`        | `FILES`; protected ticket PDFs and later uploads           |
| Private R2 bucket               | `elc-preview-backups`      | `BACKUPS`; protected SQL exports                           |
| Queue                           | `elc-preview-delivery`     | `DELIVERY` producer and consumer                           |
| Dead-letter queue               | `elc-preview-delivery-dlq` | Consumer failure retention                                 |
| SQLite Durable Object namespace | Created for this Worker    | `SUPPORT`, existing `SupportCase` class and `v1` migration |

Keep both buckets private, without an `r2.dev` endpoint or public custom domain. Preserve the existing queue batch size of five, one-second batch timeout and three retries; configure the dead-letter queue explicitly. Preserve the minute cron, whose current handler dispatches payment outbox work only.

Use a stable named deployment at `https://elc-preview.<account-subdomain>.workers.dev`, with `workers_dev: true` and `preview_urls: false`. Workers implementing Durable Objects do not receive version Preview URLs. A custom domain is unnecessary for this acceptance pass. Do not require interactive Cloudflare Access authentication on the provider webhook path. [Worker URLs](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/), [Preview URL limitations](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)

## Configuration and identities

Add `env.preview` to `apps/api/wrangler.jsonc`, repeating all environment-specific variables and bindings. Use `ENVIRONMENT=preview`, the actual HTTPS `APP_ORIGIN`, and the same `AUTH_URL` or omit that override. Preserve `nodejs_compat`, the API-first asset routing and the existing Durable Object migration.

Set fresh `AUTH_SECRET` and `TICKET_ENCRYPTION_KEY` values for preview. Keep the ticket encryption key stable once tickets exist. Configure the existing sandbox Polar token, product and organization. The local `POLAR_WEBHOOK_SECRET` is missing; the deployed endpoint needs the actual signing secret issued for its provider webhook registration. Never place these values in frontend `VITE_*` variables, source control or command output.

Resend and Google credentials are absent. Leave those capabilities unavailable. Preview mode intentionally does not inject the private development mailbox. New signup, verification delivery and password reset remain unavailable without email transport, while existing verified password accounts can sign in normally over HTTPS.

For acceptance, migrate only selected synthetic `user` and password `account` rows through a private, narrowly scoped fixture. Do not copy sessions, verification tokens, development mail, old orders, tickets, payment attempts, provider events or outbox rows. Sign in again through the deployed authentication route. This proves remote sign-in using imported test identities, not remote email verification or Google sign-in.

Create fresh preview events, activation attempts and orders. Existing sandbox transactions contain `elc_environment=local`; the adapter correctly rejects them in preview. Their financial records and frozen return URLs must not be relabelled or reused. The sandbox organization and product configuration can be reused.

## Execution order

1. Confirm the account plan and `workers.dev` subdomain; complete the R2 enrollment decision.
2. Create the isolated resources above. Record their returned identifiers without altering unrelated resources.
3. Add the preview configuration and secret bindings. Apply reviewed D1 migrations explicitly to the new preview database.
4. Import the selected test identities, excluding private mail and existing sessions.
5. Build with `CLOUDFLARE_ENV=preview vp -C apps/web build`.
6. Inspect the generated Worker configuration for preview resource names, the new D1 UUID and HTTPS origin, then deploy that explicit generated configuration.
7. Register `/api/webhooks/polar` with the adapter's API version and supported event types; install its actual signing secret.
8. Verify HTTPS sign-in, unavailable email/Google capabilities, private export authorization and fresh sandbox checkout. Record signed webhook delivery, durable acknowledgment, queue consumption, duplicate handling, canonical issuance and delayed-success full refund behavior.

The current Vite Worker output directory is `apps/web/dist/elc_local`, derived from the top-level Worker name. Its existing configuration contains local bindings and must not be deployed. Cloudflare environment selection happens at build time; setting the environment only at deployment does not transform an existing artifact. [Vite environment selection](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/)

## Operations that remain unproved

The `BACKUPS` binding does not create backups. Daily SQL exports, general retention cleanup and a restore rehearsal still need implementation. Expire protected backup SQL objects after 30 days. Do not apply a blanket creation-age lifecycle to the files bucket: the architecture's 180-day retention rule depends on event, support and financial state.

D1 Time Travel provides seven days on Free and thirty days on Paid; record the actual plan. Workers Logs retain three days on Free or seven days on Paid, so platform logs alone do not meet the architecture's thirty-day application-log policy. Disable invocation logs containing request URLs to avoid retaining authentication query tokens, and use sanitized application logs. [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)

Measure authentication and PDF CPU use on the deployed plan. Free HTTP requests have a 10 ms CPU limit; local success does not prove remote performance. The existing uncompressed Worker JavaScript is about 3.28 MB plus the bundled font, which is not itself a measurement of upload or startup acceptance. [Worker limits](https://developers.cloudflare.com/workers/platform/limits/)

If R2 enrollment is deferred, a separate signature-validating, ingest-only receiver with isolated D1 could prove real signed delivery for the existing local sandbox attempts. It must allow only the expected local payment bindings, store normalized events privately and expose no mailbox or public event-read API. That narrower result would not prove application deployment, private PDF storage or queue processing. No such receiver or webhook endpoint has been created.
