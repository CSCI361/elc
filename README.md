# elc

Academic event ticketing for Kazakhstan. The implementation is in progress.
The [architecture decisions](docs/architecture-decisions.md) define the release;
the [implementation plan](docs/implementation-plan.md) tracks acceptance evidence.

## Local development

Install [Vite+](https://viteplus.dev/guide/) and use Node 24. The workspace uses
pnpm through `vp`; use package scripts through `vp run`.

```sh
vp install
vp run setup:local
vp run db:migrate
vp dev
```

The React app and Hono API share `http://localhost:5173`. Vite's Cloudflare
plugin runs the API in workerd, with local D1/R2/Queue/Durable Object bindings.
Data persists under the ignored `.wrangler/state` directory. The setup command
creates a random private `apps/api/.dev.vars` secret and preserves existing
configuration. Run migrations before authentication requests.

The current web interface remains the starter. API authentication is available
under `/api/auth/*`; `/api/me` requires a verified, active account. Local auth
emails are saved to the private D1 `development_mail` table. There is no public
mailbox endpoint. External email delivery and Google OAuth require configuration
described in [authentication evidence](docs/evidence/authentication.md).

## Checks

```sh
vp check
vp test
vp run build
```

`vp check` runs formatting, lint and type-aware checks. Tests include shared
policy cases and authentication against a real local D1 runtime. Build checks
TypeScript and produces web and Worker artifacts. Generated output and local
credentials are ignored by Git. Run `vp env doctor` for toolchain problems.

The build also runs Astro diagnostics and produces the static marketing site.
Run `vp run dev:marketing` to open it at `http://127.0.0.1:4321`; see its
[README](apps/marketing/README.md) for application links and deployment setup.

## Workspace

| Directory         | Responsibility                                                       |
| ----------------- | -------------------------------------------------------------------- |
| `apps/web`        | React, Tailwind, Base UI/shadcn, Phosphor, Roboto and React Compiler |
| `apps/api`        | Hono, Better Auth, Drizzle/D1, migrations and Worker handlers        |
| `apps/marketing`  | Static Astro marketing with separate deployment                      |
| `apps/mobile`     | Planned Expo Event Admin application; acceptance is pending          |
| `packages/shared` | Zod contracts, domain policies and integer money calculations        |

## Schema and deployment

Generate auth tables with `vp run auth:generate`. Change the Drizzle schema in
`apps/api/src/db`, then run `vp run db:generate`. Review generated SQL and apply
it using `vp run db:migrate`. Custom SQL constraints are also committed migrations.
Wrangler tracks applied migrations; generated schema metadata stays in Git.

The checked-in API Wrangler file targets local development with a placeholder
D1 identifier. It is not a deployed environment. Preview/demo resource
provisioning and acceptance remain pending. Never deploy local credentials or
reuse local resource names for a demonstration. Payments and verification are
academic simulations or sandbox integrations; no real financial processing is
implemented or authorized by the demo.
