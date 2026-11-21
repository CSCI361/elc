import { describe, expect, it } from "vite-plus/test"
import { legalDocument, legalLabel } from "./messages"

const locales = ["kk", "ru", "en"] as const
const pages = ["privacy", "terms"] as const

describe("legal pages", () => {
  it.each(pages)(
    "should give the %s page the same sections in every language",
    (page) => {
      const shapes = locales.map((locale) =>
        legalDocument(locale, page).sections.map(
          (section) => section.body.length
        )
      )
      expect(shapes[0]!.length).toBeGreaterThan(0)
      expect(shapes[1]).toEqual(shapes[0])
      expect(shapes[2]).toEqual(shapes[0])
    }
  )

  it.each(pages)("should have no empty text on the %s page", (page) => {
    for (const locale of locales) {
      const document = legalDocument(locale, page)
      const texts = [
        document.title,
        document.updated,
        document.intro,
        ...document.sections.flatMap((section) => [
          section.heading,
          ...section.body,
        ]),
      ]
      expect(texts.every((text) => text.trim().length > 0)).toBe(true)
    }
  })

  it("should label both footer links in every language", () => {
    for (const locale of locales)
      for (const page of pages)
        expect(legalLabel(locale, page).trim()).not.toBe("")
  })
})
