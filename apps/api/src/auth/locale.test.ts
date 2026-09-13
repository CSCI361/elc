import { describe, expect, it, vi } from "vite-plus/test"
import type { Bindings } from "../env"
import { AuthDeliveryError } from "./email"
import { authEmailLocale, loadAuthEmailLocale } from "./locale"

describe("authentication email locale preference", () => {
  it.each(["kk", "ru", "en"] as const)(
    "uses saved %s before every request preference, including quality zero",
    (saved) => {
      expect(authEmailLocale(saved, "ru-KZ,en-US;q=0.9,kk;q=0")).toBe(saved)
      expect(authEmailLocale(saved, `${saved};q=0`)).toBe(saved)
      expect(authEmailLocale(saved, "en\r\nPrivate: header")).toBe(saved)
      expect(authEmailLocale(saved)).toBe(saved)
    }
  )

  it.each([
    [undefined, "kk"],
    [null, "kk"],
    ["", "kk"],
    ["fr-FR,de;q=0.9", "kk"],
    ["*", "kk"],
    ["ru", "ru"],
    ["en-US", "en"],
    ["kk-KZ", "kk"],
    ["RU-kz, en;q=0.9", "ru"],
    ["de-DE, en-US;q=0.8,ru;q=0.7", "en"],
    ["en;q=0.2,ru;q=0.9", "ru"],
    ["ru;q=0.4,en;q=0.4", "ru"],
    ["en;q=0.4,ru;q=0.4", "en"],
    ["kk;q=0,ru;q=0.1", "ru"],
    ["en;q=0,ru;q=0", "kk"],
    ["en;q=0,ru", "ru"],
    ["*;q=1,ru;q=0.2", "ru"],
    [" en-US \t; q = 0.123 , ru;q=0.122 ", "en"],
    ["en;q=1.000,ru;q=0.999", "en"],
    ["en;q=1.001,ru;q=0.5", "ru"],
    ["en;q=2,ru;q=0.5", "ru"],
    ["en;q=-1,ru;q=0.5", "ru"],
    ["en;q=NaN,ru;q=0.5", "ru"],
    ["en;q=Infinity,ru;q=0.5", "ru"],
    ["en;q=.8,ru;q=0.5", "ru"],
    ["en;q=0.1234,ru;q=0.5", "ru"],
    ["en;q=1;private=secret,ru;q=0.5", "ru"],
    ["en_US,ru;q=0.5", "ru"],
    ["en;q=0.2,ru;q=0.4,en;q=0.8", "en"],
    ["en\r\nPrivate: header,ru", "kk"],
    ["en\u0000,ru", "kk"],
    ["en".repeat(2049), "kk"],
    [Array.from({ length: 33 }, () => "en").join(","), "kk"],
  ] as const)("resolves bounded header %j to %s", (header, expected) => {
    expect(authEmailLocale(undefined, header)).toBe(expected)
    expect(authEmailLocale("unsupported", header)).toBe(expected)
    expect(authEmailLocale({ locale: "ru" }, header)).toBe(expected)
  })

  it("loads the callback account by a bound identifier and does not cache its locale", async () => {
    const first = vi
        .fn()
        .mockResolvedValueOnce({ locale: "ru" })
        .mockResolvedValueOnce({ locale: "en" }),
      bind = vi.fn(() => ({ first })),
      prepare = vi.fn(() => ({ bind })),
      db = { prepare } as unknown as Bindings["DB"]
    expect(await loadAuthEmailLocale(db, "callback-account", "kk")).toBe("ru")
    expect(await loadAuthEmailLocale(db, "callback-account", "kk")).toBe("en")
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(prepare).toHaveBeenCalledWith(
      "SELECT locale FROM profiles WHERE user_id = ? LIMIT 1"
    )
    expect(bind).toHaveBeenCalledWith("callback-account")
  })

  it("returns a fixed safe failure when the profile cannot be read", async () => {
    const db = {
      prepare: () => {
        throw new Error("private database identity and reset URL")
      },
    } as unknown as Bindings["DB"]
    await expect(
      loadAuthEmailLocale(db, "callback-account", "en")
    ).rejects.toEqual(new AuthDeliveryError("EMAIL_DELIVERY_FAILED"))
  })
})
