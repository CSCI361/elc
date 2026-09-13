export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 4_000_000
export const MAX_IMAGE_EDGE = 8192
export const MAX_PDF_OBJECTS = 4000
export const MAX_PDF_PAGES = 50
export const MAX_PDF_STREAM_BYTES = 8 * 1024 * 1024
export const MAX_PDF_EXPANDED_BYTES = 24 * 1024 * 1024
export const ATTACHMENT_VALIDATOR_VERSION = "support-static-v1"
export const ABANDONED_UPLOAD_MS = 23 * 60 * 60 * 1000
export type AttachmentMime = "image/jpeg" | "image/png" | "application/pdf"
export type AttachmentErrorCode =
  | "FILE_TOO_LARGE"
  | "FILE_TYPE_UNSUPPORTED"
  | "FILE_TYPE_MISMATCH"
  | "FILE_INVALID"
  | "FILE_COMPLEXITY_LIMIT"
  | "PDF_UNSAFE"
  | "PDF_UNSUPPORTED"
export class AttachmentValidationError extends Error {
  readonly code: AttachmentErrorCode
  constructor(code: AttachmentErrorCode) {
    super(code)
    this.code = code
  }
}
export function invalid(code: AttachmentErrorCode = "FILE_INVALID"): never {
  throw new AttachmentValidationError(code)
}
export function imageDimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  )
    invalid()
  if (
    width > MAX_IMAGE_EDGE ||
    height > MAX_IMAGE_EDGE ||
    width * height > MAX_IMAGE_PIXELS
  )
    invalid("FILE_COMPLEXITY_LIMIT")
}
export function sizeChecked(bytes: Uint8Array) {
  if (!bytes.length) invalid()
  if (bytes.length > MAX_ATTACHMENT_BYTES) invalid("FILE_TOO_LARGE")
  return bytes
}
