import { Hono } from "hono"
import { requireVerifiedSession } from "../auth/session"
import type { Bindings } from "../env"
import { listAdministration, setSuspension } from "./service"

export const administrationRoutes = new Hono<{ Bindings: Bindings }>()
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
