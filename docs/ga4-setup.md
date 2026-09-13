# GA4 demonstration setup

Use a dedicated `elc-demo` property with time zone `Asia/Almaty` and currency
`KZT`. Create separate web and marketing streams. Keep both build-time stream IDs
blank until the property settings below are reviewed.

Configure the property and both streams before enabling collection:

- Register event-scoped `event_reporting_id` and `campaign_reporting_id` custom
  dimensions. Do not register customer, order or admission identifiers.
- Disable enhanced measurement, Google Signals, advertising personalization and
  User-ID. The application explicitly instruments the approved public events;
  automatic form, outbound-link and search collection must remain disabled.
- Set event/user data retention to two months and disable activity-based resets.
  This does not determine standard aggregate-report retention.
- Grant a dedicated service account read access to this property. Keep its JSON
  credential on the API server and use only the reporting scope.

Set `GA4_PROPERTY_ID` and secret `GA4_SERVICE_ACCOUNT_JSON` in the API deployment.
For local use, the ignored `apps/api/.dev.vars` file holds these values. Never
place the service-account credential in a public environment variable, browser
bundle, source file or chat message.

Set `VITE_GA4_MEASUREMENT_ID` for the React web build and
`PUBLIC_GA4_MEASUREMENT_ID` for the Astro marketing build. These are the two
streams' public `G-...` identifiers. Rebuild each application after changing its
ID. Consent defaults to off on each origin, even when these values are present.
Leaving an ID blank keeps that application's transport disabled.

Verify both origins with a fresh browser profile. Before consent, there must be
no request to Google and no application analytics cookie. After consent, inspect
actual outgoing requests for the approved event names and reporting IDs, fixed
page labels and sanitized URLs/referrers. Test a campaign link containing a
redeemable code and a checkout containing an attendee name; neither may appear
in a Google request. Visit protected pages and private/unlisted events, then
withdraw consent in another tab. Verify requests stop and the application's
analytics cookies are removed.

Confirm the received events in the dedicated property and then request an
organizer report. Check current organizer permissions, campaign filtering,
Asia/Almaty boundaries, one-hour caching and the last-successful-fetch label.
Reports can be delayed by Google processing. Compare GA4 aggregates with exact
elc orders without presenting a person-level conversion rate. A missing or
unavailable GA4 report must leave basic analytics and checkout usable.

Record actual property, stream and service-account verification in the provider
acceptance evidence. The repository's current tests use injected responses;
live acceptance remains pending. Delete the demonstration property when retiring
the academic environment.

References: [Google consent setup](https://developers.google.com/tag-platform/security/guides/consent),
[privacy controls](https://developers.google.com/tag-platform/security/guides/privacy),
[configuration fields](https://developers.google.com/analytics/devguides/collection/ga4/reference/config),
[retention settings](https://support.google.com/analytics/answer/7667196).
