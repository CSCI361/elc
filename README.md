# elc

Academic event ticketing for Kazakhstan. The local application includes web
account flows and an event, checkout, ticket-issuance and online-admission API.
The academic release is still in progress.
The [architecture decisions](docs/architecture-decisions.md) define the release;
the [implementation plan](docs/implementation-plan.md) tracks acceptance evidence.

## Local development

Install [Vite+](https://viteplus.dev/guide/) and use Node 24. The workspace uses
pnpm through `vp`; use package scripts through `vp run`.

```sh
vp install
vp run setup:local
vp run db:migrate
vp run dev
```

The React app and Hono API share `http://localhost:5173`. Vite's Cloudflare
plugin runs the API in workerd, with local D1/R2/Queue/Durable Object bindings.
Data persists under the ignored `.wrangler/state` directory. The setup command
creates private authentication and ticket-encryption keys in
`apps/api/.dev.vars` and preserves existing
configuration. Run migrations before authentication requests.

The web interface provides registration, verification, sign-in, password reset,
account settings and session revocation in Kazakh, Russian and English. Browser
checks cover these flows, saved language preferences, narrow layouts and
accessibility; see [web authentication evidence](docs/evidence/web-authentication.md).
Local auth emails are saved to the private D1 `development_mail` table. There is
no public mailbox endpoint. External Resend delivery and Google OAuth still
require configuration and acceptance.

Event discovery and management, ticket types, the predefined assigned-seat hall,
campaign management and inventory are available through `/api/events`; see
[event API evidence](docs/evidence/events.md). Checkout atomically reserves
inventory and promo allocations, preserves its ten-minute deadline across basket
edits, and snapshots prices and refund rules. Zero-total completion issues
canonical ticket credentials. Online scanning requires an explicit event grant
and supports idempotent retries, duplicate rejection and authorized reversal.
These ticketing workflows currently have API coverage; their attendee and
organizer web screens remain unfinished.

## Checks

```sh
vp check
vp test
vp run build
```

`vp check` runs formatting, lint and type-aware checks. Tests include shared
policy rules, authentication, event mutations, checkout races, ticket issuance
and admission against a real local D1 runtime. Build checks
TypeScript and produces web and Worker artifacts. Generated output and local
credentials are ignored by Git. Run `vp env doctor` for toolchain problems.

With `vp run dev` running, verify the actual Worker HTTP routes:

```sh
vp run verify:local-auth
vp run verify:local-ticketing
```

These commands use disposable local accounts and clean up their fixtures. The
ticketing check verifies email and session authentication, creates and publishes
a free event, reserves and issues a ticket, retrieves its credential, and proves
scan/retry/reversal behavior. It uses private Wrangler access for verification
mail and explicit scanner grants; it does not fake authentication. See
[checkout and Worker HTTP evidence](docs/evidence/checkout.md).

The build also runs Astro diagnostics and produces the static marketing site.
Run `vp run dev:marketing` to open it at `http://127.0.0.1:4321`; see its
[README](apps/marketing/README.md) for application links and deployment setup.

## Workspace

| Directory         | Responsibility                                                                     |
| ----------------- | ---------------------------------------------------------------------------------- |
| `apps/web`        | React account flows, Tailwind, Base UI/shadcn, Phosphor, Roboto and React Compiler |
| `apps/api`        | Hono, Better Auth, Drizzle/D1, event/checkout/ticket services and Worker handlers  |
| `apps/marketing`  | Static Astro marketing with separate deployment                                    |
| `apps/mobile`     | Planned Expo Event Admin application; acceptance is pending                        |
| `packages/shared` | Zod contracts, domain policies and integer money calculations                      |

## Schema and deployment

Generate auth tables with `vp run auth:generate`. Change the Drizzle schema in
`apps/api/src/db`, then run `vp run db:generate`. Review generated SQL and apply
it using `vp run db:migrate`. Custom SQL constraints are also committed migrations.
Wrangler tracks applied migrations; generated schema metadata stays in Git.

The checked-in API Wrangler file targets local development with a placeholder
D1 identifier. Preview/demo provisioning and deployment acceptance remain
pending. Keep local credentials and resource names separate from remote
environments.

Paid checkout, activation, refunds, compensation and simulated payouts are not
complete. Polar sandbox access and a KZT product are established, but checkout,
refund and webhook acceptance remain pending; see
[provider readiness](docs/evidence/provider-readiness.md). Ticket PDFs, external
delivery, mobile/offline admission, support, reporting, calendar exports and the
remaining product web workflows also need implementation and acceptance. Local
tests do not establish deployed performance or physical-device behavior.
