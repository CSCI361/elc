import type { EventApi, EventImage } from "@elc/shared"
import { TicketIcon } from "@phosphor-icons/react"
import { useState } from "react"
import { segment } from "./api"
import { useImageText } from "./image-messages"
import "./image.css"

export function EventImageView({
  eventId,
  image,
  eager = false,
}: {
  eventId: string
  image: EventImage
  eager?: boolean
}) {
  const { t } = useImageText()
  const [failed, setFailed] = useState(false)
  const expected = `/api/events/${segment(eventId)}/images/${segment(image.id)}`
  if (failed || image.url !== expected)
    return (
      <div
        className="event-image-fallback"
        role="img"
        aria-label={`${t("failedImage")}: ${image.altText}`}
      >
        <TicketIcon aria-hidden size={36} />
        <span>{t("failedImage")}</span>
      </div>
    )
  return (
    <img
      src={image.url}
      alt={image.altText}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}

export function EventImageCover({ event }: { event: EventApi }) {
  const cover = event.images[0]
  return cover ? (
    <div className="event-image-cover">
      <EventImageView key={cover.url} eventId={event.id} image={cover} />
    </div>
  ) : null
}

export function EventHero({ event }: { event: EventApi }) {
  const cover = event.images[0]
  return (
    <div className="event-hero">
      {cover ? (
        <EventImageView
          key={cover.url}
          eventId={event.id}
          image={cover}
          eager
        />
      ) : (
        <div className="event-hero-placeholder" aria-hidden>
          <TicketIcon size={56} weight="light" />
        </div>
      )}
    </div>
  )
}

export function EventImageGallery({
  event,
  skipCover = false,
}: {
  event: EventApi
  skipCover?: boolean
}) {
  const { t } = useImageText()
  const images = skipCover ? event.images.slice(1) : event.images
  if (!images.length) return null
  return (
    <section className="event-image-gallery" aria-label={t("gallery")}>
      {images.map((image, index) => (
        <figure
          key={image.id}
          className={index === 0 && !skipCover ? "event-image-main" : undefined}
        >
          <EventImageView
            key={image.url}
            eventId={event.id}
            image={image}
            eager={index === 0 && !skipCover}
          />
        </figure>
      ))}
    </section>
  )
}
