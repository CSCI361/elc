# Delivery inspection and recovery

Verified locally on 2026-09-13 against the running web app and Worker, with real
Better Auth sessions and D1 records. The environment reported `local`; no
external email was sent. Synthetic accounts, deliveries, grants, audit entries,
request receipts and development mail were removed after acceptance.

The `/admin/deliveries` list and detail routes require current
`platform:recover` permission. The navigation reads only the signed-in account's
current platform permissions. Inspection returns separate PDF and email states,
attempt counts, safe diagnostic codes and provider receipt identifiers. It does
not return addresses, message bodies, attachment content or private object keys.
Dates use Asia/Almaty regardless of the browser's time zone.

The browser checks passed these cases:

- Twenty-two matching deliveries page as 20 and 2 distinct records. Changing
  pages moves keyboard focus to the results heading.
- A recovery committed before its response was lost survives a page reload.
  Retrying uses the same request ID, reason and observed revision. D1 contains
  one recovery audit entry and one request receipt.
- A stale initial request changes no delivery and creates no audit entry. The
  screen refreshes before the operator can submit another action.
- An initial request lost before reaching the server remains available for an
  exact retry. A later authenticated conflict settles that rejected request,
  allowing a new action after the operator reviews the changed delivery.
- Delivered mail and an unknown provider outcome older than 23 hours offer no
  resend action. Preparation, same-request retry and provider lookup have
  distinct explanations.
- Kazakh, Russian and English lists fit a 390 px viewport. The wide data table
  scrolls with the keyboard without widening the page.
- Revoking recovery permission removes open private details, form controls and
  navigation on refresh. Ordinary and signed-out accounts cannot inspect the
  records. No browser page errors occurred.

Pending request storage is versioned, validated and scoped to the account and
delivery. Network failures, server errors and access loss preserve uncertainty.
An authenticated state conflict can be treated as a rejection because the API
checks the immutable exact-request receipt before returning it. Four policy
tests cover these distinctions, route bounds and corrupt stored requests.

The React review covered account remounts, cancelled reads, stale response
handling, accessible form names, keyboard tables and lazy loading. Migration
0023 adds cursor indexes for the four exposed filters. Backend authorization,
atomic recovery and provider constraints have separate evidence in
[delivery recovery](./delivery-recovery.md). Actual Resend delivery and deployed
queue/dead-letter behavior remain pending.
