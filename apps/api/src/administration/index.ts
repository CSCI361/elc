import { Hono } from "hono"
import { requireVerifiedSession } from "../auth/session"
import type { Bindings } from "../env"
import { listAdministration, setSuspension } from "./service"
import { listOperations, exportOperations } from "./operations"
import { listPlatformCampaigns } from "./campaigns"

export const administrationRoutes = new Hono<{ Bindings: Bindings }>()
  .get("/admin/campaigns", async (c) =>
    c.json(
      await listPlatformCampaigns(
        c.env.DB,
        (await requireVerifiedSession(c)).user.id,
        c.req.query()
      )
    )
  )
  .get("/admin/operations", async (c) =>
    c.json(
      await listOperations(
        c.env.DB,
        (await requireVerifiedSession(c)).user.id,
        c.req.query()
      )
    )
  )
  .get("/admin/operations/export", async (c) => {
    const page = await exportOperations(
      c.env.DB,
      (await requireVerifiedSession(c)).user.id,
      c.req.query()
    )
    c.header("Content-Type", "text/csv; charset=utf-8")
    c.header(
      "Content-Disposition",
      `attachment; filename="elc-${page.kind}-page.csv"`
    )
    c.header("X-Content-Type-Options", "nosniff")
    return c.body(page.csv)
  })
  .get("/admin/accounts", async (c) =>
    c.json(
      await listAdministration(
        c.env.DB,
        (await requireVerifiedSession(c)).user.id,
        "accounts",
        c.req.query()
      )
    )
  )
  .get("/admin/events", async (c) =>
    c.json(
      await listAdministration(
        c.env.DB,
        (await requireVerifiedSession(c)).user.id,
        "events",
        c.req.query()
      )
    )
  )
  .post("/admin/accounts/:id/suspension", async (c) =>
    c.json(
      await setSuspension(
        c.env.DB,
        (await requireVerifiedSession(c)).user.id,
        "account",
        c.req.param("id"),
        await c.req.json().catch(() => null)
      )
    )
  )
  .post("/admin/events/:id/suspension", async (c) =>
    c.json(
      await setSuspension(
        c.env.DB,
        (await requireVerifiedSession(c)).user.id,
        "event",
        c.req.param("id"),
        await c.req.json().catch(() => null)
      )
    )
  )
