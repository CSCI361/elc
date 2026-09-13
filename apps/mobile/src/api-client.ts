import { hc } from "hono/client"
import type { AppType } from "@elc/api/types"
import type { Locale } from "@elc/shared"
import type { PendingScan } from "./model"
import { authenticatedFetch, responseJson } from "./transport"

export function createNativeApi(
  apiOrigin: string,
  getCookie: () => Promise<string | null>,
  fetcher: typeof fetch = fetch
) {
  const client = hc<AppType>(apiOrigin, {
    fetch: authenticatedFetch(apiOrigin, getCookie, fetcher),
  })
  return {
    capabilities: (signal?: AbortSignal) =>
      responseJson(
        client.api["auth-capabilities"].$get({}, { init: { signal } })
      ),
    account: (signal?: AbortSignal) =>
      responseJson(client.api.me.$get({}, { init: { signal } })),
    saveLanguage: (locale: Locale) =>
      responseJson(
        client.api.me.preferences.$patch(
          {},
          { init: { body: JSON.stringify({ locale }) } }
        )
      ),
    events: (after?: string, signal?: AbortSignal) => {
      const args = {
        query: { limit: "20", ...(after ? { cursor: after } : {}) },
      }
      return responseJson(
        client.api.scanner.events.$get(args, { init: { signal } })
      )
    },
    event: (eventId: string, signal?: AbortSignal) =>
      responseJson(
        client.api.scanner.events[":eventId"].$get(
          { param: { eventId } },
          { init: { signal } }
        )
      ),
    attendees: (
      eventId: string,
      q: string,
      cursor?: string,
      signal?: AbortSignal
    ) => {
      const args = {
        param: { eventId },
        query: { q, limit: "20", ...(cursor ? { cursor } : {}) },
      }
      return responseJson(
        client.api.scanner.events[":eventId"].attendees.$get(args, {
          init: { signal },
        })
      )
    },
    scan: (input: PendingScan, signal?: AbortSignal) =>
      responseJson(
        client.api.checkins.$post(
          {},
          { init: { body: JSON.stringify(input), signal } }
        )
      ),
    reverse: (
      eventId: string,
      input: { checkInId: string; requestId: string; reason: string }
    ) =>
      responseJson(
        client.api.events[":eventId"].checkins[":checkInId"].reverse.$post(
          { param: { eventId, checkInId: input.checkInId } },
          {
            init: {
              body: JSON.stringify({
                requestId: input.requestId,
                reason: input.reason,
              }),
            },
          }
        )
      ),
  }
}
