import type { Icon } from "@phosphor-icons/react"
import type { ReactNode } from "react"

interface EmptyStateProps {
  icon: Icon
  title: string
  titleAs?: "p" | "h2" | "h3"
  hint?: string
  action?: ReactNode
  inline?: boolean
}

export function EmptyState({
  icon: Glyph,
  title,
  titleAs: Title = "p",
  hint,
  action,
  inline = false,
}: EmptyStateProps) {
  return (
    <div
      className="empty-state"
      data-inline={inline || undefined}
      role="status"
    >
      <span className="empty-state-icon">
        <Glyph size={inline ? 20 : 24} aria-hidden />
      </span>
      <Title className="empty-state-title">{title}</Title>
      {hint ? <p className="empty-state-hint">{hint}</p> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  )
}
