import { Hono } from "hono"
import { requireVerifiedSession } from "../auth/session"
import type { Bindings } from "../env"
import { readEventAnalytics } from "./read"
import { listAnalyticsEvents } from "./events"
import { readOrganizerAnalytics } from "./overview"
import { readEventTraffic } from "../traffic/read"

export const reportingRoutes = new Hono<{ Bindings: Bindings }>()
  .get("/events/:eventId/traffic", async (c) => {
    const session = await requireVerifiedSession(c)
    c.header("Cache-Control", "private, no-store")
    return c.json(
      await readEventTraffic(
        c.env,
        session.user.id,
        c.req.param("eventId"),
        c.req.query()
      )
    )
  })
  .get("/organizer/analytics/overview", async (c) => {
    const session = await requireVerifiedSession(c)
    return c.json(
      await readOrganizerAnalytics(c.env.DB, session.user.id, c.req.query())
    )
  })
  .get("/organizer/analytics/events", async (c) => {
    const session = await requireVerifiedSession(c)
    return c.json(
      await listAnalyticsEvents(c.env.DB, session.user.id, c.req.query())
    )
  })
  .get("/events/:eventId/analytics", async (c) => {
    const session = await requireVerifiedSession(c)
    return c.json(
      await readEventAnalytics(
        c.env.DB,
        session.user.id,
        c.req.param("eventId"),
        c.req.query()
      )
    )
  })
