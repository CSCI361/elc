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
  it("should use a supported saved preference", () => {
    expect(resolveLocale("kk")).toBe("kk")
    expect(resolveLocale("ru")).toBe("ru")
  })

  it("should open in English for first-time visitors whatever the browser language", () => {
    vi.stubGlobal("navigator", { languages: ["kk-KZ", "ru-RU"] })
    vi.stubGlobal("localStorage", { getItem: () => null, setItem() {} })
    expect(resolveLocale(null)).toBe("en")
    expect(resolveLocale("unsupported")).toBe("en")
    expect(readBrowserLocale()).toBe("en")
  })

  it("should work when browser privacy settings block storage", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("blocked")
      },
      setItem() {
        throw new Error("blocked")
      },
    })
    expect(readBrowserLocale()).toBe("en")
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
