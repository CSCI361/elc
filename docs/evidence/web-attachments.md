# Web support attachments

Verified on 13 September 2026 against the local Worker at
`http://localhost:5173`, with migrations 0017 and 0018 applied. The run used
headless Chromium through a dedicated agent-browser session and the bundled
Playwright runtime. Two disposable verified accounts and one synthetic
organizer-to-platform case supplied the fixtures.

## Implemented behavior

An existing case's reply composer accepts JPEG, PNG and PDF files. It displays
the 5 MiB per-file and three-file per-message limits in Kazakh, Russian and
English. Each selected file has its own upload state, server validation error,
retry and removal controls. The server checks the file; rejected files must be
removed before sending. Initial case creation remains text-only.

Each upload keeps a stable request ID for retries of the same file. Ready upload
references remain in the current account/case composer through background
refresh, transient network failures, and case resolution followed by reopening.
The composer blocks submission while a file upload or removal is unresolved.
It sends ready references only with a new, nonempty message. It clears the draft
and files only after a confirmed successful message response.

An uncertain message response preserves the exact request ID, revision, text
and attachment references. Editing is disabled until that message is retried.
A definite revision conflict preserves the draft and files, allowing a new
request after the case revision refreshes. Switching account or case creates a
separate composer. Drafts and file bytes are held in memory, not browser storage;
leaving the composer ends that local draft. Unlinked server uploads follow the
backend expiry and cleanup policy.

The timeline displays files only from committed message metadata. Downloads use
the authenticated same-origin API and create a temporary browser download after
the response succeeds. Access denial removes the private case and composer.
There are no public file URLs or previews of uncommitted uploads.

## Browser acceptance

- An invalid PDF returned its authoritative type-mismatch error. Removing it
  restored the composer. A file of 5 MiB plus one byte returned a per-file size
  error and could also be removed.
- The browser lost a successful PNG upload response. Retrying used the same
  request ID, and D1 contained one canonical upload for that file.
- JPEG, PNG and a static PDF all validated. A fourth selected file was not
  uploaded. All three ready records remained unlinked before message submission;
  an authenticated request to download an unlinked file returned 404.
- A failed history refresh and a successful background case refresh retained
  the message draft and all three uploaded references. Resolving and reopening
  the case disabled and restored the same composer without discarding either.
- The server committed a message, but its HTTP response was lost. After live
  refresh changed the displayed case revision, the browser retried the exact
  original request. D1 contained one message linking all three files. The
  confirmed response cleared the composer.
- An authorized browser download returned the validated PNG bytes and expected
  filename. An unauthenticated download returned 401.
- Removing a synthetic staff account's platform support permission, then
  attempting its displayed download, removed the case history, unsent draft,
  and file controls from that browser.
- Kazakh, Russian and English pages fitted a 390 px viewport without horizontal
  overflow. Visual inspection confirmed translated file controls, readable
  filenames and file sizes. Both browser page-error logs remained empty.

## Checks and cleanup

Nine focused tests cover upload/message races, exact uncertain retries, revision
conflict recovery, failed removal recovery, rejected-file gating, the three-file
limit, discarded composers, HTTP 422 upload responses and translated server
error codes. These and the seven existing support policy/live tests pass.
The web TypeScript check and scoped `vp check` pass.

The exact synthetic accounts, case, changes, messages, attachment metadata,
receipts, audit records, outbox jobs, local mail and associated R2 objects were
removed. The private fixture credential file was deleted and the owned browser
session was closed. The shared development server remained running. This run
used local services and made no external payment or email delivery claim.
