import { inflateSync } from "node:zlib"
import { decode as decodeJpeg, encode as encodeJpeg } from "jpeg-js"
import {
  convertIndexedToRgb,
  decode as decodePng,
  encode as encodePng,
} from "fast-png"
import {
  imageDimensions,
  invalid,
  MAX_IMAGE_PIXELS,
  sizeChecked,
} from "./limits"

const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const ascii = new TextDecoder("latin1")
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function concatenate(parts: Uint8Array[]) {
  const result = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0)
  )
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

/** Validate the complete envelope before a codec sees dimensions or compressed metadata. */
function pngEnvelope(bytes: Uint8Array) {
  if (!pngSignature.every((byte, index) => bytes[index] === byte))
    invalid("FILE_TYPE_MISMATCH")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const retained: Uint8Array[] = [pngSignature]
  const idat: Uint8Array[] = []
  let offset = 8
  let width = 0,
    height = 0,
    channels = 0,
    depth = 0,
    color = -1
  let dataEnded = false,
    ended = false,
    palette = false,
    transparency = false
  let chunks = 0
  while (offset < bytes.length) {
    if (++chunks > 4096) invalid("FILE_COMPLEXITY_LIMIT")
    if (offset + 12 > bytes.length) invalid()
    const length = view.getUint32(offset)
    const end = offset + length + 12
    if (end > bytes.length) invalid()
    const name = ascii.decode(bytes.subarray(offset + 4, offset + 8))
    if (!/^[A-Za-z]{4}$/.test(name) || (bytes[offset + 6]! & 32) !== 0)
      invalid()
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4))
      invalid()
    if (chunks === 1 && name !== "IHDR") invalid()
    if (name === "IHDR") {
      if (chunks !== 1 || length !== 13) invalid()
      width = view.getUint32(offset + 8)
      height = view.getUint32(offset + 12)
      imageDimensions(width, height)
      depth = bytes[offset + 16]!
      color = bytes[offset + 17]!
      channels =
        ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color] ?? 0
      if (
        !channels ||
        (color === 3 ? ![1, 2, 4, 8].includes(depth) : depth !== 8) ||
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 ||
        bytes[offset + 20] !== 0
      )
        invalid("FILE_TYPE_UNSUPPORTED")
    } else if (name === "IDAT") {
      if (dataEnded || (color === 3 && !palette)) invalid()
      idat.push(bytes.subarray(offset + 8, end - 4))
    } else {
      if (idat.length) dataEnded = true
      if (name === "PLTE") {
        if (
          palette ||
          idat.length ||
          !length ||
          length > 768 ||
          length % 3 ||
          color === 0 ||
          color === 4
        )
          invalid()
        palette = true
      } else if (name === "tRNS") {
        if (
          transparency ||
          idat.length ||
          (color === 3 && (!palette || !length || length > 256)) ||
          (color === 0 && length !== 2) ||
          (color === 2 && length !== 6) ||
          color === 4 ||
          color === 6
        )
          invalid()
        transparency = true
      } else if (name === "IEND") {
        if (length || !idat.length || end !== bytes.length) invalid()
        ended = true
      } else if (
        ["acTL", "fcTL", "fdAT"].includes(name) ||
        (bytes[offset + 4]! & 32) === 0
      )
        invalid("FILE_TYPE_UNSUPPORTED")
    }
    if (["IHDR", "PLTE", "tRNS", "IDAT", "IEND"].includes(name))
      retained.push(bytes.subarray(offset, end))
    offset = end
  }
  if (!ended) invalid()
  const expected = (Math.ceil((width * channels * depth) / 8) + 1) * height
  try {
    const expanded = inflateSync(concatenate(idat), {
      maxOutputLength: expected + 1,
    })
    if (expanded.length !== expected) invalid()
  } catch {
    invalid("FILE_COMPLEXITY_LIMIT")
  }
  return concatenate(retained)
}

export function sanitizePng(bytes: Uint8Array) {
  const decoded = decodePng(pngEnvelope(sizeChecked(bytes)), { checkCrc: true })
  const indexed = Boolean(decoded.palette)
  const pixels = indexed ? convertIndexedToRgb(decoded) : decoded.data
  const channels = indexed ? decoded.palette![0]!.length : decoded.channels
  if (
    !(pixels instanceof Uint8Array) ||
    pixels.length !== decoded.width * decoded.height * channels
  )
    invalid()
  const rgba = new Uint8Array(decoded.width * decoded.height * 4)
  for (let i = 0, out = 0; i < pixels.length; i += channels, out += 4) {
    const gray = !indexed && channels <= 2
    rgba[out] = pixels[i]!
    rgba[out + 1] = pixels[i + (gray ? 0 : 1)]!
    rgba[out + 2] = pixels[i + (gray ? 0 : 2)]!
    rgba[out + 3] =
      channels === 4 || (gray && channels === 2)
        ? pixels[i + channels - 1]!
        : 255
    if (
      decoded.transparency?.length &&
      decoded.transparency.every(
        (value, channel) => value === pixels[i + channel]
      )
    )
      rgba[out + 3] = 0
  }
  return sizeChecked(
    encodePng({
      width: decoded.width,
      height: decoded.height,
      depth: 8,
      channels: 4,
      data: rgba,
    })
  )
}

