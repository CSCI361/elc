import { useSyncExternalStore } from "react"

interface ClickState {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  defaultPrevented: boolean
}

interface LinkState {
  href: string
  target: string
  download: boolean
}

const NAVIGATE_EVENT = "elc:navigate"
const BROWSER_ONLY_PATHS = /^\/(api|cdn-cgi)(\/|$)/

export function internalLinkTarget(
  click: ClickState,
  link: LinkState,
  origin: string,
  currentPath?: string
): string | null {
  if (
    click.defaultPrevented ||
    click.button !== 0 ||
    click.metaKey ||
    click.ctrlKey ||
    click.shiftKey ||
    click.altKey ||
    link.download ||
    (link.target && link.target !== "_self")
  )
    return null
  let url: URL
  try {
    url = new URL(link.href, origin)
  } catch {
    return null
  }
  if (url.origin !== origin || BROWSER_ONLY_PATHS.test(url.pathname))
    return null
  if (url.hash && currentPath === `${url.pathname}${url.search}`) return null
  return `${url.pathname}${url.search}${url.hash}`
}

export function navigate(to: string, { replace = false } = {}) {
  if (replace) window.history.replaceState(null, "", to)
  else window.history.pushState(null, "", to)
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
  if (!new URL(to, window.location.origin).hash) window.scrollTo(0, 0)
}

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange)
  window.addEventListener(NAVIGATE_EVENT, onChange)
  return () => {
    window.removeEventListener("popstate", onChange)
    window.removeEventListener(NAVIGATE_EVENT, onChange)
  }
}

const currentLocation = () =>
  `${window.location.pathname}${window.location.search}`

export function useLocation() {
  const location = useSyncExternalStore(subscribe, currentLocation)
  const url = new URL(location, window.location.origin)
  return { location, pathname: url.pathname, search: url.search }
}

export function interceptLinkClicks() {
  const onClick = (event: MouseEvent) => {
    const anchor = (event.target as Element | null)?.closest?.("a[href]")
    if (!(anchor instanceof HTMLAnchorElement)) return
    const to = internalLinkTarget(
      event,
      {
        href: anchor.href,
        target: anchor.target,
        download: anchor.hasAttribute("download"),
      },
      window.location.origin,
      currentLocation()
    )
    if (to === null) return
    event.preventDefault()
    if (to !== `${currentLocation()}${window.location.hash}`) navigate(to)
  }
  document.addEventListener("click", onClick)
  return () => document.removeEventListener("click", onClick)
}
