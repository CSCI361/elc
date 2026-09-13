# Support attachments

Verified locally on 2026-09-13. This unit adds private support uploads, static content validation, atomic message references and authenticated downloads. It does not send email or create remote resources.

## API and message lifecycle

Create a case with text first. Files can then be uploaded to that existing case and included in a new reply. Message text remains required. The shared REST schemas live in `packages/shared/src/support-api.ts`; `createSupportUploadSchema` and `SupportMessageAttachment` avoid the names of earlier planning-only contracts.

| Method | Path under `/api`                                           | Behavior                                                                                   |
| ------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| POST   | `/support/cases/:caseId/attachments`                        | Multipart with exactly one `file` and one `requestId`. Returns an upload record.           |
| DELETE | `/support/cases/:caseId/attachments/:attachmentId`          | Uploader removes an unlinked upload. Repetition is safe.                                   |
| POST   | `/support/cases/:caseId/messages`                           | Existing text/revision/request fields plus optional unique `attachmentIds`, at most three. |
| GET    | `/support/cases/:caseId/attachments/:attachmentId/download` | Downloads a file from a committed message after current case authorization.                |

The upload response contains the ID, case ID, safe filename, status, validated MIME/size when available, error code and expiry. A valid upload returns `201`; content rejection returns `422` with its per-file error. Empty files or malformed forms return `400`, and oversized files return `413`. A retry uses the same request ID only for the same original bytes and normalized metadata. Reusing it with changed content returns `409`. A rejected upload needs a new upload request; it cannot be turned into a different file under the same ID.

Both the original and sanitized bytes use separate immutable keys in the private `FILES` R2 binding. The API creates the D1 quarantine record before writing bytes, then checks the original file, writes the sanitized object and atomically marks it ready. No upload state exposes a public or presigned URL. Quarantined, rejected and ready files cannot be downloaded through the message download endpoint.

A reply can link only ready, unexpired files uploaded by that author to that exact case. Linking runs inside the same D1 batch as the new message, case revision, sequential change, audit, notification/live jobs and request receipt. The link must precede the committed change record. SQL constraints and triggers reject a fourth file, duplicate positions, changed file identity/content, cross-case/author links, or appending files to an already committed message. Competing sends and cleanup cannot partially commit a message or delete a file that won the link transaction.

Messages and changes return ordered attachment metadata. Live and notification outbox payloads continue to contain only the canonical case/change/sequence identifiers. Clients read the committed file references through authorized REST catch-up.

## Access and download rules

The API requires authentication and current case access before reading upload bodies or looking up files. Upload release and message commit repeat the case check. The uploader must still be eligible and the case must be unresolved when a new file is released or linked. Organizer-to-platform files use the platform conversation ACL; event support staff cannot read them solely through an event grant or assignment.

Downloads repeat authorization after the R2 fetch and verify the stored size and SHA-256 before returning bytes. They use the validated MIME, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, a restrictive sandbox CSP and `Cache-Control: private, no-store`. Filenames have control/path characters removed, a validated extension and RFC 5987 encoding. No credential or file content is logged.

## Validation profile

Every original and sanitized file is limited to 5 MiB. A user can have at most 12 unfinished uploads, while each message accepts at most three. The multipart reader separately bounds the full body to 5 MiB plus 64 KiB of envelope data, including requests without a trustworthy content length.

JPEG and PNG signatures must match the declared MIME. Dimensions are checked before pixel decoding: at most four million pixels and an 8192-pixel edge. JPEG decoding is strict and has a 64 MiB decoder memory bound. Standalone EXIF orientation is applied to the pixels; new JPEG output contains neither original EXIF nor comments. PNG chunk lengths, ordering and CRCs are checked before decoding. A bounded inflate verifies the expected scanline length, and ancillary metadata is removed before the codec sees compressed profiles. A fresh pixel-only encoding strips metadata. Animated/interlaced PNGs and unsupported bit-depth profiles return a per-file error.

