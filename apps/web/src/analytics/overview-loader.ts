import {
  organizerAnalyticsOverviewResponseSchema,
  type OrganizerAnalyticsOverviewQuery,
  type OrganizerAnalyticsOverviewResponse,
} from "@elc/shared"
import { api, EventApiError } from "../events/api"
import {
  matchingOverview,
  overviewPath,
  overviewQuery,
} from "./overview-policy"

type State = {
  query: OrganizerAnalyticsOverviewQuery
  loading: boolean
  data?: OrganizerAnalyticsOverviewResponse
  error?: unknown
}
type Read = (
  path: string,
  signal: AbortSignal
) => Promise<OrganizerAnalyticsOverviewResponse>

/** Account remounts, filter changes and failed refreshes discard the previous private report. */
export class OverviewLoader {
  private state: State = { query: overviewQuery({}), loading: true }
  private generation = 0
  private controller: AbortController | null = null
  private listeners = new Set<() => void>()
  private readonly read: Read
  constructor(
    read: Read = (path, signal) =>
      api(path, organizerAnalyticsOverviewResponseSchema, { signal })
  ) {
    this.read = read
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
    this.controller?.abort()
    this.controller = null
  }
  async load(raw: unknown = this.state.query) {
    this.cancel()
    const generation = this.generation,
      controller = new AbortController()
    this.controller = controller
    let query: OrganizerAnalyticsOverviewQuery
    try {
      query = overviewQuery(raw)
    } catch {
      this.publish({
        query: this.state.query,
        loading: false,
        error: new EventApiError("INVALID_INPUT", 400),
      })
      return
    }
    this.publish({ query, loading: true })
    try {
      const data = await this.read(overviewPath(query), controller.signal)
      if (controller.signal.aborted || generation !== this.generation) return
      if (!matchingOverview(query, data))
        throw new EventApiError("INVALID_RESPONSE", 502)
      this.publish({ query, data, loading: false })
    } catch (error) {
      if (!controller.signal.aborted && generation === this.generation)
        this.publish({ query, loading: false, error })
    }
  }
}
