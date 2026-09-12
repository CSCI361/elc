import { Hono } from "hono"
import { requireVerifiedSession } from "../auth/session"
import type { Bindings } from "../env"
import { startCheckout, replaceCheckout } from "./checkout"
import { abandonCheckout, readCheckout } from "./lifecycle"

/** Mount at /api; authentication identifies the actor, SQL rechecks eligibility. */
export const orderRoutes = new Hono<{ Bindings: Bindings }>()
  .post("/checkouts", async (c) => {
    const session = await requireVerifiedSession(c)
    return c.json(
      await startCheckout(
        c.env.DB,
        session.user.id,
        await c.req.json<unknown>().catch(() => null)
      ),
      201
    )
  })
  .put("/orders/:orderId/checkout", async (c) => {
    const session = await requireVerifiedSession(c)
    return c.json(
      await replaceCheckout(
        c.env.DB,
        session.user.id,
        c.req.param("orderId"),
        await c.req.json<unknown>().catch(() => null)
      )
    )
  })
  .get("/orders/:orderId", async (c) => {
    const session = await requireVerifiedSession(c)
    return c.json(
      await readCheckout(c.env.DB, session.user.id, c.req.param("orderId"))
    )
  })
  .post("/orders/:orderId/abandon", async (c) => {
    const session = await requireVerifiedSession(c)
    return c.json(
      await abandonCheckout(
        c.env.DB,
        session.user.id,
        c.req.param("orderId"),
        await c.req.json<unknown>().catch(() => null)
      )
    )
  })
