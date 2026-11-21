import { Component, type ReactNode } from "react"
import { EventError } from "@/events/ui"

export class PageErrorBoundary extends Component<
  { children: ReactNode },
  { failure: { error: unknown } | null }
> {
  state: { failure: { error: unknown } | null } = { failure: null }
  static getDerivedStateFromError(error: unknown) {
    return { failure: { error } }
  }
  render() {
    const { failure } = this.state
    return failure ? (
      <EventError
        error={failure.error}
        retry={() => window.location.reload()}
      />
    ) : (
      this.props.children
    )
  }
}
