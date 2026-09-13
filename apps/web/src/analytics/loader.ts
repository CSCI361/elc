import {
  eventAnalyticsResponseSchema,
  type EventAnalyticsQuery,
  type EventAnalyticsResponse,
} from "@elc/shared"
import { api, EventApiError } from "../events/api"
import {
  analyticsPath,
  analyticsQuery,
  matchingAnalyticsResponse,
} from "./policies"

type Read = (
  path: string,
  signal: AbortSignal
) => Promise<EventAnalyticsResponse>
type State = {
  query: EventAnalyticsQuery
  loading: boolean
  data?: EventAnalyticsResponse
  error?: unknown
}
/** A filter or page change discards the preceding private result and cancels its request. */
export class AnalyticsLoader {
  private state: State
  private generation = 0
  private active: AbortController | null = null
  private listeners = new Set<() => void>()
  private readonly read: Read
  readonly eventId: string
  constructor(
    eventId: string,
    query: EventAnalyticsQuery,
    read: Read = (path, signal) =>
      api(path, eventAnalyticsResponseSchema, { signal })
  ) {
    this.eventId = eventId
    this.read = read
    this.state = { query, loading: true }
  }
  snapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private publish(state: State) {
    this.state = state
    for (const listener of this.listeners) listener()
  }
  cancel = () => {
    this.generation++
    this.active?.abort()
    this.active = null
  }
  deny = (error: unknown) => {
    this.cancel()
    this.publish({ query: this.state.query, loading: false, error })
  }
  async load(raw: unknown = this.state.query) {
    this.cancel()
    const generation = this.generation,
      controller = new AbortController()
    this.active = controller
    let query: EventAnalyticsQuery
    try {
      query = analyticsQuery(raw)
    } catch (error) {
      this.publish({ query: this.state.query, loading: false, error })
      return
    }
    this.publish({ query, loading: true })
    try {
      const data = await this.read(
        analyticsPath(this.eventId, query),
        controller.signal
      )
      if (generation !== this.generation || controller.signal.aborted) return
      if (!matchingAnalyticsResponse(this.eventId, query, data))
        throw new EventApiError("INVALID_RESPONSE", 502)
      this.publish({ query, data, loading: false })
    } catch (error) {
      if (generation === this.generation && !controller.signal.aborted)
        this.publish({ query, loading: false, error })
    }
  }
}
