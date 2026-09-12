import { afterEach, describe, expect, it, vi } from "vite-plus/test"
import { authMessages } from "@elc/shared"
import {
  localeStorageKey,
  persistLocale,
  readBrowserLocale,
  resolveLocale,
} from "./locale"

afterEach(() => vi.unstubAllGlobals())

describe("account language", () => {
  it("prioritizes a supported saved preference over browser language", () => {
    expect(resolveLocale("kk", ["ru-RU", "en"])).toBe("kk")
    expect(resolveLocale("ru", ["en-US"])).toBe("ru")
  })

  it("falls back through browser languages and defaults to Kazakh", () => {
    expect(resolveLocale("unsupported", ["fr-FR", "RU-ru"])).toBe("ru")
    expect(resolveLocale(null, ["en_US"])).toBe("en")
    expect(resolveLocale(null, ["kk-KZ"])).toBe("kk")
    expect(resolveLocale(null, ["de-DE"])).toBe("kk")
    expect(resolveLocale(null, [])).toBe("kk")
  })

  it("works when browser privacy settings block storage", () => {
    vi.stubGlobal("navigator", { languages: ["ru-RU"] })
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("blocked")
      },
      setItem() {
        throw new Error("blocked")
      },
    })
    expect(readBrowserLocale()).toBe("ru")
    expect(() => persistLocale("en")).not.toThrow()
  })

  it("stores only the selected interface language", () => {
    const setItem = vi.fn()
    vi.stubGlobal("localStorage", { setItem })
    persistLocale("kk")
    expect(setItem).toHaveBeenCalledExactlyOnceWith(localeStorageKey, "kk")
  })

  it("provides every authentication message in all three languages", () => {
    for (const messages of Object.values(authMessages)) {
      expect(Object.keys(messages).sort()).toEqual(
        Object.keys(authMessages.en).sort()
      )
      expect(
        Object.values(messages).every((message) => message.trim().length > 0)
      ).toBe(true)
    }
  })
})
