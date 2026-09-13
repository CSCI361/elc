import QRCode from "qrcode"
import { campaignLink } from "./policies"

const xml = (value: string) =>
  Array.from(value)
    .filter((char) => (char.codePointAt(0) ?? 0) >= 32)
    .join("")
    .replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[char] ?? ""
    )

export function campaignQrSvg(
  input: Parameters<typeof campaignLink>[0] & {
    name: string
    promotionLabel: string
    notTicketLabel: string
    localLabel: string
  }
) {
  const link = campaignLink(input)
  if (!link) return null
  const code = QRCode.create(link.url, { errorCorrectionLevel: "M" })
  const size = code.modules.size + 8
  const scale = Math.max(1, Math.floor(448 / size))
  const width = size * scale
  const path = Array.from(code.modules.data)
    .flatMap((value, index) =>
      value
        ? [
            `M${(index % code.modules.size) + 4} ${Math.floor(index / code.modules.size) + 4}h1v1h-1z`,
          ]
        : []
    )
    .join("")
  const titleLines =
    Array.from(input.name.trim())
      .slice(0, 100)
      .join("")
      .match(/.{1,25}/gu) ?? []
  const text = (value: string, y: number, fontSize: number) =>
    `<text x="256" y="${y}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" fill="#111">${xml(value)}</text>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="700" viewBox="0 0 512 700" role="img"><title>${xml(input.promotionLabel)}: ${xml(input.name)}. ${xml(input.notTicketLabel)}</title><rect width="512" height="700" fill="white"/>${text(input.promotionLabel, 32, 19)}${titleLines.map((line, index) => text(line, 61 + index * 20, 16)).join("")}<svg x="${(512 - width) / 2}" y="145" width="${width}" height="${width}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="white"/><path d="${path}" fill="black"/></svg>${text(input.notTicketLabel, 624, 20)}${link.local ? text(input.localLabel, 657, 10) : ""}</svg>`
  return { ...link, svg }
}