function exifOrientation(data: Uint8Array) {
  if (data.length < 6 || ascii.decode(data.subarray(0, 6)) !== "Exif\0\0")
    return null
  const tiff = data.subarray(6)
  if (tiff.length < 8) invalid()
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
  const order = ascii.decode(tiff.subarray(0, 2))
  if (order !== "II" && order !== "MM") invalid()
  const le = order === "II"
  if (view.getUint16(2, le) !== 42) invalid()
  const offset = view.getUint32(4, le)
  if (offset < 8 || offset + 2 > tiff.length) invalid()
  const count = view.getUint16(offset, le)
  if (count > 512 || offset + 2 + count * 12 + 4 > tiff.length) invalid()
  for (let i = 0; i < count; i++) {
    const entry = offset + 2 + i * 12
    if (view.getUint16(entry, le) !== 0x112) continue
    if (
      view.getUint16(entry + 2, le) !== 3 ||
      view.getUint32(entry + 4, le) !== 1
    )
      invalid()
    const orientation = view.getUint16(entry + 8, le)
    if (orientation < 1 || orientation > 8) invalid()
    return orientation
  }
  return 1
}

function jpegEnvelope(bytes: Uint8Array) {
  if (bytes[0] !== 255 || bytes[1] !== 216) invalid("FILE_TYPE_MISMATCH")
  let offset = 2,
    orientation = 1,
    exif = false,
    frame = false,
    scan = false,
    inScan = false,
    markers = 0
  while (offset < bytes.length) {
    if (++markers > 16384) invalid("FILE_COMPLEXITY_LIMIT")
    if (inScan) {
      while (offset < bytes.length && bytes[offset] !== 255) offset++
    }
    if (bytes[offset++] !== 255) invalid()
    while (bytes[offset] === 255) offset++
    const marker = bytes[offset++]!
    if (inScan && (marker === 0 || (marker >= 208 && marker <= 215))) continue
    inScan = false
    if (marker === 217) {
      if (!frame || !scan || offset !== bytes.length) invalid()
      return orientation
    }
    if (marker === 216 || marker === 0 || offset + 2 > bytes.length) invalid()
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!
    if (length < 2 || offset + length > bytes.length) invalid()
    const data = bytes.subarray(offset + 2, offset + length)
    if ([192, 193, 194].includes(marker)) {
      if (frame || data.length < 6 || data[0] !== 8) invalid()
      imageDimensions((data[3]! << 8) | data[4]!, (data[1]! << 8) | data[2]!)
      frame = true
    }
    if (marker === 225) {
      const parsed = exifOrientation(data)
      if (parsed !== null) {
        if (exif) invalid()
        exif = true
        orientation = parsed
      }
    }
    if (marker === 218) {
      scan = true
      inScan = true
    }
    offset += length
  }
  return invalid()
}

export function inspectJpeg(bytes: Uint8Array) {
  const orientation = jpegEnvelope(sizeChecked(bytes))
  const image = decodeJpeg(bytes, {
    useTArray: true,
    formatAsRGBA: true,
    tolerantDecoding: false,
    maxResolutionInMP: MAX_IMAGE_PIXELS / 1_000_000,
    maxMemoryUsageInMB: 64,
  })
  imageDimensions(image.width, image.height)
  return { image, orientation }
}
export function sanitizeJpeg(bytes: Uint8Array) {
  const { image, orientation } = inspectJpeg(bytes)
  const swap = orientation >= 5
  const width = swap ? image.height : image.width,
    height = swap ? image.width : image.height
  const data = new Uint8Array(image.data.length)
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      let dx = x,
        dy = y
      if (orientation === 2) dx = image.width - 1 - x
      else if (orientation === 3) {
        dx = image.width - 1 - x
        dy = image.height - 1 - y
      } else if (orientation === 4) dy = image.height - 1 - y
      else if (orientation === 5) {
        dx = y
        dy = x
      } else if (orientation === 6) {
        dx = image.height - 1 - y
        dy = x
      } else if (orientation === 7) {
        dx = image.height - 1 - y
        dy = image.width - 1 - x
      } else if (orientation === 8) {
        dx = y
        dy = image.width - 1 - x
      }
      data.set(
        image.data.subarray(
          (y * image.width + x) * 4,
          (y * image.width + x) * 4 + 4
        ),
        (dy * width + dx) * 4
      )
    }
  // Pass pixels only: jpeg-js can otherwise carry comments or EXIF into its encoder.
  return sizeChecked(
    new Uint8Array(encodeJpeg({ width, height, data }, 85).data)
  )
}
