import { Hono } from "hono"
import { requireVerifiedSession } from "../auth/session"
import type { Bindings } from "../env"
import { dispatchPaymentOutbox } from "./outbox"
import { readOrderRefund } from "./refund-read"
import { approveOrderRefund, cancelFreeRegistration } from "./voluntary"
import { readRefundRecovery, requestRefundRecovery } from "./refund-recovery"

export const refundRoutes = new Hono<{ Bindings: Bindings }>()
  .get("/refunds/:refundId/recovery", async (c) => {
    const session = await requireVerifiedSession(c)
    return c.json(
      await readRefundRecovery(
        c.env.DB,
        session.user.id,
        c.req.param("refundId")
      )
    )
  })
  .post("/refunds/:refundId/recovery", async (c) => {
    const session = await requireVerifiedSession(c)
    const response = await requestRefundRecovery(
      c.env.DB,
      session.user.id,
      c.req.param("refundId"),
      await c.req.json().catch(() => null)
    )
    c.executionCtx.waitUntil(dispatchPaymentOutbox(c.env))
    return c.json(response, 202)
  })
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
