import { inflateSync } from "node:zlib"
import { encode as encodeJpeg } from "jpeg-js"
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  ParseSpeeds,
  type PDFObject,
} from "pdf-lib"
import {
  invalid,
  imageDimensions,
  MAX_PDF_EXPANDED_BYTES,
  MAX_PDF_OBJECTS,
  MAX_PDF_PAGES,
  MAX_PDF_STREAM_BYTES,
  sizeChecked,
} from "./limits"
import { inspectJpeg } from "./images"

const forbiddenKeys = new Set([
  "JS",
  "JavaScript",
  "AA",
  "A",
  "OpenAction",
  "AcroForm",
  "XFA",
  "EmbeddedFiles",
  "EF",
  "AF",
  "Collection",
  "RichMedia",
  "RichMediaContent",
  "RichMediaSettings",
  "Movie",
  "Sound",
  "Launch",
  "SubmitForm",
  "ImportData",
  "URI",
  "GoToR",
  "GoToE",
  "Perms",
])
const forbiddenTypes = new Set([
  "Action",
  "Filespec",
  "EmbeddedFile",
  "RichMedia",
  "3D",
  "MediaClip",
  "Rendition",
  "Movie",
  "Sound",
  "Annot",
])
const forbiddenSubtypes = new Set([
  "PS",
  "3D",
  "RichMedia",
  "Screen",
  "Movie",
  "Sound",
  "Widget",
  "FileAttachment",
])
const actionTypes = new Set([
  "JavaScript",
  "Launch",
  "GoTo",
  "GoToR",
  "GoToE",
  "URI",
  "SubmitForm",
  "ResetForm",
  "ImportData",
  "Hide",
  "SetOCGState",
  "Rendition",
  "Trans",
  "GoTo3DView",
  "Sound",
  "Movie",
  "Named",
  "RichMediaExecute",
])
const name = (value: PDFObject | undefined) =>
  value instanceof PDFName ? value.decodeText() : null

/** Reject parser-expanding structures before pdf-lib decompresses or recurses into them. */
function preflight(bytes: Uint8Array) {
  const text = new TextDecoder("latin1").decode(bytes)
  if (
    !/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(text) ||
    !/%%EOF[\0\t\r\n ]*$/.test(text)
  )
    invalid()
  const names = text.matchAll(/\/([^\0\t\n\f\r ()<>[\]{}/%]+)/g)
  for (const match of names) {
    const decoded = match[1]!.replace(/#([\da-f]{2})/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    if (decoded === "Encrypt") invalid("PDF_UNSAFE")
    if (decoded === "ObjStm" || decoded === "XRef") invalid("PDF_UNSUPPORTED")
  }
  if ([...text.matchAll(/\b\d+\s+\d+\s+obj\b/g)].length > MAX_PDF_OBJECTS)
    invalid("FILE_COMPLEXITY_LIMIT")
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "%") {
      while (i < text.length && text[i] !== "\n" && text[i] !== "\r") i++
      continue
    }
    if (ch === "(") {
      let stringDepth = 1
      while (stringDepth && ++i < text.length) {
        if (text[i] === "\\") i++
        else if (text[i] === "(") {
          if (++stringDepth > 64) invalid("FILE_COMPLEXITY_LIMIT")
        } else if (text[i] === ")") stringDepth--
      }
      if (stringDepth) invalid()
    } else if (
      (text.startsWith("stream\r", i) || text.startsWith("stream\n", i)) &&
      (i === 0 || /[\0\t\n\f\r >]/.test(text[i - 1]!)) &&
      />>[\0\t\n\f\r ]*$/.test(text.slice(Math.max(0, i - 128), i))
    ) {
      const end = text.indexOf("endstream", i + 6)
      if (end < 0) invalid()
      i = end + 8
    } else if (ch === "<" && text[i + 1] !== "<") {
      const end = text.indexOf(">", i + 1)
      if (end < 0) invalid()
      i = end
    } else if (ch === "[" || (ch === "<" && text[i + 1] === "<")) {
      if (++depth > 64) invalid("FILE_COMPLEXITY_LIMIT")
      if (ch === "<") i++
    } else if (ch === "]" || (ch === ">" && text[i + 1] === ">")) {
      if (--depth < 0) invalid()
      if (ch === ">") i++
    }
  }
  if (depth) invalid()
}

