import { afterEach, describe, expect, it, vi } from "vite-plus/test"
import type {
  SupportMutationResponse,
  SupportUploadResponse,
} from "@elc/shared"
import { EventApiError } from "../events/api"
import {
  AttachmentComposer,
  type ComposerDependencies,
} from "./attachment-composer"
import { uploadSupportFile } from "./attachment-api"
import { attachmentErrorKey, attachmentText } from "./attachment-messages"

const file = () =>
  new File(["synthetic image"], "image.png", { type: "image/png" })
const ready = (id = "upload"): SupportUploadResponse["attachment"] => ({
  id,
  caseId: "case",
  fileName: "image.png",
  status: "ready",
  contentType: "image/png",
  size: 15,
  errorCode: null,
  expiresAt: "2026-09-15T00:00:00.000Z",
})
const saved = {
  case: { id: "case" },
  change: { id: "change" },
} as SupportMutationResponse
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function fixture() {
  let sequence = 0
  const dependencies = {
    id: () => `request-${++sequence}`,
    upload: vi.fn<ComposerDependencies["upload"]>(async () => ready()),
    remove: vi.fn<ComposerDependencies["remove"]>(async () => undefined),
    send: vi.fn<ComposerDependencies["send"]>(async () => saved),
  }
  return { model: new AttachmentComposer("case", dependencies), dependencies }
}
afterEach(() => vi.unstubAllGlobals())

