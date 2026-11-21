import {
  eventDetailResponseSchema,
  eventImageAltTextSchema,
  eventImageLimits,
  eventMutationResponseSchema,
  updateEventImagesRequestSchema,
  type EventApi,
  type EventImage,
} from "@elc/shared"
import { ImageIcon, UploadSimpleIcon } from "@phosphor-icons/react"
import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { api, EventApiError, segment } from "./api"
import { EventError, Field } from "./ui"
import { EventImageView } from "./image-gallery"
import { useImageText } from "./image-messages"
import "./image.css"

type Detail = ReturnType<typeof eventDetailResponseSchema.parse>
type GalleryItem = Pick<EventImage, "id" | "altText">
type Operation = {
  requestId: string
  expectedRevision: number
  signature: string
  resultRevision?: number
} & (
  | { kind: "upload"; file: File; altText: string }
  | { kind: "gallery"; images: GalleryItem[] }
)
const galleryValue = (images: GalleryItem[]) =>
  images.map(({ id, altText }) => ({ id, altText }))

function SelectedImage({ url }: { url: string }) {
  const { t } = useImageText()
  const [failed, setFailed] = useState(false)
  return failed ? (
    <p role="status">{t("invalidImage")}</p>
  ) : (
    <img
      className="event-image-upload-preview"
      src={url}
      alt={t("preview")}
      onError={() => setFailed(true)}
    />
  )
}

export function ImageDraftHint() {
  const { t } = useImageText()
  return <p className="event-inline-note">{t("draftFirst")}</p>
}