export async function sanitizePdf(bytes: Uint8Array) {
  preflight(sizeChecked(bytes))
  const source = await PDFDocument.load(bytes, {
    ignoreEncryption: false,
    throwOnInvalidObject: true,
    updateMetadata: false,
    parseSpeed: ParseSpeeds.Slow,
    capNumbers: true,
  })
  if (source.isEncrypted || source.context.trailerInfo.Encrypt)
    invalid("PDF_UNSAFE")
  const objects = source.context.enumerateIndirectObjects()
  if (objects.length > MAX_PDF_OBJECTS) invalid("FILE_COMPLEXITY_LIMIT")
  const seen = new Set<PDFObject>()
  const replacements = new Map<PDFRawStream, PDFRawStream>()
  let expanded = 0,
    visited = 0
  const resolve = (value: PDFObject | undefined): PDFObject | undefined => {
    if (!(value instanceof PDFRef)) return value
    const found = source.context.lookup(value)
    if (!found) invalid()
    return found
  }
  const inspect = (raw: PDFObject, depth = 0) => {
    const object = resolve(raw)
    if (!object || seen.has(object)) return
    if (depth > 64 || ++visited > 40_000) invalid("FILE_COMPLEXITY_LIMIT")
    seen.add(object)
    if (object instanceof PDFRawStream) {
      const dict = object.dict
      if (
        dict.has(PDFName.of("F")) ||
        dict.has(PDFName.of("FFilter")) ||
        dict.has(PDFName.of("FDecodeParms"))
      )
        invalid("PDF_UNSAFE")
      const filter = resolve(dict.get(PDFName.of("Filter")))
      const isImage = name(resolve(dict.get(PDFName.of("Subtype")))) === "Image"
      const integer = (key: string, fallback?: number, parameters = dict) => {
        const value = resolve(parameters.get(PDFName.of(key)))
        if (value === undefined && fallback !== undefined) return fallback
        if (
          !(value instanceof PDFNumber) ||
          !Number.isSafeInteger(value.asNumber())
        )
          invalid()
        return value.asNumber()
      }
      let width = 0,
        height = 0,
        channels = 0,
        predictor = 1
      if (isImage) {
        width = integer("Width")
        height = integer("Height")
        imageDimensions(width, height)
        if (dict.has(PDFName.of("ImageMask")) || dict.has(PDFName.of("Decode")))
          invalid("PDF_UNSUPPORTED")
        const color = name(resolve(dict.get(PDFName.of("ColorSpace"))))
        channels =
          color === "DeviceGray"
            ? 1
            : color === "DeviceRGB"
              ? 3
              : color === "DeviceCMYK"
                ? 4
                : 0
        if (!channels || integer("BitsPerComponent") !== 8)
          invalid("PDF_UNSUPPORTED")
        const parameters = resolve(dict.get(PDFName.of("DecodeParms")))
        if (parameters) {
          if (!(parameters instanceof PDFDict)) invalid("PDF_UNSUPPORTED")
          const columns = integer("Columns", 1, parameters)
          const colors = integer("Colors", 1, parameters)
          const bits = integer("BitsPerComponent", 8, parameters)
          imageDimensions(columns, height)
          if (colors < 1 || colors > 4 || bits < 1 || bits > 16)
            invalid("FILE_COMPLEXITY_LIMIT")
          predictor = integer("Predictor", 1, parameters)
          if (
            name(filter) !== "FlateDecode" ||
            (predictor !== 1 && (predictor < 10 || predictor > 15)) ||
            columns !== width ||
            colors !== channels ||
            bits !== 8
          )
            invalid("PDF_UNSUPPORTED")
          for (const [key] of parameters.entries())
            if (
              !["Columns", "Colors", "BitsPerComponent", "Predictor"].includes(
                key.decodeText()
              )
            )
              invalid("PDF_UNSUPPORTED")
        }
      } else if (dict.has(PDFName.of("DecodeParms"))) invalid("PDF_UNSUPPORTED")
      let data = object.getContents()
      let decodedSize: number | undefined
      if (isImage) {
        decodedSize =
          name(filter) === "DCTDecode"
            ? width * height * 4
            : (width * channels + (predictor >= 10 ? 1 : 0)) * height
        if (
          decodedSize > MAX_PDF_STREAM_BYTES ||
          expanded + decodedSize > MAX_PDF_EXPANDED_BYTES
        )
          invalid("FILE_COMPLEXITY_LIMIT")
      }
      if (filter) {
        if (name(filter) === "FlateDecode") {
          try {
            data = inflateSync(data, { maxOutputLength: MAX_PDF_STREAM_BYTES })
          } catch {
            invalid("FILE_COMPLEXITY_LIMIT")
          }
        } else if (name(filter) === "DCTDecode" && isImage) {
          const { image } = inspectJpeg(data)
          if (image.width !== width || image.height !== height) invalid()
          // PDF image orientation comes from its content transform, not EXIF.
          // Re-encode only decoded pixels so embedded EXIF/GPS/comments cannot survive.
          const clean = new Uint8Array(
            encodeJpeg({ width, height, data: image.data }, 85).data
          )
          dict.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB"))
          dict.delete(PDFName.of("DecodeParms"))
          replacements.set(object, PDFRawStream.of(dict, clean))
          decodedSize = width * height * 4
        } else invalid("PDF_UNSUPPORTED")
      }
      if (isImage && name(filter) !== "DCTDecode") {
        const expected = (width * channels + (predictor >= 10 ? 1 : 0)) * height
        if (expected > MAX_PDF_STREAM_BYTES) invalid("FILE_COMPLEXITY_LIMIT")
        if (data.length !== expected) invalid()
        if (predictor >= 10)
          for (let row = 0; row < height; row++)
            if (data[row * (width * channels + 1)]! > 4) invalid()
      }
      if (
        !isImage &&
        /(?:^|[\0\t\n\f\r ()<>[\]{}/%])BI(?=$|[\0\t\n\f\r ()<>[\]{}/%])/.test(
          new TextDecoder("latin1").decode(data)
        )
      )
        invalid("PDF_UNSUPPORTED")
      decodedSize ??= data.length
      if (
        decodedSize > MAX_PDF_STREAM_BYTES ||
        (expanded += decodedSize) > MAX_PDF_EXPANDED_BYTES
      )
        invalid("FILE_COMPLEXITY_LIMIT")
      inspect(dict, depth + 1)
    } else if (object instanceof PDFDict) {
      const type = name(resolve(object.get(PDFName.of("Type"))))
      if (type && forbiddenTypes.has(type)) invalid("PDF_UNSAFE")
      const subtype = name(resolve(object.get(PDFName.of("Subtype"))))
      if (subtype && forbiddenSubtypes.has(subtype)) invalid("PDF_UNSAFE")
      const action = name(resolve(object.get(PDFName.of("S"))))
      if (action && actionTypes.has(action)) invalid("PDF_UNSAFE")
      for (const [key, value] of object.entries()) {
        if (key.decodeText() === "Annots") {
          const annotations = resolve(value)
          if (!(annotations instanceof PDFArray) || annotations.size() !== 0)
            invalid("PDF_UNSAFE")
          object.delete(key)
          continue
        }
        if (forbiddenKeys.has(key.decodeText())) invalid("PDF_UNSAFE")
        inspect(value, depth + 1)
      }
      // Metadata is not copied into the released document.
      object.delete(PDFName.of("Metadata"))
      object.delete(PDFName.of("PieceInfo"))
    } else if (object instanceof PDFArray) {
      for (let i = 0; i < object.size(); i++) inspect(object.get(i), depth + 1)
    }
  }
  for (const [, object] of objects) inspect(object)
  for (const [ref, object] of objects) {
    const replacement =
      object instanceof PDFRawStream ? replacements.get(object) : undefined
    if (replacement) source.context.assign(ref, replacement)
  }
  const pageNodes = new Set<PDFObject>()
  let pageCount = 0
  const checkPages = (raw: PDFObject, parent?: PDFObject, depth = 0) => {
    const node = resolve(raw)
    if (!(node instanceof PDFDict) || pageNodes.has(node)) invalid()
    if (depth > 32 || pageNodes.size > MAX_PDF_OBJECTS)
      invalid("FILE_COMPLEXITY_LIMIT")
    pageNodes.add(node)
    const declaredParent = resolve(node.get(PDFName.of("Parent")))
    if (declaredParent !== parent) invalid()
    const type = name(resolve(node.get(PDFName.of("Type"))))
    if (type === "Page") {
      if (++pageCount > MAX_PDF_PAGES) invalid("FILE_COMPLEXITY_LIMIT")
    } else if (type === "Pages") {
      const kids = resolve(node.get(PDFName.of("Kids")))
      if (!(kids instanceof PDFArray) || !kids.size()) invalid()
      for (let i = 0; i < kids.size(); i++)
        checkPages(kids.get(i), node, depth + 1)
    } else invalid()
  }
  const pages = source.catalog.get(PDFName.of("Pages"))
  if (!pages) invalid()
  checkPages(pages)
  if (!pageCount || source.getPageCount() !== pageCount) invalid()
  for (const page of source.getPages()) {
    const box = page.node.getInheritableAttribute(PDFName.of("MediaBox"))
    const array = resolve(box)
    if (!(array instanceof PDFArray) || array.size() !== 4) invalid()
    const values = Array.from({ length: 4 }, (_, i) => {
      const value = resolve(array.get(i))
      if (
        !(value instanceof PDFNumber) ||
        !Number.isFinite(value.asNumber()) ||
        Math.abs(value.asNumber()) > 20_000
      )
        invalid()
      return value.asNumber()
    })
    if (values[2]! <= values[0]! || values[3]! <= values[1]!) invalid()
  }
  const output = await PDFDocument.create({ updateMetadata: false })
  for (const page of await output.copyPages(source, source.getPageIndices()))
    output.addPage(page)
  output.setProducer("elc support static validator v1")
  return sizeChecked(
    await output.save({
      useObjectStreams: false,
      addDefaultPage: false,
      updateFieldAppearances: false,
    })
  )
}
