import { describe, expect, it, vi } from "vite-plus/test"
import { preloadedPage, preloadPages } from "./preloaded-page"

const Page = () => null

describe("preloadedPage", () => {
  it("should download each page once however often preloading runs", async () => {
    const load = vi.fn().mockResolvedValue(Page)
    preloadedPage(load)
    await preloadPages()
    await preloadPages()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("should try again after a failed download", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(Page)
    preloadedPage(load)
    await preloadPages()
    await preloadPages()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