The implementation uses pinned [jpeg-js 0.4.4](https://github.com/jpeg-js/jpeg-js) and [fast-png 8.0.0](https://github.com/image-js/fast-png). Its own preflight limits run before their decoders. The bounded zlib calls also execute successfully in actual workerd; Cloudflare documents [Node zlib support](https://developers.cloudflare.com/workers/runtime-apis/nodejs/zlib/).

PDF handling deliberately accepts a restricted static subset. A lexical preflight runs before [pdf-lib 1.17.1](https://pdf-lib.js.org/docs/api/classes/pdfdocument) parses the object graph. Limits include 4000 indirect objects, 64 levels of object nesting, 50 pages, 8 MiB per decoded stream and 24 MiB across expanded streams/rasters. Page trees and boxes are checked. Image dimensions, color channels and predictor parameters are bounded before decoding, including Flate and unfiltered images. Embedded JPEGs are decoded and re-encoded without metadata; their decoded raster bytes count against the aggregate limit before the codec runs.

Encrypted PDFs, scripts, actions, embedded files, forms, annotations, active media, external streams, object/xref streams, inline images, unsupported filters/color spaces and uninspectable structures are rejected. Accepted pages are copied to a fresh document. Original document information, XMP metadata and private `PieceInfo` application dictionaries are removed. These restrictions can reject otherwise valid PDFs, including many modern PDFs that use compressed object streams. The client must show the specific rejection and allow the sender to remove or replace that file.

This is static content validation for the academic application. It is not a malware-scanning service, and successful parsing is not a claim that every PDF reader will render arbitrary accepted content identically.

## Cleanup and retention

Unused uploads expire after 23 hours. Rejected or explicitly removed uploads become eligible for immediate cleanup; the exported `cleanupSupportAttachments(env, now?)` processes at most 50 due records per sweep. D1 moves an unlinked file into `deleting` before R2 deletion. Failed deletes retain a retry deadline. Deleted tombstones are revisited hourly until 24 hours after the original expiry to remove late writes from interrupted requests.

Attached files retain their released object. Cleanup removes only their raw quarantine key and repeats that check through the same bounded late-write window. A failed duplicate upload also removes raw bytes separately without removing an already committed released file. This prevents a delayed duplicate from leaving quarantine data indefinitely after the first cleanup.

Rejected/abandoned removal targets the architecture's 24-hour deadline with regular healthy Cron execution. The local tests exercise the cleanup function and retries; deployed scheduling, load and R2 outage behavior still need acceptance. Accepted attachments remain attached to canonical history. Their 180-day case/event retention and financial-hold exceptions belong to the pending general retention/recovery workflow; this unit does not delete accepted history independently.

## Verification

`apps/api/src/support/attachments/attachments.integration.test.ts` has 11 passing cases. It builds the real support/auth handlers into a workerd Worker, runs content validation there, and applies all migrations to real Miniflare D1 and R2. Services used for controlled commit races still call that workerd validator.

The tests cover authenticated multipart upload, per-file rejection, empty/oversized HTTP bodies, current ACLs, private platform cases, quarantined download/link denial, metadata-free JPEG/PNG/PDF output, malformed signatures/CRC, image and compressed-stream expansion limits, encrypted/active PDFs, indirect-object/page limits, image predictor limits, aggregate JPEG raster limits and the PDF-name nesting bypass regression. They also cover repeated upload requests, cross-author/case links, competing messages, revoked permission during validation/link/download, immutable committed history, outbox-failure rollback and cleanup-versus-link races. R2 deletion failures and a late raw write after attachment are replayed without deleting the accepted file.

All 33 support REST, live and attachment tests pass together. Scoped formatting/lint/type checks pass. API and mobile TypeScript checks pass; the multipart parser explicitly uses Workers types so React Native's global FormData does not change the server contract.

A synthetic PDF containing text and an embedded image was validated in workerd, saved before and after sanitization, rendered with bundled Poppler and visually inspected. Text, page layout and image remained intact; the private document/application/image markers were absent from the released file. The ignored local evidence is under `test-results/support-attachments/`. No private user file was used.

Browser attachment selection/retry/download acceptance, deployed Worker/R2 execution and broad real-document compatibility remain separate acceptance work. Existing support browser/permission evidence is recorded in [web support and refunds](web-support-refunds.md).
