import { Hono } from "hono"
import { requireVerifiedSession } from "../auth/session"
import type { Bindings } from "../env"
import { dispatchPaymentOutbox } from "../payments/outbox"
import { cancelEvent } from "./cancellation"

export const cancellationRoutes = new Hono<{
  Bindings: Bindings
  Variables: { requestId: string }
}>().post("/events/:eventId/cancel", async (c) => {
  const session = await requireVerifiedSession(c)
  const result = await cancelEvent(
    {
      db: c.env.DB,
      actorId: session.user.id,
      appOrigin: c.env.APP_ORIGIN,
      correlationId: c.get("requestId"),
      now: Date.now(),
    },
    c.req.param("eventId"),
    await c.req.json().catch(() => null)
  )
  c.executionCtx.waitUntil(dispatchPaymentOutbox(c.env))
  return c.json(result)
})
