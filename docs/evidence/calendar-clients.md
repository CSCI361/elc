# Calendar client acceptance

Verified on 2026-11-23 against the live preview in Google Chrome, Google Calendar
web and Apple Calendar on macOS. No application code changes were required.

Signed in as the demo attendee and opened the existing ticket confirmation at
`/orders/04e6e604-9b26-437a-877c-9cc949be5ade`. The page says “Your ticket is ready”
and provides the calendar download and Google Calendar link. The individual
admission-ticket page links back to this order; its own controls contain the PDF
download and admission QR, rather than calendar actions.

Used both calendar actions from the ticket order and saved the following event:

| Field    | Expected and observed in both clients             |
| -------- | ------------------------------------------------- |
| Title    | NU Hackathon 2026                                 |
| Location | Block C3 atrium, Kabanbay Batyr Avenue 53, Astana |
| Start    | 2026-11-26 09:00 Asia/Almaty                      |
| End      | 2026-11-27 15:00 Asia/Almaty                      |

The Google creation form showed `(GMT+05:00) Kazakhstan - Almaty`, 09:00 on
26 November and 15:00 on 27 November. After saving, its calendar entry and event
popover retained the title, full location and both dates/times. The description
also retained `Asia/Almaty` and the preview event URL. The multi-day event appears
across two calendar columns but is one event.

Downloaded `elc-event-en (2).ics` through the ticket confirmation page and opened
it in Apple Calendar. Selected the existing “Домашний” destination calendar and
confirmed the import. Apple Calendar then displayed the saved event with the
exact title, full location, 26 November 09:00 start and 27 November 15:00 end.
These match the source event's Asia/Almaty times and the Google export's UTC
instants (04:00Z and 10:00Z respectively).

An earlier public-event smoke check also saved Almaty Developer Meetup in both
clients: SmArt.Point coworking, Abylai Khan Avenue 141, Almaty, on 2026-11-29,
18:00–21:00 Asia/Almaty. Those entries remain. A free demo ticket was issued for
that event under order `b92934ce-d056-43c1-af00-5b9a5550eb65` while checking the
ticket navigation. No paid purchase was made. Automatic approval review rejected
removing the preliminary Google entry; no deletion was performed or retried.

This completes the release TODO's initial Google/Apple calendar export check.
It does not establish update/cancellation replacement, Outlook import, Apple
Calendar on iOS, or automatic synchronization. Those broader acceptance items
remain open. No credentials or admission codes are recorded here.
