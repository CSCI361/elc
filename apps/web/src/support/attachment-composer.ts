import {
  addSupportMessageSchema,
  supportMutationResponseSchema,
  supportUploadResponseSchema,
  type SupportMutationResponse,
  type SupportUploadResponse,
} from "@elc/shared"
import { api, EventApiError, segment } from "../events/api"
import { uploadSupportFile } from "./attachment-api"

type Upload = SupportUploadResponse["attachment"]
export type ComposerFile = {
  key: string
  file: File
  phase:
    | "uploading"
    | "ready"
    | "rejected"
    | "failed"
    | "removing"
    | "remove_failed"
  upload?: Upload
  error?: unknown
}
type Message = ReturnType<typeof addSupportMessageSchema.parse>
type State = {
  body: string
  files: ComposerFile[]
  pending: boolean
  uncertain: boolean
  error?: unknown
  selectionError: boolean
}
export type ComposerDependencies = {
  id: () => string
  upload: typeof uploadSupportFile
  remove: (caseId: string, id: string, signal: AbortSignal) => Promise<unknown>
  send: (
    caseId: string,
    message: Message,
    signal: AbortSignal
  ) => Promise<SupportMutationResponse>
}
const defaults: ComposerDependencies = {
  id: () => crypto.randomUUID(),
  upload: uploadSupportFile,
  remove: (caseId, id, signal) =>
    api(
      `/support/cases/${segment(caseId)}/attachments/${segment(id)}`,
      supportUploadResponseSchema,
      { method: "DELETE", signal }
    ),
  send: (caseId, message, signal) =>
    api(
      `/support/cases/${segment(caseId)}/messages`,
      supportMutationResponseSchema,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
        signal,
      }
    ),
}

/** One mounted account/case composer owns its files and exact uncertain message. */
export class AttachmentComposer {
  private state: State = {
    body: "",
    files: [],
    pending: false,
    uncertain: false,
    selectionError: false,
  }
  private listeners = new Set<() => void>()
  private controllers = new Set<AbortController>()
  private generation = 0
  private sealed: Message | null = null
  readonly caseId: string
  private readonly dependencies: ComposerDependencies
  constructor(caseId: string, dependencies: ComposerDependencies = defaults) {
    this.caseId = caseId
    this.dependencies = dependencies
  }
  snapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private update(change: Partial<State>) {
    this.state = { ...this.state, ...change }
    for (const listener of this.listeners) listener()
  }
  private replace(key: string, change: Partial<ComposerFile>) {
    this.update({
      files: this.state.files.map((file) =>
        file.key === key ? { ...file, ...change } : file
      ),
    })
  }
  cancel = () => {
    this.generation++
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
  }
  setBody(body: string) {
    if (!this.state.pending && !this.state.uncertain) this.update({ body })
  }
  add(files: File[]) {
    if (this.state.pending || this.state.uncertain) return
    const capacity = Math.max(0, 3 - this.state.files.length)
    const selected = files.slice(0, capacity).map((file) => ({
      key: this.dependencies.id(),
      file,
      phase: "failed" as const,
    }))
    this.update({
      files: [...this.state.files, ...selected],
      selectionError: files.length > capacity,
    })
    for (const file of selected) void this.upload(file.key)
  }
  async upload(key: string) {
    const file = this.state.files.find((item) => item.key === key)
    if (
      !file ||
      file.phase !== "failed" ||
      this.state.pending ||
      this.state.uncertain
    )
      return
    const controller = new AbortController(),
      generation = this.generation
    this.controllers.add(controller)
    this.replace(key, { phase: "uploading", error: undefined })
    try {
      const upload = await this.dependencies.upload(
        this.caseId,
        key,
        file.file,
        controller.signal
      )
      if (generation !== this.generation) return
      if (upload.status === "ready")
        this.replace(key, { upload, phase: "ready" })
      else if (upload.status === "rejected")
        this.replace(key, { upload, phase: "rejected" })
      else
        this.replace(key, {
          upload,
          phase: "failed",
          error: new EventApiError("CONFLICT", 409),
        })
    } catch (error) {
      if (generation === this.generation)
        this.replace(key, { phase: "failed", error })
    } finally {
      this.controllers.delete(controller)
    }
  }
  async remove(key: string) {
    const file = this.state.files.find((item) => item.key === key)
    if (
      !file ||
      ["uploading", "removing"].includes(file.phase) ||
      this.state.pending ||
      this.state.uncertain
    )
      return
    const controller = new AbortController(),
      generation = this.generation
    this.controllers.add(controller)
    this.replace(key, { phase: "removing", error: undefined })
    try {
      if (file.upload)
        await this.dependencies.remove(
          this.caseId,
          file.upload.id,
          controller.signal
        )
      if (generation === this.generation)
        this.update({
          files: this.state.files.filter((item) => item.key !== key),
          selectionError: false,
        })
    } catch (error) {
      if (generation === this.generation)
        this.replace(key, { phase: "remove_failed", error })
    } finally {
      this.controllers.delete(controller)
    }
  }
  async send(revision: number) {
    if (
      this.state.pending ||
      this.state.files.some((file) => file.phase !== "ready")
    )
      return
    const parsed = addSupportMessageSchema.safeParse(
      this.sealed ?? {
        requestId: this.dependencies.id(),
        expectedRevision: revision,
        body: this.state.body,
        attachmentIds: this.state.files.map((file) => file.upload!.id),
      }
    )
    if (!parsed.success) {
      this.update({ error: new EventApiError("INVALID_INPUT", 400) })
      return
    }
    this.sealed = parsed.data
    const controller = new AbortController(),
      generation = this.generation
    this.controllers.add(controller)
    this.update({ pending: true, error: undefined })
    try {
      const result = await this.dependencies.send(
        this.caseId,
        this.sealed,
        controller.signal
      )
      if (generation !== this.generation) return
      this.sealed = null
      this.update({
        body: "",
        files: [],
        pending: false,
        uncertain: false,
        selectionError: false,
      })
      return result
    } catch (error) {
      if (generation !== this.generation) return
      const definitive =
        error instanceof EventApiError &&
        error.status >= 400 &&
        error.status < 500
      if (definitive) this.sealed = null
      this.update({ pending: false, uncertain: !definitive, error })
    } finally {
      this.controllers.delete(controller)
    }
  }
}
