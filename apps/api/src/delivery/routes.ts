import { Hono } from "hono"
import { requireVerifiedSession } from "../auth/session"
import type { Bindings } from "../env"
import {
  listDeliveries,
  readDelivery,
  requestDeliveryRecovery,
} from "./recovery"

export const deliveryRoutes = new Hono<{ Bindings: Bindings }>()
  .get("/admin/deliveries", async (c) => {
    const session = await requireVerifiedSession(c)
    return c.json(
      await listDeliveries(c.env.DB, session.user.id, c.req.query())
    )
  })
  .get("/admin/deliveries/:deliveryId", async (c) => {
    const session = await requireVerifiedSession(c)
    return c.json(
      await readDelivery(c.env.DB, session.user.id, c.req.param("deliveryId"))
    )
  })
  .post("/admin/deliveries/:deliveryId/recover", async (c) => {
    const session = await requireVerifiedSession(c)
    return c.json(
      await requestDeliveryRecovery(
        c.env.DB,
        session.user.id,
        c.req.param("deliveryId"),
        await c.req.json<unknown>().catch(() => null)
      )
    )
  })
