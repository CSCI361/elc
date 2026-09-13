import { ApiFailure } from "../../db/transitions"
import { sanitizeJpeg, sanitizePng } from "../../support/attachments/images"
import {
  AttachmentValidationError,
  sizeChecked,
} from "../../support/attachments/limits"

export const MAX_EVENT_IMAGES = 5
export const IMAGE_UPLOAD_LIFETIME = 23 * 60 * 60_000
export const IMAGE_LEASE_MS = 60_000
export const IMAGE_VALIDATOR_VERSION = "event-image-v1"

/** Raw bytes remain in request memory. Only a fully parsed, re-encoded image reaches R2. */
export function validateEventImage(bytes: Uint8Array, contentType: string) {
  try {
    sizeChecked(bytes)
    if (contentType !== "image/jpeg" && contentType !== "image/png")
      throw new AttachmentValidationError("FILE_TYPE_UNSUPPORTED")
    return {
      bytes:
        contentType === "image/jpeg" ? sanitizeJpeg(bytes) : sanitizePng(bytes),
      contentType,
    }
  } catch (error) {
    if (error instanceof AttachmentValidationError)
      throw new ApiFailure(
        "ATTACHMENT_REJECTED",
        error.code === "FILE_TOO_LARGE" ? 413 : 400,
        error.code
      )
    throw error
  }
}
export async function imageDigest(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer)
    )
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}
