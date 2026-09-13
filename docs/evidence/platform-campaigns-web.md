# Platform promotional campaign review

The platform administration navigation now includes `/admin/campaigns`, a read-only catalog for the promotional-code activity requirement in SRS §4.12. It requires the existing current `platform:moderate` access check. Organizer permissions and `platform:configure` alone do not enable the section.

The catalog calls `GET /api/admin/campaigns` with the dedicated shared platform campaign contract. Cards display the campaign name and ID, event title and ID, organizer ID, enabled state, discount, validity window, redemption limit, active temporary holds, committed redemptions, update time and event retention deadline/hold reasons. Percentage discounts use their stored basis points; fixed discounts use KZT minor units. Times are labelled as Asia/Almaty and the page displays the server snapshot time.

The explanation distinguishes temporary holds from completed-order redemptions and states that completed redemptions remain consumed after refunds or registration cancellations. Enabled status is not presented as a guarantee that a checkout is currently eligible. The UI exposes no campaign code, token hash, redeemable campaign URL, organizer edit control or campaign mutation. It uses no GA4 collection.

## Filters, authority and drilldowns

The catalog accepts a literal name/ID query, exact event and organizer IDs, and an all/enabled/disabled filter. It uses first/next navigation with opaque server cursors and 20 records per page. New searches clear the previous cursor. URL initialization rejects duplicate keys, unknown keys, invalid values and excessive lengths before loading catalog records. Valid page-size inputs are normalized to the web page size of 20.

Catalog reads poll every 15 seconds while visible and refresh on focus. Failed reads hide previous cards, usage values and drilldown links. The administration wrapper also refreshes current platform access and removes the section if the permission disappears. Account changes remount the administration workspace. All authority and retention decisions remain server-enforced.

Each card links to the existing operational records page:

- Attributed orders use `kind=orders`, `campaignId` and `eventId`.
- Campaign lifecycle audit uses `kind=audit`, `q` equal to the campaign ID, and `eventId`.

Operational records now initialize their controls and applied query from validated URL filters. They accept `campaignId` only for order records. Changing to payments or audit clears the hidden campaign filter. A new submitted search clears the old page cursor. Invalid or ambiguous links show a reset action instead of silently loading a broader query.

The displayed operational page and its existing CSV export receive the same canonical query, including campaign, event, account, exact-ID and page filters. Changing that query remounts the export control, preserving its request-abort and object-URL cleanup behavior. Existing permission-denial handling continues to hide records and exports.

## Interface and verification

All new labels, filter states, usage explanations and links have Kazakh, Russian and English translations. Campaign cards use `data-campaign-id` for deterministic browser verification. They reuse the responsive administration record layout, labelled filter controls, semantic description lists and explicit pagination buttons. React review checked component identity, data fetching, hook use, permission/error branches and encoded links. No new persistence or mutation workflow was added.

All 25 focused policy tests passed in 213 ms. They cover encoded order/audit drilldowns, exact operational query serialization, order-only campaign filters, kind changes, invalid and duplicate URL parameters, bounded page sizes, cursor preservation/reset, filter normalization and KK/RU/EN label coverage. The scoped check passed formatting and reported no warnings, lint errors or type errors across 11 TypeScript files.

Commands:

```sh
vp test apps/web/src/administration/campaigns-policies.test.ts --maxWorkers=1
vp check apps/web/src/administration/campaigns* apps/web/src/administration/operations* apps/web/src/administration/messages.ts apps/web/src/administration/page.tsx apps/web/src/App.tsx docs/evidence/platform-campaigns-web.md
```

The integrating agent owns disposable local browser verification and canonical database assertions. Those results are recorded after that run; the checks above do not claim browser acceptance or provider activity.
