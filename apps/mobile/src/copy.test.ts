import { describe, expect, it } from "vite-plus/test"
import { copies, fill } from "./copy"

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort()

describe("mobile copy", () => {
  it.each(["kk", "ru"] as const)(
    "should give %s every English string with the same placeholders",
    (language) => {
      for (const [key, english] of Object.entries(copies.en)) {
        const text = copies[language][key as keyof typeof copies.en]
        expect(text.trim(), key).not.toBe("")
        expect(placeholders(text), key).toEqual(placeholders(english))
      }
    }
  )

  it("should fill named values and keep unknown placeholders", () => {
    expect(
      fill("{checked} of {total} in {room}", { checked: 3, total: 40 })
    ).toBe("3 of 40 in {room}")
  })
})
