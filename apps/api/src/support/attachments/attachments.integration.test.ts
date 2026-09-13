import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vite-plus/test"
import { encode as encodePng, decode as decodePng } from "fast-png"
import { encode as encodeJpeg, decode as decodeJpeg } from "jpeg-js"
import { PDFDocument, PDFName, PDFString, PDFRawStream } from "pdf-lib"
import { hashPassword } from "better-auth/crypto"
import { deflateSync } from "node:zlib"
import { buildAttachmentWorker, attachmentRuntime } from "./test-runtime"
import { createSupportCase, addSupportMessage } from "../service"
import { listSupportChanges, listSupportMessages } from "../read"
import {
  uploadSupportAttachment,
  cleanupSupportAttachments,
  removeSupportUpload,
} from "./service"
import { downloadSupportAttachment } from "./download"
import { attachmentRow } from "./store"
import { MAX_ATTACHMENT_BYTES, MAX_PDF_STREAM_BYTES } from "./limits"
import { crc32 } from "./images"

const png = () =>
  encodePng({
    width: 2,
    height: 2,
    channels: 4,
    data: new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
    ]),
    text: { Comment: "Private camera metadata" },
  })
async function pdf() {
  const file = await PDFDocument.create()
  file.setAuthor("Private document author")
  file
    .addPage([595.28, 841.89])
    .drawText("Support receipt example", { x: 40, y: 750, size: 16 })
  return file
}
describe("support attachment validation and D1/R2 lifecycle", () => {
  let script: string
  let env: Awaited<ReturnType<typeof attachmentRuntime>>
  let db: D1Database
  let caseId: string
  let now: number
  const password = "Synthetic attachment test account password"
  beforeAll(async () => {
    script = await buildAttachmentWorker()
  }, 60_000)
  beforeEach(async () => {
    env = await attachmentRuntime(script)
    db = env.DB
    now = Date.now()
    const hash = await hashPassword(password)
    for (const id of [
      "owner",
      "buyer",
      "support",
      "other",
      "scanner",
      "platform",
    ]) {
      await db
        .prepare(
          "INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,1,?,?)"
        )
        .bind(id, id, `${id}@example.test`, now, now)
        .run()
      await db
        .prepare(
          "INSERT INTO account (id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES (?,?,'credential',?,?,?,?)"
        )
        .bind(`account-${id}`, id, id, hash, now, now)
        .run()
    }
    await db
      .prepare(`INSERT INTO events (id,organizer_id,title,description,category,venue_name,venue_address,starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,publication_state,calendar_uid,reporting_id,created_at,updated_at)
      VALUES ('event','owner','Attachment fixture','Description','Education','Hall','Address',?,?,?,?,10,'published','attachment@elc','rpt_attachment',?,?)`)
      .bind(
        now + 3600000,
        now + 7200000,
        now - 3600000,
        now + 3600000,
        now,
        now
      )
      .run()
    for (const [actor, permission] of [
      ["support", "support:manage"],
      ["scanner", "ticket:scan"],
    ])
      await db
        .prepare(
          "INSERT INTO event_permissions (event_id,user_id,permission,granted_at) VALUES ('event',?,?,?)"
        )
        .bind(actor, permission, now)
        .run()
    await db
      .prepare(
        "INSERT INTO platform_grants (user_id,permission,granted_at) VALUES ('platform','platform:support',?)"
      )
      .bind(now)
      .run()
    caseId = (
      await createSupportCase(db, "buyer", {
        requestId: "open",
        audience: "attendee",
        category: "technical",
        subject: "File example",
        eventId: "event",
        body: "Original text message",
      })
    ).case.id
  })
  afterEach(async () => {
    await env?.runtime.dispose()
  })
  const upload = (
    actor = "buyer",
    requestId: string = crypto.randomUUID(),
    bytes = png(),
    contentType = "image/png",
    id = caseId,
    extra = {}
  ) =>
    uploadSupportAttachment(
      env,
      actor,
      id,
      {
        requestId,
        fileName:
          contentType === "application/pdf" ? "receipt.pdf" : "photo.png",
        contentType,
      },
      bytes,
      { validate: env.validate, ...extra }
    )
  async function signIn(actor: string) {
    const response = await env.runtime.dispatchFetch(
      "https://elc.test/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://elc.test",
        },
        body: JSON.stringify({ email: `${actor}@example.test`, password }),
      }
    )
    expect(response.status).toBe(200)
    return response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0]!)
      .join("; ")
  }

  it("re-encodes JPEG/PNG metadata and rewrites a static PDF in actual workerd", async () => {
    const cleanPng = await env.validate(png(), "image/png")
    expect(decodePng(cleanPng.bytes).text).toEqual({})
    expect(decodePng(cleanPng.bytes).data).toEqual(decodePng(png()).data)
    const jpeg = encodeJpeg(
      {
        width: 2,
        height: 2,
        data: decodePng(png()).data,
        comments: ["Private image comment"],
      },
      85
    ).data
    const cleanJpeg = await env.validate(new Uint8Array(jpeg), "image/jpeg")
    expect(decodeJpeg(cleanJpeg.bytes).comments).toBeUndefined()
    const original = await pdf()
    const cleanPdf = await env.validate(
      await original.save({ useObjectStreams: false }),
      "application/pdf"
    )
    const loaded = await PDFDocument.load(cleanPdf.bytes)
    expect(loaded.getAuthor()).toBeUndefined()
    expect(loaded.getPageCount()).toBe(1)
    expect(loaded.getPage(0).getSize()).toEqual({
      width: 595.28,
      height: 841.89,
    })
  })

  it("rejects malformed signatures, image expansion bombs and unsafe or uninspectable PDFs in workerd", async () => {
    await expect(env.validate(png(), "image/jpeg")).rejects.toMatchObject({
      code: "FILE_TYPE_MISMATCH",
    })
    const broken = png()
    broken[broken.length - 1] ^= 1
    await expect(env.validate(broken, "image/png")).rejects.toMatchObject({
      code: "FILE_INVALID",
    })
    const oversized = png()
    new DataView(oversized.buffer).setUint32(16, 9000)
    new DataView(oversized.buffer).setUint32(
      29,
      crc32(oversized.subarray(12, 29))
    )
    await expect(env.validate(oversized, "image/png")).rejects.toMatchObject({
      code: "FILE_COMPLEXITY_LIMIT",
    })
    function chunk(name: string, data: Uint8Array) {
      const bytes = new Uint8Array(data.length + 12),
        view = new DataView(bytes.buffer)
      view.setUint32(0, data.length)
      bytes.set(new TextEncoder().encode(name), 4)
      bytes.set(data, 8)
      view.setUint32(data.length + 8, crc32(bytes.subarray(4, data.length + 8)))
      return bytes
    }
    const header = png().subarray(0, 33)
    const compressed = chunk(
      "IDAT",
      new Uint8Array(deflateSync(new Uint8Array(2_000_000)))
    )
    const end = chunk("IEND", new Uint8Array())
    const bomb = new Uint8Array(header.length + compressed.length + end.length)
    bomb.set(header)
    bomb.set(compressed, header.length)
    bomb.set(end, header.length + compressed.length)
    await expect(env.validate(bomb, "image/png")).rejects.toMatchObject({
      code: "FILE_COMPLEXITY_LIMIT",
    })
    for (const kind of [
      "script",
      "embedded",
      "encrypted",
      "objects",
      "deep",
      "stream",
      "pages",
    ]) {
      const file = await pdf()
      let bytes: Uint8Array
      if (kind === "script")
        file.catalog.set(
          PDFName.of("OpenAction"),
          file.context.obj({ S: "JavaScript", JS: PDFString.of("blocked()") })
        )
      if (kind === "embedded")
        await file.attach(new Uint8Array([1, 2, 3]), "embedded.bin")
      if (kind === "stream")
        file.context.register(
          file.context.flateStream(new Uint8Array(MAX_PDF_STREAM_BYTES + 1))
        )
      if (kind === "pages")
        for (let i = 0; i < 50; i++) file.addPage([100, 100])
      bytes = await file.save({ useObjectStreams: kind === "objects" })
      if (kind === "encrypted")
        bytes = new TextEncoder().encode(
          new TextDecoder("latin1")
            .decode(bytes)
            .replace("trailer\n<<", "trailer\n<< /Encrypt <<>>")
        )
      if (kind === "deep")
        bytes = new TextEncoder().encode(
          `%PDF-1.7\n1 0 obj ${"[".repeat(65)}0${"]".repeat(65)} endobj\n%%EOF`
        )
      await expect(
        env.validate(bytes, "application/pdf"),
        kind
      ).rejects.toMatchObject({
        code:
          kind === "objects"
            ? "PDF_UNSUPPORTED"
            : ["stream", "pages", "deep"].includes(kind)
              ? "FILE_COMPLEXITY_LIMIT"
              : "PDF_UNSAFE",
      })
    }
    const orphan = await pdf()
    orphan.context.register(
      orphan.context.obj({ S: "JavaScript", JS: PDFString.of("blocked()") })
    )
    await expect(
      env.validate(
        await orphan.save({ useObjectStreams: false }),
        "application/pdf"
      )
    ).rejects.toMatchObject({ code: "PDF_UNSAFE" })
    const excessive = new TextEncoder().encode(
      `%PDF-1.7\n${Array.from({ length: 4001 }, (_, i) => `${i + 1} 0 obj null endobj`).join("\n")}\n%%EOF`
    )
    await expect(
      env.validate(excessive, "application/pdf")
    ).rejects.toMatchObject({ code: "FILE_COMPLEXITY_LIMIT" })
  })

  it("uses authenticated HTTP for private upload, atomic message references and authorized downloads", async () => {
    const cookie = await signIn("buyer")
    const form = new FormData()
    form.set("requestId", "http-upload")
    form.set(
      "file",
      new Blob([new Uint8Array(png()).buffer], { type: "image/png" }),
      "photo.html"
    )
    const encoded = new Request("https://elc.test", {
      method: "POST",
      body: form,
    })
    const encodedBody = await encoded.arrayBuffer()
    const response = await env.runtime.dispatchFetch(
      `https://elc.test/api/support/cases/${caseId}/attachments`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "https://elc.test",
          "Content-Type": encoded.headers.get("Content-Type")!,
        },
        body: encodedBody,
      }
    )
    expect(response.status).toBe(201)
    const payload = (await response.json()) as {
      attachment: { id: string; status: string; fileName: string }
    }
    expect(payload.attachment).toMatchObject({
      status: "ready",
      fileName: "photo.png",
    })
    const row = await attachmentRow(db, payload.attachment.id)
    expect(await env.FILES.head(row.quarantine_key)).toBeNull()
    expect((await env.FILES.head(row.object_key))?.customMetadata?.sha256).toBe(
      row.content_sha256
    )
    await expect(
      downloadSupportAttachment(env, "buyer", caseId, row.id)
    ).rejects.toMatchObject({ status: 404 })
    const save = await env.runtime.dispatchFetch(
      `https://elc.test/api/support/cases/${caseId}/messages`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "https://elc.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId: "http-message",
          expectedRevision: 1,
          body: "Attached screenshot",
          attachmentIds: [row.id],
        }),
      }
    )
    expect(save.status).toBe(201)
    const saved = (await save.json()) as {
      change: {
        id: string
        message: { id: string; attachments: Array<{ id: string }> }
      }
    }
    expect(saved.change.message.attachments.map((file) => file.id)).toEqual([
      row.id,
    ])
    expect(await attachmentRow(db, row.id)).toMatchObject({
      status: "attached",
      message_id: saved.change.message.id,
      position: 0,
    })
    expect(
      (await listSupportMessages(db, "buyer", caseId)).items[1]
        ?.attachments?.[0]?.id
    ).toBe(row.id)
    expect(
      (await listSupportChanges(db, "support", caseId)).items[1]?.message
        ?.attachments?.[0]?.id
    ).toBe(row.id)
    for (const actor of ["buyer", "owner", "support", "platform"])
      expect(
        (await downloadSupportAttachment(env, actor, caseId, row.id)).status
      ).toBe(200)
    for (const actor of ["other", "scanner"])
      await expect(
        downloadSupportAttachment(env, actor, caseId, row.id)
      ).rejects.toMatchObject({ status: 404 })
    const download = await env.runtime.dispatchFetch(
      `https://elc.test/api/support/cases/${caseId}/attachments/${row.id}/download`,
      { headers: { Cookie: cookie } }
    )
    expect(download.headers.get("Content-Disposition")).toContain("attachment;")
    expect(download.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(download.headers.get("Cache-Control")).toBe("private, no-store")
    expect(
      decodePng(new Uint8Array(await download.arrayBuffer())).text
    ).toEqual({})
    const jobs = (
      await db
        .prepare(
          "SELECT kind,payload_json FROM outbox WHERE entity_id=? AND json_extract(payload_json,'$.changeId')=?"
        )
        .bind(caseId, saved.change.id)
        .all<{ kind: string; payload_json: string }>()
    ).results
    expect(jobs.map((job) => job.kind).sort()).toEqual([
      "support.live",
      "support.notify",
    ])
    expect(jobs.every((job) => !job.payload_json.includes("photo"))).toBe(true)
    await cleanupSupportAttachments(env, Date.now() + 1)
    expect(await env.FILES.head(row.object_key)).not.toBeNull()
    await expect(
      removeSupportUpload(env, "buyer", caseId, row.id)
    ).rejects.toMatchObject({ status: 409 })
  })

  it("keeps rejected/quarantined content private, enforces 5 MiB, and cleans retries and abandoned objects", async () => {
    const rejected = await upload(
      "buyer",
      "bad",
      new Uint8Array([1, 2, 3]),
      "image/png"
    )
    expect(rejected.attachment).toMatchObject({
      status: "rejected",
      errorCode: "FILE_TYPE_MISMATCH",
    })
    const rejectedRow = await attachmentRow(db, rejected.attachment.id)
    expect(await env.FILES.head(rejectedRow.quarantine_key)).toBeNull()
    expect(await env.FILES.head(rejectedRow.object_key)).toBeNull()
    await expect(
      upload("buyer", "huge", new Uint8Array(MAX_ATTACHMENT_BYTES + 1))
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" })
    const ready = await upload()
    const row = await attachmentRow(db, ready.attachment.id)
    const cutoff = row.expires_at + 1
    await cleanupSupportAttachments(env, row.expires_at - 1, row.id)
    expect((await attachmentRow(db, row.id)).status).toBe("ready")
    const failedStorage = new Proxy(env.FILES, {
      get(target, key) {
        if (key === "delete")
          return async () => {
            throw new Error("synthetic storage outage")
          }
        const value = Reflect.get(target, key)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    await cleanupSupportAttachments(
      { ...env, FILES: failedStorage },
      cutoff,
      row.id
    )
    expect((await attachmentRow(db, row.id)).status).toBe("deleting")
    expect(await env.FILES.head(row.object_key)).not.toBeNull()
    await cleanupSupportAttachments(env, cutoff + 60001, row.id)
    expect((await attachmentRow(db, row.id)).status).toBe("deleted")
    expect(await env.FILES.head(row.object_key)).toBeNull()
    // Simulate a delayed write from a terminated upload, then retry its durable tombstone.
    await env.FILES.put(row.quarantine_key, new Uint8Array([1]).buffer)
    await cleanupSupportAttachments(env, cutoff + 3660002, row.id)
    expect(await env.FILES.head(row.quarantine_key)).toBeNull()
    await expect(
      addSupportMessage(db, "buyer", caseId, {
        requestId: "late",
        expectedRevision: 1,
        body: "Late file",
        attachmentIds: [row.id],
      })
    ).rejects.toMatchObject({ status: 409 })
  })

  it("deduplicates repeated uploads and prevents foreign, duplicate, excessive or reused links", async () => {
    const repeated = await Promise.all([
      upload("buyer", "repeat"),
      upload("buyer", "repeat"),
    ])
    expect(repeated[0].attachment.id).toBe(repeated[1].attachment.id)
    expect(
      (
        await db
          .prepare("SELECT count(*) AS n FROM support_attachments")
          .first<{ n: number }>()
      )?.n
    ).toBe(1)
    await expect(
      upload("buyer", "repeat", new Uint8Array([1, 2, 3]))
    ).rejects.toMatchObject({ status: 409 })
    const own = [repeated[0], await upload(), await upload(), await upload()]
    const foreign = await upload("support")
    const post = (ids: string[], requestId: string) =>
      addSupportMessage(db, "buyer", caseId, {
        requestId,
        expectedRevision: 1,
        body: "Files",
        attachmentIds: ids,
      })
    await expect(
      post([foreign.attachment.id], "foreign")
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      post([own[0].attachment.id, own[0].attachment.id], "duplicate")
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      post(
        own.map((item) => item.attachment.id),
        "four"
      )
    ).rejects.toMatchObject({ status: 400 })
    const results = await Promise.allSettled([
      post(
        own.slice(0, 3).map((item) => item.attachment.id),
        "race-a"
      ),
      post([own[0].attachment.id], "race-b"),
    ])
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1)
    expect(
      (
        await db
          .prepare("SELECT count(*) AS n FROM support_messages WHERE case_id=?")
          .bind(caseId)
          .first<{ n: number }>()
      )?.n
    ).toBe(2)
    const message = (await listSupportMessages(db, "buyer", caseId)).items[1]!
    const spare = await attachmentRow(db, own[3].attachment.id)
    await expect(
      db
        .prepare(
          "UPDATE support_attachments SET status='attached',message_id=?,position=2,attached_at=? WHERE id=?"
        )
        .bind(message.id, Date.parse(message.createdAt), spare.id)
        .run()
    ).rejects.toThrow()
    await expect(
      addSupportMessage(db, "buyer", caseId, {
        requestId: "reuse",
        expectedRevision: 2,
        body: "Reuse",
        attachmentIds: [own[0].attachment.id],
      })
    ).rejects.toMatchObject({ status: 409 })
  })

  it("rechecks permissions during validation/link/download and keeps organizer-platform files isolated", async () => {
    const failed = upload("support", "revoked", png(), "image/png", caseId, {
      beforeRelease: async () => {
        await db
          .prepare(
            "UPDATE event_permissions SET revoked_at=? WHERE user_id='support'"
          )
          .bind(Date.now())
          .run()
      },
    })
    await expect(failed).rejects.toMatchObject({ status: 404 })
    expect(
      (
        await db
          .prepare(
            "SELECT status FROM support_attachments WHERE upload_request_id='revoked'"
          )
          .first<{ status: string }>()
      )?.status
    ).toBe("rejected")
    expect(
      (await env.FILES.list({ prefix: "private/support-" })).objects
    ).toHaveLength(0)
    await db
      .prepare(
        "UPDATE event_permissions SET revoked_at=NULL WHERE user_id='support'"
      )
      .run()
    const file = await upload("support")
    await expect(
      addSupportMessage(
        db,
        "support",
        caseId,
        {
          requestId: "revoked-link",
          expectedRevision: 1,
          body: "Staff file",
          attachmentIds: [file.attachment.id],
        },
        {
          beforeCommit: async () => {
            await db
              .prepare(
                "UPDATE event_permissions SET revoked_at=? WHERE user_id='support'"
              )
              .bind(Date.now())
              .run()
          },
        }
      )
    ).rejects.toMatchObject({ status: 409 })
    expect((await attachmentRow(db, file.attachment.id)).status).toBe("ready")
    await db
      .prepare(
        "UPDATE event_permissions SET revoked_at=NULL WHERE user_id='support'"
      )
      .run()
    await addSupportMessage(db, "support", caseId, {
      requestId: "staff-link",
      expectedRevision: 1,
      body: "Staff file",
      attachmentIds: [file.attachment.id],
    })
    await expect(
      downloadSupportAttachment(env, "support", caseId, file.attachment.id, {
        beforeReturn: async () => {
          await db
            .prepare(
              "UPDATE event_permissions SET revoked_at=? WHERE user_id='support'"
            )
            .bind(Date.now())
            .run()
        },
      })
    ).rejects.toMatchObject({ status: 404 })
    const platformCase = await createSupportCase(db, "owner", {
      requestId: "platform-case",
      audience: "organizer_platform",
      category: "account",
      subject: "Private platform request",
      eventId: "event",
      body: "Account problem",
    })
    const platformFile = await upload(
      "owner",
      crypto.randomUUID(),
      png(),
      "image/png",
      platformCase.case.id
    )
    await addSupportMessage(db, "owner", platformCase.case.id, {
      requestId: "platform-link",
      expectedRevision: 1,
      body: "Account file",
      attachmentIds: [platformFile.attachment.id],
    })
    await db
      .prepare(
        "UPDATE event_permissions SET revoked_at=NULL WHERE user_id='support'"
      )
      .run()
    await expect(
      downloadSupportAttachment(
        env,
        "support",
        platformCase.case.id,
        platformFile.attachment.id
      )
    ).rejects.toMatchObject({ status: 404 })
    expect(
      (
        await downloadSupportAttachment(
          env,
          "platform",
          platformCase.case.id,
          platformFile.attachment.id
        )
      ).status
    ).toBe(200)
  })

  it("rolls back attachment links when notification/history commit fails and resolves cleanup-versus-link races atomically", async () => {
    const file = await upload()
    const row = await attachmentRow(db, file.attachment.id)
    await db
      .prepare(
        "CREATE TRIGGER fail_attachment_job BEFORE INSERT ON outbox WHEN NEW.kind='support.notify' BEGIN SELECT RAISE(ABORT,'synthetic outbox failure'); END"
      )
      .run()
    await expect(
      addSupportMessage(db, "buyer", caseId, {
        requestId: "failed-job",
        expectedRevision: 1,
        body: "Files",
        attachmentIds: [row.id],
      })
    ).rejects.toThrow()
    expect((await attachmentRow(db, row.id)).status).toBe("ready")
    expect((await listSupportMessages(db, "buyer", caseId)).items).toHaveLength(
      1
    )
    expect(
      await db
        .prepare(
          "SELECT 1 FROM request_receipts WHERE actor_id='buyer' AND request_id='failed-job'"
        )
        .first()
    ).toBeNull()
    await db.prepare("DROP TRIGGER fail_attachment_job").run()
    const results = await Promise.allSettled([
      addSupportMessage(
        db,
        "buyer",
        caseId,
        {
          requestId: "cleanup-race",
          expectedRevision: 1,
          body: "Files",
          attachmentIds: [row.id],
        },
        { now: () => row.expires_at - 1 }
      ),
      cleanupSupportAttachments(env, row.expires_at + 1, row.id),
    ])
    const final = await attachmentRow(db, row.id)
    if (final.status === "attached") {
      expect(results[0].status).toBe("fulfilled")
      expect(await env.FILES.head(row.object_key)).not.toBeNull()
      expect(
        (await listSupportMessages(db, "buyer", caseId)).items
      ).toHaveLength(2)
    } else {
      expect(results[0].status).toBe("rejected")
      expect(final.status).toBe("deleted")
      expect(await env.FILES.head(row.object_key)).toBeNull()
      expect(
        (await listSupportMessages(db, "buyer", caseId)).items
      ).toHaveLength(1)
    }
  })
  it("bounds every PDF raster/predictor, aggregate decoded images and lexical nesting before parsing", async () => {
    for (const kind of [
      "flate-dimensions",
      "raw-dimensions",
      "predictor",
      "inline",
      "subtype",
      "nesting-name",
    ]) {
      const file = await pdf()
      const image = {
        Type: "XObject",
        Subtype: "Image",
        Width: 1,
        Height: 1,
        BitsPerComponent: 8,
        ColorSpace: "DeviceRGB",
      }
      if (kind === "flate-dimensions" || kind === "raw-dimensions")
        image.Width = 1000000
      if (kind === "predictor")
        file.context.register(
          file.context.flateStream(new Uint8Array([0, 1, 2, 3]), {
            ...image,
            DecodeParms: {
              Predictor: 12,
              Columns: 1000000,
              Colors: 3,
              BitsPerComponent: 8,
            },
          })
        )
      else if (kind === "inline")
        file.context.register(
          file.context.stream(
            "BI /W 1000000 /H 1000000 /BPC 8 /CS /RGB ID x EI"
          )
        )
      else if (kind === "subtype")
        file.context.register(file.context.obj({ Subtype: "PS" }))
      else if (kind === "raw-dimensions")
        file.context.register(
          file.context.stream(new Uint8Array([1, 2, 3]), image)
        )
      else if (kind !== "nesting-name")
        file.context.register(
          file.context.flateStream(new Uint8Array([1, 2, 3]), image)
        )
      const bytes =
        kind === "nesting-name"
          ? new TextEncoder().encode(
              `%PDF-1.7\n1 0 obj << /mystream\n ${"[".repeat(65)}0${"]".repeat(65)} endstream null >> endobj\n%%EOF`
            )
          : await file.save({ useObjectStreams: false })
      await expect(
        env.validate(bytes, "application/pdf"),
        kind
      ).rejects.toMatchObject({
        code:
          kind === "subtype"
            ? "PDF_UNSAFE"
            : kind === "inline"
              ? "PDF_UNSUPPORTED"
              : "FILE_COMPLEXITY_LIMIT",
      })
    }
    const many = await pdf()
    const compressed = new Uint8Array(
      encodeJpeg(
        { width: 900, height: 900, data: new Uint8Array(900 * 900 * 4) },
        80
      ).data
    )
    for (let i = 0; i < 9; i++)
      many.context.register(
        many.context.stream(compressed, {
          Type: "XObject",
          Subtype: "Image",
          Width: 900,
          Height: 900,
          BitsPerComponent: 8,
          ColorSpace: "DeviceRGB",
          Filter: "DCTDecode",
        })
      )
    await expect(
      env.validate(
        await many.save({ useObjectStreams: false }),
        "application/pdf"
      )
    ).rejects.toMatchObject({ code: "FILE_COMPLEXITY_LIMIT" })
  })

  it("removes private embedded JPEG/application metadata and preserves the static page and image", async () => {
    const file = await pdf()
    const jpeg = new Uint8Array(
      encodeJpeg(
        {
          width: 2,
          height: 2,
          data: new Uint8Array([
            255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
          ]),
          comments: ["Private embedded GPS marker"],
        },
        90
      ).data
    )
    const embedded = await file.embedJpg(jpeg)
    file
      .getPage(0)
      .drawImage(embedded, { x: 40, y: 620, width: 100, height: 100 })
    file.getPage(0).node.set(
      PDFName.of("PieceInfo"),
      file.context.obj({
        PrivateApplication: PDFString.of("Private application marker"),
      })
    )
    const result = await env.validate(
      await file.save({ useObjectStreams: false }),
      "application/pdf"
    )
    expect(new TextDecoder("latin1").decode(result.bytes)).not.toContain(
      "Private application marker"
    )
    expect(new TextDecoder("latin1").decode(result.bytes)).not.toContain(
      "Private embedded GPS marker"
    )
    const clean = await PDFDocument.load(result.bytes)
    const images = clean.context
      .enumerateIndirectObjects()
      .map(([, object]) => object)
      .filter(
        (object): object is PDFRawStream =>
          object instanceof PDFRawStream &&
          object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")
      )
    expect(images).toHaveLength(1)
    const decoded = decodeJpeg(images[0]!.getContents(), { useTArray: true })
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(2)
    expect(decoded.comments ?? []).toEqual([])
    expect(clean.getPage(0).getSize().width).toBeCloseTo(595.28)
  })

  it("resweeps late raw writes after attachment without deleting the released file", async () => {
    const file = await upload("support")
    const row = await attachmentRow(db, file.attachment.id)
    await addSupportMessage(db, "support", caseId, {
      requestId: "attach-before-late-write",
      expectedRevision: 1,
      body: "Committed screenshot",
      attachmentIds: [row.id],
    })
    const firstSweep = Date.now() + 1
    await cleanupSupportAttachments(env, firstSweep, row.id)
    expect(await env.FILES.head(row.quarantine_key)).toBeNull()
    expect((await attachmentRow(db, row.id)).cleanup_after).toBe(
      firstSweep + 3600000
    )
    await env.FILES.put(row.quarantine_key, new Uint8Array([1, 2, 3]).buffer)
    await db
      .prepare(
        "UPDATE event_permissions SET revoked_at=? WHERE user_id='support'"
      )
      .bind(Date.now())
      .run()
    await cleanupSupportAttachments(env, firstSweep + 3600001, row.id)
    expect(await env.FILES.head(row.quarantine_key)).toBeNull()
    expect(await env.FILES.head(row.object_key)).not.toBeNull()
    expect((await attachmentRow(db, row.id)).status).toBe("attached")
    await expect(
      downloadSupportAttachment(env, "support", caseId, row.id)
    ).rejects.toMatchObject({ status: 404 })
    expect(
      (await downloadSupportAttachment(env, "buyer", caseId, row.id)).status
    ).toBe(200)
  })

  it("rejects unauthenticated/oversized HTTP uploads and quarantined/cross-case links", async () => {
    const endpoint = `https://elc.test/api/support/cases/${caseId}/attachments`
    expect(
      (await env.runtime.dispatchFetch(endpoint, { method: "POST" })).status
    ).toBe(401)
    const cookie = await signIn("buyer")
    const empty = new Request(endpoint, {
      method: "POST",
      body: (() => {
        const form = new FormData()
        form.set("requestId", "empty")
        form.set("file", new Blob([], { type: "image/png" }), "empty.png")
        return form
      })(),
    })
    expect(
      (
        await env.runtime.dispatchFetch(endpoint, {
          method: "POST",
          headers: {
            Cookie: cookie,
            Origin: "https://elc.test",
            "Content-Type": empty.headers.get("Content-Type")!,
          },
          body: await empty.arrayBuffer(),
        })
      ).status
    ).toBe(400)
    expect(
      (
        await env.runtime.dispatchFetch(endpoint, {
          method: "POST",
          headers: {
            Cookie: cookie,
            Origin: "https://elc.test",
            "Content-Type": "multipart/form-data; boundary=test",
          },
          body: new Uint8Array(MAX_ATTACHMENT_BYTES + 65537).buffer,
        })
      ).status
    ).toBe(413)
    expect(
      await db.prepare("SELECT id FROM support_attachments").first()
    ).toBeNull()
    await upload("buyer", "quarantine-proof", png(), "image/png", caseId, {
      validate: async (bytes: Uint8Array, type: string) => {
        const row = await db
          .prepare(
            "SELECT * FROM support_attachments WHERE upload_request_id='quarantine-proof'"
          )
          .first<Awaited<ReturnType<typeof attachmentRow>>>()
        expect(row?.status).toBe("quarantined")
        expect(await env.FILES.head(row!.quarantine_key)).not.toBeNull()
        await expect(
          downloadSupportAttachment(env, "buyer", caseId, row!.id)
        ).rejects.toMatchObject({ status: 404 })
        await expect(
          addSupportMessage(db, "buyer", caseId, {
            requestId: "quarantine-link",
            expectedRevision: 1,
            body: "Premature link",
            attachmentIds: [row!.id],
          })
        ).rejects.toMatchObject({ status: 409 })
        return env.validate(bytes, type)
      },
    })
    const otherCase = await createSupportCase(db, "buyer", {
      requestId: "other-case",
      audience: "attendee",
      category: "technical",
      subject: "Other case",
      eventId: "event",
      body: "Original message",
    })
    const file = await upload(
      "buyer",
      "other-case-upload",
      png(),
      "image/png",
      otherCase.case.id
    )
    await expect(
      addSupportMessage(db, "buyer", caseId, {
        requestId: "cross-case-link",
        expectedRevision: 1,
        body: "Cross-case link",
        attachmentIds: [file.attachment.id],
      })
    ).rejects.toMatchObject({ status: 409 })
  })
})
