import { Hono } from "hono"
import { requireVerifiedSession } from "../auth/session"
import type { Bindings } from "../env"
import { readEventPayouts } from "./payout-read"

export const payoutRoutes = new Hono<{ Bindings: Bindings }>().get(
  "/events/:eventId/payouts",
  async (c) => {
    const session = await requireVerifiedSession(c)
    return c.json(
      await readEventPayouts(
        c.env.DB,
        session.user.id,
        c.req.param("eventId"),
        c.req.query()
      )
    )
  }
)
