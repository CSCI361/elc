import { useEffect, useRef, useState, type ReactNode } from "react"

export function ChipRow({
  label,
  children,
  className = "",
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  const scroller = useRef<HTMLElement>(null)
  const [edges, setEdges] = useState({ start: false, end: false })
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const update = () =>
      setEdges({
        start: element.scrollLeft > 1,
        end: element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
      })
    update()
    element.addEventListener("scroll", update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => {
      element.removeEventListener("scroll", update)
      observer.disconnect()
    }
  }, [])
  return (
    <div
      className={`chip-row ${className}`.trim()}
      data-more-start={edges.start || undefined}
      data-more-end={edges.end || undefined}
    >
      <nav ref={scroller} className="category-chips" aria-label={label}>
        {children}
      </nav>
    </div>
  )
}
