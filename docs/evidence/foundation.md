# Foundation validation

Recorded: 2026-09-13

## What is implemented

The workspace separates React web, Hono API, Astro marketing and shared Zod
contracts. Expo application implementation is pending. The web starter now
builds together with the Worker through the Cloudflare Vite plugin. Authentication
uses the Better Auth-generated Drizzle schema and local D1 migrations.

The database includes initial account/access, event, inventory, order, payment,
ticket, admission, audit and outbox tables. Their presence does not establish
that product services or the ticketing flow are implemented. Support, offline,
activation and reporting services still need their complete data models and APIs.

## Executed evidence

| Check                                                | Observed result                                                    | Scope                                                                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vp install`                                         | Pass after explicit esbuild/workerd build-script configuration     | Workspace dependency installation                                                                                                                             |
| `vp env doctor`                                      | All checks pass; Node 24.21.0 and pnpm 12.4.1                      | Local tooling                                                                                                                                                 |
| `vp run typecheck` and web build                     | Pass                                                               | TypeScript plus React/Worker compilation                                                                                                                      |
| `vp test packages/shared/src`                        | 25 tests pass                                                      | Money allocation, policies and boundary schemas                                                                                                               |
| `vp test apps/api/src/auth`                          | 15 tests pass                                                      | Better Auth, email transport and scoped access against local D1                                                                                               |
| `vp test apps/api/src/db/schema.integration.test.ts` | 7 tests pass                                                       | Database scope, inventory ownership, reservation uniqueness and D1 batch guard mechanism                                                                      |
| `vp run verify:local-auth` with `vp dev` running     | Pass                                                               | HTTP requests through the application Worker to D1: register, deny unverified sign-in, verify, authenticate, `/api/me`, sign out and deny the revoked session |
| Browser at `http://localhost:5173`                   | Starter renders, button present, no page errors                    | React/Worker development integration only                                                                                                                     |
| Browser-origin `/api/health`                         | 200, database ready                                                | Worker-to-D1 connectivity                                                                                                                                     |
| Browser-origin `/api/me` without session             | 401 with safe JSON error                                           | Authenticated API boundary                                                                                                                                    |
| Browser-origin `/api/missing`                        | 404, application/json                                              | API routing takes precedence over SPA fallback                                                                                                                |
| `wrangler whoami`                                    | Existing OAuth session accepted with Workers/D1/Queues permissions | Access check only; no deployment acceptance                                                                                                                   |

The local HTTP verification script reads its verification link through the
private development mailbox using Wrangler. It does not print links, passwords
or cookies, and removes its account/mail fixtures after the run.

The complete foundation suite has 49 tests, including two API-boundary tests
for the shared error shape and rejection of a foreign browser origin before
authentication writes. The root build now includes Astro diagnostics and all
four static marketing routes, alongside the React/Worker build.

Marketing browser verification at `http://127.0.0.1:4321` covered Kazakh,
Russian and English, correct locale-specific application links, no horizontal
overflow at 390 px, keyboard access to the skip link, and no page errors. The
Kazakh page made no resource requests to other origins. Desktop and mobile
screenshots were inspected. Deployment, full accessibility acceptance and GA4
integration remain pending.

## Findings incorporated

- Split the button's variants into a separate module to fix the original
  component-export lint failure.
- Pin Worker compatibility to 2026-09-11. The installed runtime rejects
  2026-09-13 as a future date in this execution environment.
- Explicitly keep Better Auth origin/CSRF checks enabled in tests as well as the
  application. Its test-mode defaults otherwise bypass part of that boundary.
- Use D1-backed authentication rate limiting and respect D1's 100-bound-parameter
  limit when constructing statements.
- Add database triggers for event/account relationships that ordinary
  single-column foreign keys cannot enforce. Protect active ticket inventory
  ownership while allowing invalidated historical tickets to coexist with resale.
- A failed conditional update can affect zero rows without aborting a D1 batch.
  A CHECK-constrained transition guard forces an SQL failure, and the tests prove
  that the preceding audit write rolls back with it.

## Still unproven

The generic D1 allocation race is a proof of the guard mechanism, not the complete
checkout, promo, payment, refund or scan transition. Those need tests against the
actual services once implemented. Deployed load, Polar transactions, real Google
OAuth completion, Resend delivery, native secure storage, physical-device
scanning, calendar-client acceptance and recovery remain pending.

The web page still contains the starter UI. This browser check does not count as
attendee/organizer workflow or accessibility acceptance. The CI configuration
has been authored; remote CI execution has not been observed.
