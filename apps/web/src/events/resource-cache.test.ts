import { beforeEach, describe, expect, it } from "vite-plus/test"
import {
  cacheLimit,
  cacheMaxAge,
  clearCached,
  forgetCached,
  readCached,
  writeCached,
} from "./resource-cache"

const schema = { parse: (input: unknown) => input }
const other = { parse: (input: unknown) => input }

describe("resource cache", () => {
  beforeEach(() => clearCached())

  it("should give back the data saved for the same account, page and schema", () => {
    writeCached("ann", "/orders", schema, [1], 0)
    expect(readCached("ann", "/orders", schema, 1)).toEqual([1])
  })

  it("should never give one account's data to another account", () => {
    writeCached("ann", "/orders", schema, [1], 0)
    expect(readCached("bob", "/orders", schema, 1)).toBeUndefined()
    expect(readCached("ann", "/orders", schema, 1)).toBeUndefined()
  })

  it("should not give data that another schema parsed", () => {
    writeCached("ann", "/events/1", schema, { id: 1 }, 0)
    expect(readCached("ann", "/events/1", other, 1)).toBeUndefined()
  })

  it("should not give data older than the maximum age", () => {
    writeCached("ann", "/orders", schema, [1], 0)
    expect(
      readCached("ann", "/orders", schema, cacheMaxAge + 1)
    ).toBeUndefined()
  })

  it("should forget a page after a failed refresh", () => {
    writeCached("ann", "/orders", schema, [1], 0)
    forgetCached("/orders")
    expect(readCached("ann", "/orders", schema, 1)).toBeUndefined()
  })

  it("should forget the oldest page past the limit", () => {
    for (let page = 0; page <= cacheLimit; page++)
      writeCached("ann", `/page/${page}`, schema, page, 0)
    expect(readCached("ann", "/page/0", schema, 1)).toBeUndefined()
    expect(readCached("ann", `/page/${cacheLimit}`, schema, 1)).toBe(cacheLimit)
  })
})
