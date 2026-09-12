import { Hono, type Context } from "hono"
import { requireSession } from "../auth/session"
import type { Bindings } from "../env"
import {
  listOfflineDevices,
  registerOfflineDevice,
  revokeOfflineDevice,
} from "./devices"
import {
  getOfflineManifest,
  getOfflineSnapshotPage,
  issueOfflineSnapshot,
} from "./snapshots"
import { listOfflineAdmissions, reviewOfflineAdmission } from "./review"
import { syncOfflineScans } from "./sync"
import type { OfflineDependencies } from "./store"

type Environment = { Bindings: Bindings }
export function createOfflineRoutes(
  dependencies: OfflineDependencies & {
    identify?: (context: Context<Environment>) => Promise<string>
  } = {}
) {
  const actor =
    dependencies.identify ??
    (async (context: Context<Environment>) =>
      (await requireSession(context)).user.id)
  const clock = dependencies.now ?? Date.now
  return new Hono<Environment>()
    .get("/events/:eventId/offline/devices", async (c) =>
      c.json(
        await listOfflineDevices(
          c.env.DB,
          await actor(c),
          c.req.param("eventId"),
          c.req.query()
        )
      )
    )
    .post("/events/:eventId/offline/devices", async (c) =>
      c.json(
        await registerOfflineDevice(
          c.env.DB,
          await actor(c),
          c.req.param("eventId"),
          await c.req.json().catch(() => null),
          dependencies
        ),
        201
      )
    )
    .post("/events/:eventId/offline/devices/:deviceId/revoke", async (c) =>
      c.json(
        await revokeOfflineDevice(
          c.env.DB,
          await actor(c),
          c.req.param("eventId"),
          c.req.param("deviceId"),
          await c.req.json().catch(() => null),
          dependencies
        )
      )
    )
    .post("/events/:eventId/offline/snapshots", async (c) =>
      c.json(
        await issueOfflineSnapshot(
          c.env,
          await actor(c),
          c.req.param("eventId"),
          await c.req.json().catch(() => null),
          dependencies
        ),
        201
      )
    )
    .get("/events/:eventId/offline/snapshots/:snapshotId", async (c) =>
      c.json(
        await getOfflineManifest(
          c.env,
          await actor(c),
          c.req.param("eventId"),
          c.req.param("snapshotId"),
          clock
        )
      )
    )
    .get(
      "/events/:eventId/offline/snapshots/:snapshotId/pages/:page",
      async (c) =>
        c.json(
          await getOfflineSnapshotPage(
            c.env,
            await actor(c),
            c.req.param("eventId"),
            c.req.param("snapshotId"),
            c.req.param("page"),
            clock
          )
        )
    )
    .post("/events/:eventId/offline/sync", async (c) =>
      c.json(
        await syncOfflineScans(
          c.env.DB,
          await actor(c),
          c.req.param("eventId"),
          await c.req.json().catch(() => null),
          dependencies
        )
      )
    )
    .get("/events/:eventId/offline/admissions", async (c) =>
      c.json(
        await listOfflineAdmissions(
          c.env.DB,
          await actor(c),
          c.req.param("eventId"),
          c.req.query()
        )
      )
    )
    .post(
      "/events/:eventId/offline/admissions/:operationId/review",
      async (c) =>
        c.json(
          await reviewOfflineAdmission(
            c.env.DB,
            await actor(c),
            c.req.param("eventId"),
            c.req.param("operationId"),
            await c.req.json().catch(() => null),
            dependencies
          )
        )
    )
}
export const offlineRoutes = createOfflineRoutes()
