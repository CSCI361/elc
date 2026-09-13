# Event image API evidence

SRS section 4.2 requires event images and event creation, editing, duplication and preview. It does not prescribe image formats, byte limits or a gallery size. The academic implementation supports five ordered JPEG or PNG images per event, up to 5 MiB each, with required alternative text of 1–500 trimmed characters. The first image is the cover. Uploaded images also have a four-million-pixel limit and an 8,192-pixel maximum edge.

## API and validation

`POST /api/events/:eventId/images` accepts exactly one multipart file plus `requestId`, `expectedRevision` and `altText`. `PATCH /api/events/:eventId/images` accepts the complete desired list of existing image IDs and alternative text, in display order. Omitting an image removes it. Both commands require current verified event management, use an event revision, write an audit entry and emit the existing event-change outbox notification.

The API bounds the request stream independently of Content-Length, checks the declared MIME type and fully parses the image. It reuses the JPEG/PNG validators exercised by support attachments: strict envelopes and parsing, CRC checks, decompression limits, metadata removal, JPEG orientation handling and re-encoding from decoded pixels. Raw image bytes stay in request memory. Only validated output reaches R2.

A D1 upload intent records the original request hash, normalized metadata and sanitized content digest before storage begins. An immutable R2 key is written conditionally; a retry verifies any existing object's bytes against the saved digest. A unique lease token prevents competing workers from attaching the same pending upload. Storage failures release the lease and leave the same intent available for retry. Expired or superseded leases, changed event revisions and revoked authority cannot commit a gallery association.

The ready asset, ordered association, revision increment, audit, outbox notification and command receipt commit in one D1 batch. Replaying the original command returns its original acknowledgement without attaching another image. Gallery reordering removes and reinserts the selected associations in the same transaction, preserving IDs and original creation times while avoiding temporary unique-position conflicts. Foreign and repeated IDs are rejected.

## Reads and retention

`GET /api/events/:eventId/images/:imageId` checks the current event relationship. Published public and unlisted images can be read anonymously; private events, drafts and organizer previews follow the existing event access rules. After R2 I/O, one SQL query rechecks the ready asset, exact association and current authorization before returning bytes. R2 keys are never used as unrestricted download URLs. Responses use the verified image MIME type, inline disposition, `nosniff`, and `private, no-store` caching.

Event duplication can associate a new event with the same immutable asset. Removing an image or retiring its original event cannot delete an asset referenced by another event. After the final reference disappears, cleanup marks the asset unavailable for new associations and records an exact-key retention job. Unfinished staging expires after 23 hours, and staging whose source event has been retired is also eligible for cleanup. Bounded passes retain durable asset rows for every deferred item; the recovery backlog counts orphaned or expired work.

R2 deletion uses the existing retryable retention queue. The asset's deleted state and its object's completion or tombstone removal commit under the same lease guard. This also handles a first successful sweep after a long outage: retiring the object job cannot lose the asset's deletion evidence. Object tombstones repeat deletion for 30 days to cover a late in-flight write; retired asset metadata is pruned after the tombstone and required grace period are gone. An uploader's account remains retained while an asset still needs its relationship.

## Local checks

The D1/R2 integration suite uses the real migrations, existing payment/ticket fixture, real JPEG/PNG codecs and Miniflare R2. It covers both supported formats; invalid type, signature, content, byte count and dimensions; required alternative text; current permissions; command replay; R2 failure and retry; competing uploads; the five-image cap; gallery editing/removal; stale and foreign selections; private/draft reads; access or association changes during I/O; shared-asset retention; multipart parsing; expired leases; and deletion after a long outage.

The combined run passed 23 image cases and all 21 retention cases in 121.60 seconds. Two additional focused image cases for decoded dimensions and the final-slot race also passed, bringing image coverage to 25 cases. The final scoped check reported no warnings, lint errors or type errors in 15 TypeScript files.

Run `vp test apps/api/src/events/images/images.integration.test.ts apps/api/src/retention/retention.integration.test.ts --maxWorkers=1` and the scoped Vite+ checks for those directories. Web rendering and provider deployment evidence are recorded separately. These validators are not a production malware-scanning service.
