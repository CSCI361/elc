import type { CSSProperties, ReactNode } from "react"

export function SkeletonRegion({
  children,
  className = "",
  label,
}: {
  children: ReactNode
  className?: string
  label: string
}) {
  return (
    <div
      className={`skeleton-region ${className}`}
      role="status"
      aria-busy="true"
      aria-label={label}
      data-testid="skeleton"
    >
      <div aria-hidden="true">{children}</div>
    </div>
  )
}

export function Bar({
  width = "100%",
  height = 14,
  radius,
  style,
}: {
  width?: number | string
  height?: number | string
  radius?: number
  style?: CSSProperties
}) {
  return (
    <span
      className="skeleton"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  )
}
