# elc

Academic event ticketing for Kazakhstan. The
[architecture decisions](docs/architecture-decisions.md) define the release; the
[implementation plan](docs/implementation-plan.md) tracks acceptance evidence.
Local implementation covers the committed workflows. External provider,
deployment and physical-device acceptance remain pending, so the academic
release is not yet complete.

## Local development

Install [Vite+](https://viteplus.dev/guide/) and use Node 24. The workspace uses
pnpm through `vp`; use package scripts through `vp run`.

```sh
vp install
vp run setup:local
vp run db:migrate
vp run dev
vp run seed:local
```

The React app and Hono API share `http://localhost:5173`. Vite's Cloudflare
plugin runs the API in workerd, with local D1/R2/Queue/Durable Object bindings.
Data persists under the ignored `.wrangler/state` directory. The setup command
creates private authentication, ticket-encryption and offline snapshot signing
keys in `apps/api/.dev.vars` and preserves existing configuration. Run
migrations before authentication requests. With the dev server running, `vp run seed:local` adds four verified demo accounts (organizer, attendee, scanner and moderator) and two free public events; see [seed data evidence](docs/evidence/seed-data.md). Generated passwords are saved only in the ignored `.wrangler/seed-accounts.json`.

Local auth emails are saved to the private D1 `development_mail` table. There is
no public mailbox endpoint. Google sign-in, Resend delivery, GA4 and Polar need
the optional credentials listed in `apps/api/.dev.vars.example`; without them
those capabilities stay unavailable and everything else runs locally.

## Implemented workflows

All interfaces support Kazakh, Russian and English. Each area links to its
evidence under [docs/evidence](docs/evidence).

- Accounts: registration, verification, sign-in, password reset, preferences,
  session revocation and organizer profiles.
- Events: discovery, private invitations, staff permissions, images, the
  predefined 80-seat hall, publication, cancellation and duplication.
- Orders: atomic general-admission and seat checkout, campaigns and promo codes,
  paid-sales activation, Polar sandbox payments, compensation, voluntary refunds
  and simulated payouts.
- Tickets: canonical admission credentials, protected A4 PDFs, calendar exports
  and online scanning with reversal.
- Operations: support cases with attachments and live updates, queued
  notifications, event and multi-event analytics, GA4 reporting with consent,
  retained history, platform administration with reported-event review, retention cleanup and backup
  recovery.
- Mobile: the Expo Event Admin app with online scanning and an encrypted offline
  journal, device management and admission review.
- Marketing: the static Astro site.

## Checks

```sh
vp check
vp test
vp run build
```

`vp check` runs formatting, lint and type-aware checks. `vp test` runs the full
suite against real local D1/workerd runtimes and takes about ten minutes. Build
checks TypeScript and produces the web, Worker and marketing artifacts.
Generated output and local credentials are ignored by Git. Run `vp env doctor`
for toolchain problems.

With `vp run dev` running, verify the actual Worker HTTP routes:

```sh
vp run verify:local-auth
vp run verify:local-ticketing
vp run verify:backup
```

These commands use disposable local accounts and clean up their fixtures. They
use private Wrangler access for verification mail and explicit grants; they do
not fake authentication.

Run `vp run dev:marketing` to open the marketing site at
`http://127.0.0.1:4321`; see its [README](apps/marketing/README.md) for
application links and deployment setup. The mobile app is documented in
[apps/mobile/README.md](apps/mobile/README.md).

## Workspace

| Directory         | Responsibility                                                               |
| ----------------- | ---------------------------------------------------------------------------- |
| `apps/web`        | React web application, Tailwind, Base UI/shadcn, Phosphor and React Compiler |
| `apps/api`        | Hono, Better Auth, Drizzle/D1, Worker handlers, queues and Durable Objects   |
| `apps/marketing`  | Static Astro marketing with separate deployment                              |
| `apps/mobile`     | Expo Event Admin application with online and offline scanning                |
| `packages/shared` | Zod contracts, domain policies and integer money calculations                |

## Schema and deployment

Generate auth tables with `vp run auth:generate`. Change the Drizzle schema in
`apps/api/src/db`, then run `vp run db:generate`. Review generated SQL and apply
it using `vp run db:migrate`. Custom SQL constraints are also committed migrations.
Wrangler tracks applied migrations; generated schema metadata stays in Git.

The checked-in API Wrangler file targets local development with a placeholder
D1 identifier. Never deploy the local build output; it contains local bindings.
Preview provisioning is described in the
[deployment preview plan](docs/deployment-preview-plan.md) and needs R2
enrollment on the Cloudflare account first.

## Pending external acceptance

Local tests do not establish deployed or physical-device behavior. These checks
remain open:

- Cloudflare preview deployment, deployed queues and Durable Objects, and the
  50-event/10,000-ticket mixed workload.
- Google OAuth, Resend delivery and GA4 collection with live credentials.
- D1 Time Travel recovery and scheduled backup exports.
- Physical iOS/Android scanning, grayscale printed tickets and two-device offline
  conflicts.
- Google Calendar, Outlook and Apple Calendar replacement procedures, recorded
  browser versions and screen-reader checks.
