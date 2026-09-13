import { Hono, type Context } from "hono"
import { requireSession } from "../auth/session"
import { ApiFailure } from "../db/transitions"
import type { Bindings } from "../env"
import { duplicatePastEvent } from "./duplicate"
import { listOrganizerHistory, readEventHistory } from "./queries"
import type { HistoryDependencies } from "./store"
type Environment = { Bindings: Bindings }
export function createHistoryRoutes(
  dependencies: HistoryDependencies & {
    identify?: (context: Context<Environment>) => Promise<string>
  } = {}
) {
  const actor =
    dependencies.identify ??
    (async (context: Context<Environment>) =>
      (await requireSession(context)).user.id)
  return new Hono<Environment>()
    .get("/organizer/history", async (c) =>
      c.json(
        await listOrganizerHistory(
          c.env.DB,
          await actor(c),
          c.req.query(),
          dependencies
        )
      )
    )
    .get("/events/:eventId/history", async (c) =>
      c.json(
        await readEventHistory(
          c.env.DB,
          await actor(c),
          c.req.param("eventId"),
          c.req.query(),
          dependencies
        )
      )
    )
    .post("/events/:eventId/duplicate", async (c) => {
      const actorId = await actor(c)
      const input = await c.req.json().catch(() => {
        throw new ApiFailure(
          "INVALID_INPUT",
          400,
          "A JSON request body is required."
        )
      })
      return c.json(
        await duplicatePastEvent(
          c.env.DB,
          actorId,
          c.req.param("eventId"),
          input,
          dependencies
        ),
        201
      )
    })
}
export const historyRoutes = createHistoryRoutes()
