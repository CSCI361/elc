import {
  AttachmentValidationError,
  invalid,
  sizeChecked,
  type AttachmentMime,
} from "./limits"
import { sanitizeJpeg, sanitizePng } from "./images"
import { sanitizePdf } from "./pdf"

export async function validateAttachment(
  bytes: Uint8Array,
  declaredType: string
): Promise<{ bytes: Uint8Array; contentType: AttachmentMime }> {
  sizeChecked(bytes)
  if (!["image/jpeg", "image/png", "application/pdf"].includes(declaredType))
    invalid("FILE_TYPE_UNSUPPORTED")
  const detected =
    bytes[0] === 255 && bytes[1] === 216
      ? "image/jpeg"
      : bytes[0] === 137 && bytes[1] === 80
        ? "image/png"
        : bytes[0] === 37 &&
            bytes[1] === 80 &&
            bytes[2] === 68 &&
            bytes[3] === 70
          ? "application/pdf"
          : null
  if (detected !== declaredType) invalid("FILE_TYPE_MISMATCH")
  try {
    return {
      bytes:
        detected === "image/jpeg"
          ? sanitizeJpeg(bytes)
          : detected === "image/png"
            ? sanitizePng(bytes)
            : await sanitizePdf(bytes),
      contentType: detected,
    }
  } catch (error) {
    if (error instanceof AttachmentValidationError) throw error
    invalid()
  }
}