describe("support attachment composer recovery", () => {
  it("blocks message submission while upload is unsettled, and commits only returned ready references", async () => {
    const { model, dependencies } = fixture(),
      pending = deferred<ReturnType<typeof ready>>()
    dependencies.upload.mockReturnValueOnce(pending.promise)
    model.setBody("Please inspect this file")
    model.add([file()])
    await model.send(2)
    expect(dependencies.send).not.toHaveBeenCalled()
    pending.resolve(ready("validated"))
    await settle()
    await model.send(2)
    expect(dependencies.send).toHaveBeenCalledWith(
      "case",
      expect.objectContaining({
        expectedRevision: 2,
        body: "Please inspect this file",
        attachmentIds: ["validated"],
      }),
      expect.any(AbortSignal)
    )
    expect(model.snapshot()).toMatchObject({
      body: "",
      files: [],
      uncertain: false,
    })
  })
  it("retries an uncertain message with its exact ID, revision, body and uploaded references despite live refresh", async () => {
    const { model, dependencies } = fixture()
    model.setBody("Original message")
    model.add([file()])
    await settle()
    dependencies.send.mockRejectedValueOnce(
      new TypeError("Response lost after commit")
    )
    await model.send(2)
    const first = dependencies.send.mock.calls[0]
    expect(model.snapshot().uncertain).toBe(true)
    model.setBody("Changed message")
    model.add([file()])
    await model.remove("request-1")
    await model.send(8)
    expect(dependencies.send.mock.calls[1]?.slice(0, 2)).toEqual(
      first?.slice(0, 2)
    )
    expect(dependencies.upload).toHaveBeenCalledTimes(1)
    expect(dependencies.remove).not.toHaveBeenCalled()
  })
  it("preserves uploaded files after a definite revision conflict and uses refreshed revision for a new request", async () => {
    const { model, dependencies } = fixture()
    model.setBody("Reply")
    model.add([file()])
    await settle()
    dependencies.send.mockRejectedValueOnce(new EventApiError("CONFLICT", 409))
    await model.send(1)
    expect(model.snapshot()).toMatchObject({
      body: "Reply",
      uncertain: false,
      files: [{ phase: "ready" }],
    })
    await model.send(3)
    const requests = dependencies.send.mock.calls.map(
      (call) =>
        (call as unknown[])[1] as {
          requestId: string
          expectedRevision: number
          attachmentIds: string[]
        }
    )
    expect(requests[1]).toMatchObject({
      expectedRevision: 3,
      attachmentIds: ["upload"],
    })
    expect(requests[1]?.requestId).not.toBe(requests[0]?.requestId)
  })
  it("retries identical upload bytes with the same request ID", async () => {
    const { model, dependencies } = fixture()
    dependencies.upload.mockRejectedValueOnce(new TypeError("Connection lost"))
    model.add([file()])
    await settle()
    await model.upload("request-1")
    expect(dependencies.upload.mock.calls[1]?.slice(0, 3)).toEqual(
      dependencies.upload.mock.calls[0]?.slice(0, 3)
    )
    expect(model.snapshot().files[0]?.phase).toBe("ready")
  })
  it("keeps an uncertain removal out of a message until its idempotent retry succeeds", async () => {
    const { model, dependencies } = fixture()
    model.setBody("Reply")
    model.add([file()])
    await settle()
    dependencies.remove.mockRejectedValueOnce(
      new TypeError("Lost removal result")
    )
    await model.remove("request-1")
    await model.send(1)
    expect(dependencies.send).not.toHaveBeenCalled()
    expect(model.snapshot().files[0]).toMatchObject({
      phase: "remove_failed",
      upload: { id: "upload" },
    })
    await model.remove("request-1")
    expect(model.snapshot().files).toEqual([])
  })
  it("requires rejected file removal and enforces three selected files", async () => {
    const { model, dependencies } = fixture()
    dependencies.upload.mockResolvedValue({
      ...ready(),
      status: "rejected",
      errorCode: "PDF_UNSAFE",
    })
    model.setBody("Reply")
    model.add([file(), file(), file(), file()])
    await settle()
    expect(dependencies.upload).toHaveBeenCalledTimes(3)
    expect(model.snapshot().selectionError).toBe(true)
    await model.send(1)
    expect(dependencies.send).not.toHaveBeenCalled()
    await model.upload("request-1")
    expect(dependencies.upload).toHaveBeenCalledTimes(3)
  })
  it("does not publish a late upload into a discarded or different case composer", async () => {
    const { model, dependencies } = fixture(),
      pending = deferred<ReturnType<typeof ready>>()
    dependencies.upload.mockReturnValueOnce(pending.promise)
    model.add([file()])
    model.cancel()
    const other = new AttachmentComposer("other", dependencies)
    pending.resolve(ready())
    await settle()
    expect(model.snapshot().files[0]?.phase).toBe("uploading")
    expect(other.snapshot().files).toEqual([])
  })
})
describe("attachment HTTP and translated file errors", () => {
  it("reads the authoritative per-file rejection on HTTP 422 with authenticated multipart", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            attachment: {
              ...ready(),
              status: "rejected",
              errorCode: "PDF_UNSAFE",
            },
          }),
          { status: 422 }
        )
    )
    vi.stubGlobal("fetch", fetcher)
    const result = await uploadSupportFile(
      "case",
      "same-request",
      file(),
      new AbortController().signal
    )
    expect(result.errorCode).toBe("PDF_UNSAFE")
    const options = (fetcher.mock.calls[0] as unknown[])[1] as RequestInit
    expect(options.credentials).toBe("same-origin")
    expect((options.body as FormData).get("requestId")).toBe("same-request")
  })
  it("keeps every server rejection code and visible limit translated in KK/RU/EN", () => {
    for (const code of [
      "FILE_TOO_LARGE",
      "FILE_TYPE_UNSUPPORTED",
      "FILE_TYPE_MISMATCH",
      "FILE_INVALID",
      "FILE_COMPLEXITY_LIMIT",
      "PDF_UNSAFE",
      "PDF_UNSUPPORTED",
    ]) {
      const key = attachmentErrorKey(undefined, code)
      expect(key).toBe(code)
      for (const locale of ["kk", "ru", "en"] as const)
        expect(attachmentText(locale, key).length).toBeGreaterThan(15)
    }
    for (const locale of ["kk", "ru", "en"] as const)
      expect(attachmentText(locale, "limits")).toMatch(
        /JPEG.*PNG.*PDF.*5 MiB.*3/
      )
  })
})
