import { Hono, type Context } from "hono"
import { requireVerifiedSession } from "../auth/session"
import type { Bindings } from "../env"
import { readOrganizerRecords, type RecordsDependencies } from "./read"

type Environment = { Bindings: Bindings; Variables: { requestId: string } }
export function createOrganizerRecordsRoutes(
  dependencies: RecordsDependencies & {
    identify?: (context: Context<Environment>) => Promise<string>
  } = {}
) {
  const identify =
    dependencies.identify ??
    (async (c: Context<Environment>) =>
      (await requireVerifiedSession(c)).user.id)
  return new Hono<Environment>().get("/events/:eventId/records", async (c) => {
    c.header("Cache-Control", "private, no-store")
    c.header("Vary", "Cookie")
    return c.json(
      await readOrganizerRecords(
        c.env.DB,
        await identify(c),
        c.req.param("eventId"),
        c.req.query(),
        dependencies
      )
    )
  })
}
export const organizerRecordsRoutes = createOrganizerRecordsRoutes()
