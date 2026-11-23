# Release TODO

Live preview: https://elc-preview.ertaev-19102007.workers.dev (deploys on every push to `main` after CI passes).
Ask Dauren for the demo logins. Anything that creates Cloudflare resources or secrets needs the Cloudflare account owner.

- [ ] **Real phone test (iPhone and Android).** Install the scanner app from `apps/mobile` (see its README). Sign in as a staff account, open an event, save the guest list, scan a ticket. Turn internet off, scan two more, turn it back on and check they sync. Done when: all three scans show in the web app under the event's Check-ins.
- [ ] **Google Analytics.** Follow `docs/ga4-setup.md`: create the property, set the web and marketing measurement IDs and the API secrets, rebuild. Done when: after accepting cookies, events show in GA4 DebugView, and nothing is sent before consent.
- [ ] **Backups.** Follow `docs/backup-recovery.md`: private R2 bucket with the 30-day rule, the `academic-backups` GitHub environment, then set `ELC_BACKUPS_ENABLED=true`. Do one restore rehearsal into a scratch database. Done when: a scheduled export succeeds and the rehearsal result is written in `docs/evidence/backup-recovery.md`.
- [x] **Paid tickets and refunds (Polar sandbox).** The live preview has no Polar keys, so all sales there are free. Add the keys from `apps/api/.dev.vars.example` (see `docs/polar-preview-setup.md`), buy a paid ticket, then cancel the event. Done when: the buyer gets a refund in Polar and the order shows refunded. Verified on 2026-11-23; see [preview cancellation evidence](docs/evidence/polar-event-cancellation-preview.md).
- [x] **Calendar export.** From a ticket page, add the event to Google Calendar and Apple Calendar. Done when: the title, place and time (Asia/Almaty) are right in both. Verified on 2026-11-23; see [calendar client evidence](docs/evidence/calendar-clients.md).
- [ ] **Marketing site.** Deploy `apps/marketing` with `pnpm --filter @elc/marketing deploy:preview`. Done when: it loads on its own URL and its links open the web app.
- [ ] **Load test and demo recording.** Run a short load test on event list, checkout and scan, and note the results. Record the final demo video.
- [ ] **Evidence docs.** Update `docs/implementation-plan.md` acceptance and `docs/evidence/` with what was verified above.
- [x] **Small accessibility fixes (web).** After "Clear search" on the organizer overview, move keyboard focus to the results. Give the full-page empty states (event list, My tickets, Support) a real heading tag.
