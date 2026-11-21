import { describe, expect, it } from "vite-plus/test"
import { resourceView } from "./api"

describe("resourceView", () => {
  it("should report loading before the first answer", () => {
    expect(resourceView(null, "/a", 0)).toEqual({
      data: undefined,
      error: undefined,
      loading: true,
      refreshing: false,
    })
  })

  it("should keep the last data on screen while the same path reloads", () => {
    const view = resourceView({ path: "/a", version: 0, data: 1 }, "/a", 1)
    expect(view.data).toBe(1)
    expect(view.loading).toBe(false)
    expect(view.refreshing).toBe(true)
  })

  it("should not show data that belongs to another path", () => {
    const view = resourceView({ path: "/a", version: 0, data: 1 }, "/b", 0)
    expect(view.data).toBeUndefined()
    expect(view.loading).toBe(true)
  })

  it("should keep the previous results while a new search loads when asked", () => {
    const view = resourceView(
      { path: "/events?q=a", version: 0, data: 1 },
      "/events?q=ab",
      0,
      true
    )
    expect(view.data).toBe(1)
    expect(view.loading).toBe(false)
    expect(view.refreshing).toBe(true)
  })

  it("should drop an old error once a retry starts", () => {
    const failed = { path: "/a", version: 0, error: new Error("x") }
    expect(resourceView(failed, "/a", 0).error).toBeInstanceOf(Error)
    expect(resourceView(failed, "/a", 1)).toEqual({
      data: undefined,
      error: undefined,
      loading: true,
      refreshing: false,
    })
  })
})
