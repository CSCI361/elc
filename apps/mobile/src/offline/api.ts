import { hc } from "hono/client"
import type { AppType } from "@elc/api/types"
import { authenticatedFetch, responseJson } from "../transport"
import type { PendingBatch } from "./model"

export function createOfflineApi(
  apiOrigin: string,
  getCookie: () => Promise<string | null>,
  fetcher: typeof fetch = fetch
) {
  const client = hc<AppType>(apiOrigin, {
    fetch: authenticatedFetch(apiOrigin, getCookie, fetcher),
  })
  const event = client.api.events[":eventId"].offline
  return {
    account: () => responseJson(client.api.me.$get()),
    event: (eventId: string) =>
      responseJson(
        client.api.scanner.events[":eventId"].$get({ param: { eventId } })
      ),
    register: (eventId: string, requestId: string, label: string) =>
      responseJson(
        event.devices.$post(
          { param: { eventId } },
          { init: { body: JSON.stringify({ requestId, label }) } }
        )
      ),
    snapshot: (eventId: string, deviceId: string, requestId: string) =>
      responseJson(
        event.snapshots.$post(
          { param: { eventId } },
          { init: { body: JSON.stringify({ deviceId, requestId }) } }
        )
      ),
    page: (eventId: string, snapshotId: string, page: number) =>
      responseJson(
        event.snapshots[":snapshotId"].pages[":page"].$get({
          param: { eventId, snapshotId, page: String(page) },
        })
      ),
    sync: (eventId: string, batch: PendingBatch) =>
      responseJson(
        event.sync.$post(
          { param: { eventId } },
          { init: { body: JSON.stringify(batch) } }
        )
      ),
  }
}
export type OfflineApi = ReturnType<typeof createOfflineApi>
