import { Hono } from "hono"
import { requireVerifiedSession } from "../auth/session"
import type { Bindings } from "../env"
import { dispatchPaymentOutbox } from "./outbox"
import { readOrderRefund } from "./refund-read"
import { approveOrderRefund, cancelFreeRegistration } from "./voluntary"

export const refundRoutes = new Hono<{ Bindings: Bindings }>()
  .get("/orders/:orderId/refund", async (c) => {
    const session = await requireVerifiedSession(c)
    return c.json(
      await readOrderRefund(c.env.DB, session.user.id, c.req.param("orderId"))
    )
  })
  .post("/orders/:orderId/refund", async (c) => {
    const session = await requireVerifiedSession(c)
    const result = await approveOrderRefund(
      c.env.DB,
      session.user.id,
      c.req.param("orderId"),
      await c.req.json().catch(() => null)
    )
    c.executionCtx.waitUntil(dispatchPaymentOutbox(c.env))
    return c.json(result, 202)
  })
  .post("/orders/:orderId/cancel-registration", async (c) => {
    const session = await requireVerifiedSession(c)
    return c.json(
      await cancelFreeRegistration(
        c.env.DB,
        session.user.id,
        c.req.param("orderId"),
        await c.req.json().catch(() => null)
      )
    )
  })
