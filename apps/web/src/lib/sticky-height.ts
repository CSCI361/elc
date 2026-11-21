export function trackStickyHeight(element: HTMLElement | null) {
  if (!element) return
  const observer = new ResizeObserver(() =>
    element.style.setProperty("--sticky-height", `${element.offsetHeight}px`)
  )
  observer.observe(element)
  return () => observer.disconnect()
}
