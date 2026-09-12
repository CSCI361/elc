import {
  PDFDocument,
  PageSizes,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"
import qrcode from "qrcode-generator"
import { admissionPayloadSchema } from "@elc/shared"
import { labels } from "./labels"
import type { TicketPdfData } from "./ticket-data"

export const TICKET_PDF_VERSION = "ticket-a4-v1"

export function admissionQrMatrix(credential: unknown) {
  const payload = admissionPayloadSchema.parse(credential)
  const qr = qrcode(0, "Q")
  qr.addData(JSON.stringify(payload), "Byte")
  qr.make()
  return Array.from({ length: qr.getModuleCount() }, (_, row) =>
    Array.from({ length: qr.getModuleCount() }, (_, column) =>
      qr.isDark(row, column)
    )
  )
}

function lines(text: string, font: PDFFont, size: number, width: number) {
  const supported = new Set(font.getCharacterSet())
  const clean = Array.from(text.normalize("NFC"))
    .map((character) => {
      if (character === "\n") return character
      const code = character.codePointAt(0)!
      if (code < 32 || code === 127) return " "
      // Keep unsupported characters explicit instead of silently printing missing-glyph boxes.
      return supported.has(code)
        ? character
        : `[U+${code.toString(16).toUpperCase()}]`
    })
    .join("")
  const result: string[] = []
  for (const paragraph of clean.split("\n")) {
    let line = ""
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate
        continue
      }
      if (line) result.push(line)
      line = ""
      for (const character of word) {
        if (font.widthOfTextAtSize(line + character, size) > width && line) {
          result.push(line)
          line = ""
        }
        line += character
      }
    }
    result.push(line)
  }
  return result
}

function drawLines(
  page: PDFPage,
  value: string[],
  font: PDFFont,
  size: number,
  x: number,
  y: number,
  leading = size * 1.35
) {
  for (const line of value) {
    page.drawText(line, { x, y, font, size, color: rgb(0, 0, 0) })
    y -= leading
  }
  return y
}

/** Byte-only rendering: no filesystem, network, canvas or browser process. */
export async function renderTicketPdf(
  data: TicketPdfData,
  credential: unknown,
  fontBytes: Uint8Array
) {
  const text = labels[data.locale]
  const document = await PDFDocument.create()
  document.registerFontkit(fontkit)
  const font = await document.embedFont(fontBytes, { subset: true })
  document.setTitle(`elc - ${text.ticket}`)
  document.setCreator(`elc ${TICKET_PDF_VERSION}`)
  document.setProducer("elc")
  document.setLanguage(data.locale)
  // The PDF's identifiers appear in its visible fields, not hidden metadata.
  const pages: PDFPage[] = []
  let page: PDFPage
  let y = 0
  const newPage = (first: boolean) => {
    page = document.addPage(PageSizes.A4)
    pages.push(page)
    page.drawText("elc", { x: 42, y: 790, size: 26, font })
    page.drawText(text.demo, { x: 42, y: 770, size: 9, font })
    page.drawLine({
      start: { x: 42, y: 758 },
      end: { x: 553, y: 758 },
      thickness: 1,
      color: rgb(0, 0, 0),
    })
    const titleLines = lines(data.eventTitle, font, 20, first ? 304 : 511)
    y = drawLines(page, titleLines, font, 20, 42, 728, 26) - 18
    if (first) {
      const matrix = admissionQrMatrix(credential)
      const module = 180 / (matrix.length + 8)
      const left = 373
      const top = 740
      // Four clear modules surround a black vector QR, independent of print color.
      for (let row = 0; row < matrix.length; row++)
        for (let column = 0; column < matrix.length; column++)
          if (matrix[row]![column])
            page.drawRectangle({
              x: left + (column + 4) * module,
              y: top - (row + 5) * module,
              width: module,
              height: module,
              color: rgb(0, 0, 0),
            })
      page.drawText(text.ticket, { x: 373, y: 546, size: 10, font })
    }
  }
  newPage(true)
  const field = (label: string, value: string, size = 11, width = 511) => {
    const wrapped = lines(value, font, size, width)
    let offset = 0
    while (offset < wrapped.length) {
      if (y < 135) newPage(false)
      page.drawText(label, {
        x: 42,
        y,
        size: 8,
        font,
        color: rgb(0.28, 0.28, 0.28),
      })
      y -= 17
      const available = Math.max(1, Math.floor((y - 110) / (size * 1.35)))
      const selected = wrapped.slice(offset, offset + available)
      y = drawLines(page, selected, font, size, 42, y) - 13
      offset += selected.length
      if (offset < wrapped.length) newPage(false)
    }
  }
  field(text.attendee, data.attendee, 15, 304)
  const seat = data.seat
    ? `${text.section} ${data.seat.section} / ${text.row} ${data.seat.row} / ${text.place} ${data.seat.number}`
    : text.general
  field(text.type, `${data.ticketType}\n${text.seat}: ${seat}`, 11, 304)
  if (pages.length === 1) y = Math.min(y, 530)
  const dateFormat = new Intl.DateTimeFormat(data.locale, {
    timeZone: data.timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
  field(
    text.when,
    `${dateFormat.format(data.startsAt)} - ${dateFormat.format(data.endsAt)}\n${data.timeZone}`
  )
  field(text.venue, `${data.venueName}\n${data.venueAddress}`)
  const money = (value: number) => `${(value / 100).toFixed(2)} KZT`
  field(
    text.price,
    `${money(data.unitPriceMinor)}\n${text.discount}: ${money(data.orderDiscountMinor)} / ${text.total}: ${money(data.orderTotalMinor)}`,
    10
  )
  const status = data.eventCancelled
    ? text.eventCancelled
    : data.eventSuspended
      ? text.eventSuspended
      : data.admissionBlocked
        ? text.blocked
        : text[data.state]
  field(text.status, status)
  field(text.ticketId, data.ticketId, 9)
  field(text.orderId, data.orderId, 9)
  field("elc", data.eventUrl, 8)
  for (let index = 0; index < pages.length; index++) {
    const target = pages[index]!
    target.drawLine({
      start: { x: 42, y: 91 },
      end: { x: 553, y: 91 },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
    })
    const noteLines = lines(
      `${text.print}\n${text.admission}\n${text.privacy}\n${text.simulation}`,
      font,
      7,
      511
    )
    drawLines(target, noteLines, font, 7, 42, 78, 10)
    target.drawText(`${text.page} ${index + 1} / ${pages.length}`, {
      x: 470,
      y: 18,
      size: 7,
      font,
    })
  }
  return document.save()
}
