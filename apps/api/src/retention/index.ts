import { cleanupEventImageAssets } from "../events/images/cleanup"
import { Hono } from "hono"
import { requireVerifiedSession } from "../auth/session"
import type { Bindings } from "../env"
import { cleanupRetainedAggregates } from "./aggregates"
import { cleanupRetentionObjects } from "./objects"
import {
  cleanupCompletedPayloads,
  cleanupExpiredSnapshots,
  cleanupInactiveProfiles,
} from "./housekeeping"
import { listRetention } from "./queries"

export { cleanupRetainedAggregates } from "./aggregates"
export { cleanupRetentionObjects } from "./objects"

export const retentionRoutes = new Hono<{ Bindings: Bindings }>().get(
  "/admin/retention",
  async (c) =>
    c.json(
      await listRetention(
        c.env.DB,
        (await requireVerifiedSession(c)).user.id,
        c.req.query()
      )
    )
)

/** Invoke daily, and run again before opening a recovered database to application queries.
 * Each pass is bounded; repeating a pass drains older backlog and retries failed object work. */
export async function runRetentionCleanup(
  env: Pick<Bindings, "DB" | "FILES">,
  now?: number
) {
  const dependencies = now === undefined ? {} : { now: () => now }
  const aggregates = await cleanupRetainedAggregates(env.DB, dependencies)
  const images = await cleanupEventImageAssets(env.DB, now)
  const snapshots = await cleanupExpiredSnapshots(env.DB, now)
  const payloads = await cleanupCompletedPayloads(env.DB, now)
  const profiles = await cleanupInactiveProfiles(env.DB, now)
  const objects = await cleanupRetentionObjects(env, dependencies)
  return {
    ...aggregates,
    imageAssetsRetired: images.retired,
    imageAssetsDeleted: images.deleted,
    snapshots,
    payloads,
    profiles,
    ...objects,
  }
}
