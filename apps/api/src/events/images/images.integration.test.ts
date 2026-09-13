import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { encode as encodePng, decode as decodePng } from "fast-png"
import { encode as encodeJpeg } from "jpeg-js"
import { createExportFixture } from "../../exports/test-fixture"
import { ApiFailure } from "../../db/transitions"
import type { Bindings } from "../../env"
import { uploadEventImage, updateEventImages } from "./service"
import { downloadEventImage } from "./download"
import { listEventImages } from "./store"
import { createEventImageRoutes } from "./routes"
import { cleanupEventImageAssets } from "./cleanup"
import { crc32 } from "../../support/attachments/images"
import { IMAGE_UPLOAD_LIFETIME, IMAGE_LEASE_MS } from "./validate"
import { retireEvent } from "../../retention/aggregates"
import { cleanupRetentionObjects } from "../../retention/objects"
import { getRetentionBacklog } from "../../retention/backlog"
import { DAY, HISTORY_MS } from "../../retention/policy"

const png = () =>
  encodePng({
    width: 2,
    height: 1,
    depth: 8,
    channels: 4,
    data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
  })
const jpeg = () =>
  new Uint8Array(
    encodeJpeg(
      {
        width: 2,
        height: 1,
        data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
      },
      90
    ).data
  )
