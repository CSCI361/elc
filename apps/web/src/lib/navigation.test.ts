import { describe, expect, it } from "vite-plus/test"
import { internalLinkTarget } from "./navigation"

const origin = "http://localhost:5173"
const click = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
}
const link = { href: `${origin}/events/abc`, target: "", download: false }

describe("internalLinkTarget", () => {
  it("should return the path for a plain click on a same-origin page link", () => {
    expect(internalLinkTarget(click, link, origin)).toBe("/events/abc")
  })

  it("should keep the query string and hash", () => {
    expect(
      internalLinkTarget(
        click,
        { ...link, href: `${origin}/events?q=jazz#top` },
        origin
      )
    ).toBe("/events?q=jazz#top")
  })

  it.each(["metaKey", "ctrlKey", "shiftKey", "altKey"] as const)(
    "should leave the click to the browser when %s is held",
    (key) => {
      expect(
        internalLinkTarget({ ...click, [key]: true }, link, origin)
      ).toBeNull()
    }
  )

  it("should ignore middle and right clicks", () => {
    expect(internalLinkTarget({ ...click, button: 1 }, link, origin)).toBeNull()
  })

  it("should ignore clicks another handler already took", () => {
    expect(
      internalLinkTarget({ ...click, defaultPrevented: true }, link, origin)
    ).toBeNull()
  })

  it("should ignore links that open a new tab", () => {
    expect(
      internalLinkTarget(click, { ...link, target: "_blank" }, origin)
    ).toBeNull()
  })

  it("should ignore download links", () => {
    expect(
      internalLinkTarget(click, { ...link, download: true }, origin)
    ).toBeNull()
  })

  it("should ignore links to other sites", () => {
    expect(
      internalLinkTarget(
        click,
        { ...link, href: "https://polar.sh/checkout" },
        origin
      )
    ).toBeNull()
  })

  it("should ignore API and platform paths so files and redirects still load", () => {
    for (const path of ["/api/tickets/1/pdf", "/cdn-cgi/x"])
      expect(
        internalLinkTarget(click, { ...link, href: `${origin}${path}` }, origin)
      ).toBeNull()
  })

  it("should ignore non-http links such as mail and phone", () => {
    expect(
      internalLinkTarget(
        click,
        { ...link, href: "mailto:help@example.test" },
        origin
      )
    ).toBeNull()
  })

  it("should ignore links that only change the hash on the current page", () => {
    expect(
      internalLinkTarget(
        click,
        { ...link, href: `${origin}/events#details` },
        origin,
        "/events"
      )
    ).toBeNull()
  })
})
