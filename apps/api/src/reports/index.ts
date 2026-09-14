import { Hono } from "hono"
import { requireVerifiedSession } from "../auth/session"
import type { Bindings } from "../env"
import {
  listEventReports,
  resolveEventReport,
  submitEventReport,
} from "./service"

export const reportRoutes = new Hono<{ Bindings: Bindings }>()
  .post("/events/:eventId/reports", async (c) =>
    c.json(
      await submitEventReport(
        c.env.DB,
        (await requireVerifiedSession(c)).user.id,
        c.req.param("eventId"),
        await c.req.json().catch(() => null)
      )
    )
  )
  .get("/admin/event-reports", async (c) =>
    c.json(
      await listEventReports(
        c.env.DB,
        (await requireVerifiedSession(c)).user.id,
        c.req.query()
      )
    )
  )
  .post("/admin/event-reports/:reportId/resolution", async (c) =>
    c.json(
      await resolveEventReport(
        c.env.DB,
        (await requireVerifiedSession(c)).user.id,
        c.req.param("reportId"),
        await c.req.json().catch(() => null)
      )
    )
  )