describe("event image lifecycle on D1 and R2", () => {
  let fixture: Awaited<ReturnType<typeof createExportFixture>>,
    db: D1Database,
    now: number
  const clock = () => now
  beforeEach(async () => {
    fixture = await createExportFixture()
    db = fixture.db
    now = fixture.now
  })
  afterEach(async () => {
    await fixture?.dispose()
  })
  const revision = async () =>
    Number(
      await db
        .prepare("SELECT revision FROM events WHERE id='event'")
        .first("revision")
    )
  const upload = async (
    requestId: string = crypto.randomUUID(),
    changes: Record<string, unknown> = {},
    bytes = png(),
    type = "image/png",
    dependencies = {}
  ) =>
    uploadEventImage(
      fixture.env,
      "owner",
      "event",
      {
        requestId,
        expectedRevision: await revision(),
        altText: "Campus auditorium",
        ...changes,
      },
      bytes,
      type,
      { now: clock, ...dependencies }
    )
  const gallery = () => listEventImages(db, "event")
  const count = async (table: string) =>
    Number(
      await db.prepare(`SELECT count(*) AS count FROM ${table}`).first("count")
    )
  const failingFiles = () =>
    new Proxy(fixture.files, {
      get(target, property) {
        if (property === "put")
          return async () => {
            throw new Error("private storage error")
          }
        const value = Reflect.get(target, property)
        return typeof value === "function" ? value.bind(target) : value
      },
    })

  it.each(["image/png", "image/jpeg"])(
    "stores only decoded and re-encoded %s pixels and exposes a scoped image URL",
    async (type) => {
      const bytes = type === "image/png" ? png() : jpeg(),
        before = await revision()
      const result = await upload("image", {}, bytes, type)
      expect(result.revision).toBe(before + 1)
      const [image] = await gallery()
      expect(image).toMatchObject({
        id: result.resourceId,
        position: 0,
        altText: "Campus auditorium",
        contentType: type,
        url: `/api/events/event/images/${result.resourceId}`,
      })
      const objects = await fixture.files.list({
        prefix: "private/event-images/",
      })
      expect(objects.objects).toHaveLength(1)
      expect(
        await db
          .prepare("SELECT state,lease_token FROM event_image_assets")
          .first()
      ).toEqual({ state: "ready", lease_token: null })
      const response = await downloadEventImage(
        fixture.env,
        "event",
        result.resourceId
      )
      expect(response.headers.get("Cache-Control")).toBe("private, no-store")
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
      expect(response.headers.get("Content-Disposition")).toBe("inline")
      const output = new Uint8Array(await response.arrayBuffer())
      if (type === "image/png") expect(decodePng(output).width).toBe(2)
    }
  )
  it.each([
    ["image/svg+xml", new TextEncoder().encode('<svg onload="alert(1)"/>')],
    ["application/pdf", new TextEncoder().encode("%PDF-1.7")],
    ["image/jpeg", png()],
    ["image/png", new Uint8Array([137, 80, 78, 71])],
    ["image/png", new Uint8Array(5 * 1024 * 1024 + 1)],
  ])(
    "rejects unsupported, mismatched, malformed and oversized %s before storing any object",
    async (type, bytes) => {
      await expect(upload("bad", {}, bytes, type)).rejects.toMatchObject({
        code: "ATTACHMENT_REJECTED",
      })
      expect(await count("event_image_assets")).toBe(0)
      expect((await fixture.files.list()).objects).toHaveLength(0)
    }
  )
  it("requires nonempty bounded alternative text and current event management", async () => {
    await expect(upload("bad-alt", { altText: " " })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    })
    await expect(
      uploadEventImage(
        fixture.env,
        "buyer",
        "event",
        {
          requestId: "bad-actor",
          expectedRevision: await revision(),
          altText: "Hall",
        },
        png(),
        "image/png",
        { now: clock }
      )
    ).rejects.toMatchObject({ status: 403 })
    expect(await count("event_image_assets")).toBe(0)
  })
  it("replays the original immutable acknowledgement and rejects a changed request body", async () => {
    const before = await revision(),
      result = await upload("same")
    expect(await upload("same", { expectedRevision: before })).toEqual(result)
    await expect(
      upload("same", { expectedRevision: before, altText: "Different" })
    ).rejects.toMatchObject({ status: 409 })
    expect(await count("event_images")).toBe(1)
    expect(await count("event_image_assets")).toBe(1)
    expect(
      await db
        .prepare(
          "SELECT count(*) AS count FROM audit_entries WHERE action='event.image_added'"
        )
        .first("count")
    ).toBe(1)
  })
  it("retries an R2 failure using the same durable upload intent", async () => {
    const input = {
      requestId: "retry",
      expectedRevision: await revision(),
      altText: "Hall",
    }
    await expect(
      uploadEventImage(
        { ...fixture.env, FILES: failingFiles() },
        "owner",
        "event",
        input,
        png(),
        "image/png",
        { now: clock }
      )
    ).rejects.toMatchObject({ status: 503 })
    expect(
      await db
        .prepare("SELECT state,lease_token FROM event_image_assets")
        .first()
    ).toEqual({ state: "staged", lease_token: null })
    const result = await uploadEventImage(
      fixture.env,
      "owner",
      "event",
      input,
      png(),
      "image/png",
      { now: clock }
    )
    expect(result.resourceId).toBe(
      await db.prepare("SELECT id FROM event_image_assets").first("id")
    )
    expect(await count("event_images")).toBe(1)
  })
  it("allows only one concurrent attachment for one request", async () => {
    const input = {
      requestId: "concurrent",
      expectedRevision: await revision(),
      altText: "Hall",
    }
    const results = await Promise.allSettled([
      uploadEventImage(
        fixture.env,
        "owner",
        "event",
        input,
        png(),
        "image/png",
        { now: clock }
      ),
      uploadEventImage(
        fixture.env,
        "owner",
        "event",
        input,
        png(),
        "image/png",
        { now: clock }
      ),
    ])
    expect(results.some((result) => result.status === "fulfilled")).toBe(true)
    expect(await count("event_images")).toBe(1)
    expect(await count("event_image_assets")).toBe(1)
    expect(await revision()).toBe(input.expectedRevision + 1)
  })
  it("does not attach after the uploader loses permission during R2 I/O", async () => {
    const input = {
      requestId: "revoked",
      expectedRevision: await revision(),
      altText: "Hall",
    }
    await expect(
      uploadEventImage(
        fixture.env,
        "manager",
        "event",
        input,
        png(),
        "image/png",
        {
          now: clock,
          beforeCommit: async () => {
            await db
              .prepare(
                "UPDATE event_permissions SET revoked_at=? WHERE user_id='manager' AND event_id='event'"
              )
              .bind(now)
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ status: 403 })
    expect(await count("event_images")).toBe(0)
    expect((await fixture.files.list()).objects).toHaveLength(1)
    now += IMAGE_UPLOAD_LIFETIME
    await cleanupEventImageAssets(db, now)
    await cleanupRetentionObjects(fixture.env, { now: clock })
    expect((await fixture.files.list()).objects).toHaveLength(0)
  })
  it("stops a revoked upload before the external put", async () => {
    await expect(
      upload("suspend", {}, png(), "image/png", {
        beforePut: async () => {
          await db
            .prepare(
              "INSERT INTO profiles(user_id,suspended_at,updated_at) VALUES ('owner',?,?)"
            )
            .bind(now, now)
            .run()
        },
      })
    ).rejects.toMatchObject({ status: 403 })
    expect((await fixture.files.list()).objects).toHaveLength(0)
  })
  it("rejects an expired upload lease at attachment commit and can retry it", async () => {
    const before = await revision()
    await expect(
      upload("lease", {}, png(), "image/png", {
        beforeCommit: async () => {
          now += IMAGE_LEASE_MS + 1
        },
      })
    ).rejects.toMatchObject({ status: 409 })
    expect(await count("event_images")).toBe(0)
    expect(await upload("lease", { expectedRevision: before })).toMatchObject({
      revision: before + 1,
    })
    expect((await fixture.files.list()).objects).toHaveLength(1)
  })
  it("caps the gallery at five and reorders, edits alt text and removes in one revision", async () => {
    const ids = []
    for (let i = 0; i < 5; i++)
      ids.push(
        (await upload(`image-${i}`, { altText: `Image ${i}` })).resourceId
      )
    await expect(upload("sixth")).rejects.toMatchObject({ status: 409 })
    expect(await count("event_images")).toBe(5)
    const before = await revision(),
      body = {
        requestId: "gallery",
        expectedRevision: before,
        images: [
          { id: ids[4]!, altText: "Last becomes first" },
          { id: ids[0]!, altText: "First becomes second" },
        ],
      }
    const result = await updateEventImages(
      fixture.env,
      "owner",
      "event",
      body,
      { now: clock }
    )
    expect(result.revision).toBe(before + 1)
    expect(
      (await gallery()).map((image) => ({
        id: image.id,
        position: image.position,
        altText: image.altText,
      }))
    ).toEqual([
      { id: ids[4], position: 0, altText: "Last becomes first" },
      { id: ids[0], position: 1, altText: "First becomes second" },
    ])
    expect(
      await updateEventImages(fixture.env, "owner", "event", body, {
        now: clock,
      })
    ).toEqual(result)
    expect(await count("retention_object_jobs")).toBe(3)
    await cleanupRetentionObjects(fixture.env, { now: clock })
    expect(
      (await fixture.files.list({ prefix: "private/event-images/" })).objects
    ).toHaveLength(2)
  })
  it("rejects stale, duplicate and foreign gallery selections without partial removal", async () => {
    const first = await upload("one"),
      second = await upload("two")
    for (const images of [
      [{ id: "foreign", altText: "Foreign" }],
      [
        { id: first.resourceId, altText: "A" },
        { id: first.resourceId, altText: "A" },
      ],
    ])
      await expect(
        updateEventImages(
          fixture.env,
          "owner",
          "event",
          {
            requestId: crypto.randomUUID(),
            expectedRevision: await revision(),
            images,
          },
          { now: clock }
        )
      ).rejects.toMatchObject({ status: 400 })
    await expect(
      updateEventImages(
        fixture.env,
        "owner",
        "event",
        { requestId: "stale", expectedRevision: first.revision, images: [] },
        { now: clock }
      )
    ).rejects.toMatchObject({ status: 409 })
    expect((await gallery()).map((image) => image.id)).toEqual([
      first.resourceId,
      second.resourceId,
    ])
  })
  it("private and draft images require current relationship access", async () => {
    const image = await upload()
    await db
      .prepare("UPDATE events SET visibility='private' WHERE id='event'")
      .run()
    await expect(
      downloadEventImage(fixture.env, "event", image.resourceId)
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      downloadEventImage(fixture.env, "event", image.resourceId, "buyer")
    ).rejects.toMatchObject({ status: 404 })
    expect(
      (
        await downloadEventImage(
          fixture.env,
          "event",
          image.resourceId,
          "owner"
        )
      ).status
    ).toBe(200)
    expect(
      (
        await downloadEventImage(
          fixture.env,
          "event",
          image.resourceId,
          "manager"
        )
      ).status
    ).toBe(200)
    await db
      .prepare(
        "UPDATE events SET visibility='public',publication_state='draft' WHERE id='event'"
      )
      .run()
    await expect(
      downloadEventImage(fixture.env, "event", image.resourceId)
    ).rejects.toMatchObject({ status: 404 })
    expect(
      (
        await downloadEventImage(
          fixture.env,
          "event",
          image.resourceId,
          "owner"
        )
      ).status
    ).toBe(200)
  })
  it.each(["suspension", "removal", "staff"])(
    "rechecks %s after reading image bytes",
    async (change) => {
      const image = await upload()
      if (change === "staff")
        await db
          .prepare("UPDATE events SET visibility='private' WHERE id='event'")
          .run()
      await expect(
        downloadEventImage(
          fixture.env,
          "event",
          image.resourceId,
          change === "staff" ? "manager" : undefined,
          {
            beforeReturn: async () => {
              if (change === "suspension")
                await db
                  .prepare("UPDATE events SET suspended_at=? WHERE id='event'")
                  .bind(now)
                  .run()
              else if (change === "staff")
                await db
                  .prepare(
                    "UPDATE event_permissions SET revoked_at=? WHERE user_id='manager'"
                  )
                  .bind(now)
                  .run()
              else
                await updateEventImages(
                  fixture.env,
                  "owner",
                  "event",
                  {
                    requestId: "remove-during-read",
                    expectedRevision: await revision(),
                    images: [],
                  },
                  { now: clock }
                )
            },
          }
        )
      ).rejects.toMatchObject({ status: 404 })
    }
  )
  it("keeps shared images when their original event expires and deletes after the final reference", async () => {
    const image = await upload()
    await db
      .prepare(`INSERT INTO events(id,organizer_id,title,description,category,venue_name,venue_address,starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,calendar_uid,reporting_id,created_at,updated_at)
   VALUES ('copy','owner','New event','Text','Education','Hall','Almaty',?,?,?,?,10,'copy-calendar','copy-report',?,?)`)
      .bind(now + 200 * DAY, now + 201 * DAY, now, now + 200 * DAY, now, now)
      .run()
    await db
      .prepare(
        "INSERT INTO event_images(id,event_id,asset_id,position,alt_text,created_at) VALUES ('copy-image','copy',?,0,'Copied image',?)"
      )
      .bind(image.resourceId, now)
      .run()
    now += HISTORY_MS + 2 * DAY
    expect(await retireEvent(db, "event", { now: clock })).toBe(true)
    await cleanupRetentionObjects(fixture.env, { now: clock })
    expect(
      (await fixture.files.list({ prefix: "private/event-images/" })).objects
    ).toHaveLength(1)
    expect(
      (await downloadEventImage(fixture.env, "copy", "copy-image", "owner"))
        .status
    ).toBe(200)
    await updateEventImages(
      fixture.env,
      "owner",
      "copy",
      { requestId: "remove-copy", expectedRevision: 0, images: [] },
      { now: clock }
    )
    expect((await getRetentionBacklog(db, now)).objects).toBeGreaterThan(0)
    await cleanupRetentionObjects(fixture.env, { now: clock })
    expect(
      (await fixture.files.list({ prefix: "private/event-images/" })).objects
    ).toHaveLength(0)
  })
  it("parses one bounded multipart image and rejects missing or repeated fields", async () => {
    const app = new Hono<{ Bindings: Bindings }>()
      .route(
        "/api",
        createEventImageRoutes({ identify: async () => "owner", now: clock })
      )
      .onError((error, c) =>
        c.json(
          { code: error instanceof ApiFailure ? error.code : "ERROR" },
          error instanceof HTTPException ? error.status : 500
        )
      )
    const form = new FormData()
    form.set(
      "file",
      new File([new Uint8Array(png()).buffer], "campus.png", {
        type: "image/png",
      })
    )
    form.set("requestId", "multipart")
    form.set("expectedRevision", String(await revision()))
    form.set("altText", "Campus")
    const response = await app.request(
      "http://elc.test/api/events/event/images",
      { method: "POST", body: form },
      fixture.env as Bindings
    )
    expect(response.status).toBe(201)
    form.append("altText", "Duplicate")
    expect(
      (
        await app.request(
          "http://elc.test/api/events/event/images",
          { method: "POST", body: form },
          fixture.env as Bindings
        )
      ).status
    ).toBe(400)
    expect(await count("event_images")).toBe(1)
  })
  it("records final object deletion even if the first successful sweep is after thirty days", async () => {
    const image = await upload()
    await updateEventImages(
      fixture.env,
      "owner",
      "event",
      {
        requestId: "remove-for-long-downtime",
        expectedRevision: await revision(),
        images: [],
      },
      { now: clock }
    )
    now += 31 * DAY
    expect(await cleanupRetentionObjects(fixture.env, { now: clock })).toEqual({
      swept: 1,
      retry: 0,
    })
    expect(await count("retention_object_jobs")).toBe(0)
    expect(
      await db
        .prepare("SELECT state FROM event_image_assets WHERE id=?")
        .bind(image.resourceId)
        .first("state")
    ).toBe("deleted")
    await cleanupEventImageAssets(db, now)
    expect(await count("retention_object_jobs")).toBe(0)
    now += DAY
    await cleanupEventImageAssets(db, now)
    expect(await count("event_image_assets")).toBe(0)
    expect(
      (await fixture.files.list({ prefix: "private/event-images/" })).objects
    ).toHaveLength(0)
  })
  it("rejects oversized decoded image dimensions before decompression", async () => {
    for (const [width, height] of [
      [2001, 2000],
      [8193, 1],
    ]) {
      const bytes = new Uint8Array(png()),
        view = new DataView(bytes.buffer)
      view.setUint32(16, width!)
      view.setUint32(20, height!)
      view.setUint32(29, crc32(bytes.subarray(12, 29)))
      await expect(
        upload(crypto.randomUUID(), {}, bytes)
      ).rejects.toMatchObject({
        code: "ATTACHMENT_REJECTED",
        message: "FILE_COMPLEXITY_LIMIT",
      })
    }
    expect(await count("event_image_assets")).toBe(0)
    expect((await fixture.files.list()).objects).toHaveLength(0)
  })
  it("lets only one concurrent upload take the final gallery position", async () => {
    for (let i = 0; i < 4; i++) await upload(`existing-${i}`)
    const expectedRevision = await revision()
    const results = await Promise.allSettled(
      ["last-a", "last-b"].map((requestId) =>
        uploadEventImage(
          fixture.env,
          "owner",
          "event",
          { requestId, expectedRevision, altText: "Final image" },
          png(),
          "image/png",
          { now: clock }
        )
      )
    )
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1)
    expect(await count("event_images")).toBe(5)
    expect(await revision()).toBe(expectedRevision + 1)
    now += IMAGE_UPLOAD_LIFETIME
    await cleanupEventImageAssets(db, now)
    await cleanupRetentionObjects(fixture.env, { now: clock })
    expect(
      (await fixture.files.list({ prefix: "private/event-images/" })).objects
    ).toHaveLength(5)
  })
})
