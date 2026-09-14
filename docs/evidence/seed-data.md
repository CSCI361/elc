# Local seed data evidence

Added on 2026-09-14 so a fresh clone has demonstration data after setup.

```sh
vp run setup:local
vp run db:migrate
vp run dev
vp run seed:local
```

`vp run seed:local` runs `scripts/seed-local.mjs` against the running local
Worker. It refuses any origin other than `http://localhost` or
`http://127.0.0.1`, and stops unless `/api/health` reports the local
environment.

## What it creates

- Four verified accounts: `demo-organizer`, `demo-attendee`, `demo-scanner` and
  `demo-moderator`, all at `example.test`. Accounts are created through the real
  sign-up, local verification mail and sign-in routes.
- Two published, public, free general-admission events owned by the organizer,
  one and two weeks ahead, each with one free ticket type.
- `platform:moderate`, `platform:support` and `platform:configure` for the
  moderator, and `ticket:scan` and `checkin:reverse` on both events for the
  scanner.

Paid events are not seeded because paid sales require activation through the
Polar sandbox or its documented simulation.

## Credentials and idempotency

Passwords are generated randomly and stored only in
`.wrangler/seed-accounts.json`, which Git ignores and the script writes with mode 600. Output lists emails and event links, never passwords. A second run signs in
with the saved credentials and reuses existing accounts and events; grants use
`INSERT OR IGNORE`. If a demo account exists without saved credentials, the
script stops and explains how to recover instead of resetting anything.

## Verification

- `vp run test:seed` runs `scripts/seed-plan.test.mjs`; all 6 tests pass. They
  cover distinct role accounts, the absence of credentials in the plan, upcoming
  events with valid windows and capacity, stable unique request IDs, the grants
  and the local-origin guard.
- Against a fresh local database, the first run created four accounts and two
  events. The second run reported every account and event as existing. D1 then
  held 4 demo users, 2 demo events, 3 moderator platform grants and 4 scanner
  event grants, and the credentials file had mode 600.