export function EventImagePanel({
  event,
  onChanged,
  onDenied,
}: {
  event: EventApi
  onChanged: (detail: Detail) => void
  onDenied: () => void
}) {
  const { t } = useImageText()
  const [baseline, setBaseline] = useState(event)
  const [images, setImages] = useState(event.images)
  const [selected, setSelected] = useState<{
    file: File
    token: string
    url: string
  } | null>(null)
  const [altText, setAltText] = useState("")
  const [pending, setPending] = useState(false)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [validation, setValidation] = useState<
    "invalidFile" | "invalidAlt" | null
  >(null)
  const [saved, setSaved] = useState(false)
  const [denied, setDenied] = useState(false)
  const [retryAvailable, setRetryAvailable] = useState(false)
  const busy = useRef(false)
  const alive = useRef(true)
  const controller = useRef<AbortController | null>(null)
  const operation = useRef<Operation | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const imageHeadings = useRef(new Map<string, HTMLParagraphElement>())
  const focusImage = useRef<string | null>(null)
  const focusGallery = useRef(false)
  const id = useId()
  const dirty =
    JSON.stringify(galleryValue(images)) !==
    JSON.stringify(galleryValue(baseline.images))
  const stale = event.revision > baseline.revision
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      controller.current?.abort()
    }
  }, [])
  useEffect(() => {
    if (!selected) return
    return () => URL.revokeObjectURL(selected.url)
  }, [selected])
  useEffect(() => {
    if (focusImage.current)
      imageHeadings.current.get(focusImage.current)?.focus()
    focusImage.current = null
    if (focusGallery.current) heading.current?.focus()
    focusGallery.current = false
  }, [images])

  function changed() {
    operation.current = null
    setRetryAvailable(false)
    setError(null)
    setValidation(null)
    setSaved(false)
  }
  function accept(detail: Detail) {
    setBaseline(detail.event)
    setImages(detail.event.images)
    setSelected(null)
    setAltText("")
    setNeedsRefresh(false)
    setError(null)
    setValidation(null)
    operation.current = null
    setRetryAvailable(false)
    if (fileInput.current) fileInput.current.value = ""
    onChanged(detail)
  }
  async function readLatest(signal: AbortSignal, minimumRevision = 0) {
    const detail = await api(
      `/events/${segment(event.id)}/preview`,
      eventDetailResponseSchema,
      { signal }
    )
    if (detail.event.id !== event.id || detail.event.revision < minimumRevision)
      throw new EventApiError("INVALID_RESPONSE", 502)
    return detail
  }
  function failed(failure: unknown) {
    setError(failure)
    if (
      failure instanceof EventApiError &&
      [401, 403, 404].includes(failure.status)
    ) {
      setDenied(true)
      onDenied()
    }
  }
  async function execute(current: Operation) {
    if (busy.current) return
    busy.current = true
    setRetryAvailable(true)
    setPending(true)
    setError(null)
    setSaved(false)
    const request = new AbortController()
    controller.current = request
    try {
      if (current.resultRevision === undefined) {
        const path = `/events/${segment(event.id)}/images`
        let options: RequestInit
        if (current.kind === "upload") {
          const body = new FormData()
          body.set("file", current.file)
          body.set("requestId", current.requestId)
          body.set("expectedRevision", String(current.expectedRevision))
          body.set("altText", current.altText)
          options = { method: "POST", body }
        } else
          options = {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              requestId: current.requestId,
              expectedRevision: current.expectedRevision,
              images: current.images,
            }),
          }
        const result = await api(path, eventMutationResponseSchema, {
          ...options,
          signal: request.signal,
        })
        if (
          result.eventId !== event.id ||
          result.revision <= current.expectedRevision
        )
          throw new EventApiError("INVALID_RESPONSE", 502)
        current.resultRevision = result.revision
        if (alive.current) setNeedsRefresh(true)
      }
      const fresh = await readLatest(request.signal, current.resultRevision)
      if (request.signal.aborted || !alive.current) return
      accept(fresh)
      setSaved(true)
      heading.current?.focus()
    } catch (failure) {
      if (!request.signal.aborted && alive.current) failed(failure)
    } finally {
      busy.current = false
      if (alive.current) setPending(false)
    }
  }
  async function reload() {
    if (busy.current) return
    busy.current = true
    setPending(true)
    const request = new AbortController()
    controller.current = request
    try {
      const fresh = await readLatest(
        request.signal,
        operation.current?.resultRevision
      )
      if (!request.signal.aborted && alive.current) {
        accept(fresh)
        setSaved(false)
        heading.current?.focus()
      }
    } catch (failure) {
      if (!request.signal.aborted && alive.current) failed(failure)
    } finally {
      busy.current = false
      if (alive.current) setPending(false)
    }
  }
  function upload(submission: FormEvent<HTMLFormElement>) {
    submission.preventDefault()
    if (!selected || dirty || stale || needsRefresh || busy.current) return
    const parsed = eventImageAltTextSchema.safeParse(altText)
    if (!parsed.success) {
      setValidation("invalidAlt")
      return
    }
    const signature = JSON.stringify({
      kind: "upload",
      file: selected.token,
      altText: parsed.data,
      expectedRevision: baseline.revision,
    })
    if (operation.current?.signature !== signature)
      operation.current = {
        kind: "upload",
        signature,
        file: selected.file,
        altText: parsed.data,
        expectedRevision: baseline.revision,
        requestId: crypto.randomUUID(),
      }
    void execute(operation.current)
  }
  function saveGallery(submission: FormEvent<HTMLFormElement>) {
    submission.preventDefault()
    if (!dirty || stale || needsRefresh || busy.current) return
    const parsed = updateEventImagesRequestSchema.safeParse({
      requestId: "validate",
      expectedRevision: baseline.revision,
      images: galleryValue(images),
    })
    if (!parsed.success) {
      setValidation("invalidAlt")
      return
    }
    const signature = JSON.stringify({
      kind: "gallery",
      expectedRevision: baseline.revision,
      images: parsed.data.images,
    })
    if (operation.current?.signature !== signature)
      operation.current = {
        kind: "gallery",
        signature,
        expectedRevision: baseline.revision,
        images: parsed.data.images,
        requestId: crypto.randomUUID(),
      }
    void execute(operation.current)
  }
  function move(imageId: string, offset: number) {
    const index = images.findIndex((image) => image.id === imageId)
    if (index < 0 || index + offset < 0 || index + offset >= images.length)
      return
    changed()
    const next = [...images]
    const [item] = next.splice(index, 1)
    next.splice(index + offset, 0, item!)
    focusImage.current = imageId
    setImages(next)
  }
  if (denied) return <EventError error={error} retry={onDenied} />
  const disabled = pending || needsRefresh || stale
  return (
    <section
      className="event-panel event-image-panel"
      aria-labelledby={`${id}-heading`}
    >
      <h2 id={`${id}-heading`} ref={heading} tabIndex={-1}>
        {t("title")}
      </h2>
      <p>{t("intro")}</p>
      <p id={`${id}-limits`} className="field-hint">
        {t("limits")}
      </p>
      {saved ? (
        <p className="event-inline-note" role="status">
          {t("saved")}
        </p>
      ) : null}
      {pending ? <p role="status">{t("uploading")}</p> : null}
      {validation ? <p role="alert">{t(validation)}</p> : null}
      {error ? (
        <div className="event-image-error">
          {needsRefresh ? (
            <p role="alert">{t("refreshFailed")}</p>
          ) : error instanceof EventApiError &&
            error.code === "ATTACHMENT_REJECTED" ? (
            <p role="alert">
              {t(error.status === 413 ? "invalidFile" : "invalidImage")}
            </p>
          ) : (
            <EventError error={error} />
          )}
          <p>{t("retryHint")}</p>
          {retryAvailable ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                if (operation.current) void execute(operation.current)
              }}
            >
              {t("retry")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {stale ? <p role="status">{t("changed")}</p> : null}
      <form onSubmit={saveGallery}>
        <fieldset disabled={disabled}>
          {images.length ? (
            <ol className="event-image-editor-list">
              {images.map((image, index) => (
                <li key={image.id}>
                  <div className="event-image-editor-preview">
                    <EventImageView
                      eventId={event.id}
                      image={image}
                      key={image.url}
                    />
                  </div>
                  <div className="event-image-editor-fields">
                    <p
                      className="event-image-position"
                      tabIndex={-1}
                      ref={(element) => {
                        if (element)
                          imageHeadings.current.set(image.id, element)
                        else imageHeadings.current.delete(image.id)
                      }}
                    >
                      {index + 1} / {images.length}
                      {index === 0 ? ` · ${t("cover")}` : ""}
                    </p>
                    <Field
                      label={t("alt")}
                      hint={t("altHint")}
                      required
                      maxLength={eventImageLimits.altText}
                      value={image.altText}
                      onChange={(input) => {
                        changed()
                        setImages((value) =>
                          value.map((item) =>
                            item.id === image.id
                              ? { ...item, altText: input.target.value }
                              : item
                          )
                        )
                      }}
                    />
                    <div className="event-image-actions">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={index === 0}
                        aria-label={`${t("earlier")}: ${image.altText}`}
                        onClick={() => move(image.id, -1)}
                      >
                        {t("earlier")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={index === images.length - 1}
                        aria-label={`${t("later")}: ${image.altText}`}
                        onClick={() => move(image.id, 1)}
                      >
                        {t("later")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        aria-label={`${t("remove")}: ${image.altText}`}
                        onClick={() => {
                          changed()
                          const next = images.filter(
                            (item) => item.id !== image.id
                          )
                          focusImage.current =
                            next[Math.min(index, next.length - 1)]?.id ?? null
                          focusGallery.current = next.length === 0
                          setImages(next)
                        }}
                      >
                        {t("remove")}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState icon={ImageIcon} title={t("empty")} inline />
          )}
          {dirty ? (
            <p className="field-hint" role="status">
              {t("unsaved")}
            </p>
          ) : null}
          <Button type="submit" disabled={!dirty}>
            {t("save")}
          </Button>
        </fieldset>
      </form>
      <form className="event-image-upload" onSubmit={upload}>
        <fieldset
          disabled={
            disabled ||
            dirty ||
            baseline.images.length >= eventImageLimits.count
          }
        >
          <label className="event-field file-picker" htmlFor={`${id}-file`}>
            <span>{t("choose")}</span>
            <input
              id={`${id}-file`}
              ref={fileInput}
              className="file-picker-input"
              type="file"
              accept="image/jpeg,image/png"
              aria-describedby={`${id}-limits`}
              onChange={(input) => {
                changed()
                const file = input.target.files?.[0]
                if (!file) {
                  setSelected(null)
                  return
                }
                if (
                  !["image/jpeg", "image/png"].includes(file.type) ||
                  !file.size ||
                  file.size > eventImageLimits.fileBytes
                ) {
                  setSelected(null)
                  setValidation("invalidFile")
                  input.target.value = ""
                  return
                }
                setSelected({
                  file,
                  token: crypto.randomUUID(),
                  url: URL.createObjectURL(file),
                })
              }}
            />
            <span className="file-picker-box">
              <UploadSimpleIcon size={20} aria-hidden />
              <span>{selected ? selected.file.name : t("pickFile")}</span>
            </span>
          </label>
          {selected ? (
            <SelectedImage key={selected.token} url={selected.url} />
          ) : null}
          <Field
            label={t("alt")}
            hint={t("altHint")}
            required
            maxLength={eventImageLimits.altText}
            value={altText}
            onChange={(input) => {
              changed()
              setAltText(input.target.value)
            }}
          />
          <div className="event-image-actions">
            <Button type="submit" disabled={!selected}>
              {t("upload")}
            </Button>
            {selected ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  changed()
                  setSelected(null)
                  setAltText("")
                  if (fileInput.current) fileInput.current.value = ""
                }}
              >
                {t("clear")}
              </Button>
            ) : null}
          </div>
        </fieldset>
        {dirty ? <p className="field-hint">{t("saveFirst")}</p> : null}
        {baseline.images.length >= eventImageLimits.count ? (
          <p className="field-hint">{t("full")}</p>
        ) : null}
      </form>
      <div className="event-image-reload">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => void reload()}
        >
          {t("reload")}
        </Button>
        <p className="field-hint">{t("reloadHint")}</p>
      </div>
    </section>
  )
}
