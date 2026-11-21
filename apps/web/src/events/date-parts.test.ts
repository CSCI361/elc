import { describe, expect, it } from "vite-plus/test"
import {
  dateParts,
  EVENT_CATEGORIES,
  categoryLabel,
  priceText,
} from "./date-parts"

describe("dateParts", () => {
  it("should split a date in the event's own time zone", () => {
    expect(dateParts("2026-11-25T04:00:00.000Z", "Asia/Almaty", "en")).toEqual({
      month: "Nov",
      day: "25",
      weekday: "Wed",
      time: "9:00 AM",
    })
  })

  it("should roll over to the next day when the time zone is ahead of UTC", () => {
    expect(dateParts("2026-11-20T21:00:00.000Z", "Asia/Almaty", "en").day).toBe(
      "21"
    )
  })

  it("should use the interface language for names and a 24 hour clock in Russian", () => {
    const parts = dateParts("2026-11-25T14:30:00.000Z", "Asia/Almaty", "ru")
    expect(parts.day).toBe("25")
    expect(parts.time).toBe("19:30")
    expect(parts.month.toLowerCase()).toContain("нояб")
  })
})

describe("event categories", () => {
  it("should keep stored values in English so filters match across languages", () => {
    expect(EVENT_CATEGORIES).toContain("Music")
    expect(EVENT_CATEGORIES.every((value) => /^[A-Z][a-z]+$/.test(value))).toBe(
      true
    )
  })

  it("should translate known categories and pass unknown ones through", () => {
    expect(categoryLabel("Music", "ru")).toBe("Музыка")
    expect(categoryLabel("Film", "kk")).toBe("Кино")
    expect(categoryLabel("Robotics club", "en")).toBe("Robotics club")
  })
})

describe("priceText", () => {
  it("should say free in the interface language for a zero price", () => {
    expect(priceText(0, "en")).toBe("Free")
    expect(priceText(0, "ru")).toBe("Бесплатно")
    expect(priceText(0, "kk")).toBe("Тегін")
  })

  it("should format a paid price in tenge", () => {
    expect(priceText(150_000, "en")).toContain("1,500")
  })
})
