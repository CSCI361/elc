import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { ProviderOperationError } from "@elc/shared"
import { requireVerifiedSession } from "../auth/session"
import { ApiFailure } from "../db/transitions"
import type { Bindings } from "../env"
import { startOrderPayment } from "./checkout"
import { dispatchPaymentOutbox } from "./outbox"
import { createPolarSandboxAdapter } from "./polar"
import { processPayment } from "./reconcile"
import { readPayment } from "./store"
import { acceptProviderWebhook } from "./webhooks"

function adapter(env: Bindings) {
  try {
    return createPolarSandboxAdapter(env)
  } catch {
    throw new ApiFailure(
      "SERVICE_UNAVAILABLE",
      503,
      "Sandbox payments are not configured."
    )
  }
}

export const paymentRoutes = new Hono<{ Bindings: Bindings }>()
  .post("/orders/:orderId/payment", async (c) => {
    const session = await requireVerifiedSession(c)
    const result = await startOrderPayment(
      c.env,
      adapter(c.env),
      session.user.id,
      c.req.param("orderId"),
      await c.req.json().catch(() => null)
    )
    c.executionCtx.waitUntil(dispatchPaymentOutbox(c.env))
    return c.json(result)
  })
  .get("/payments/:paymentId", async (c) => {
    const session = await requireVerifiedSession(c)
    return c.json(
      await readPayment(c.env.DB, session.user.id, c.req.param("paymentId"))
    )
  })
  .post("/payments/:paymentId/reconcile", async (c) => {
    const session = await requireVerifiedSession(c)
    await readPayment(c.env.DB, session.user.id, c.req.param("paymentId"))
    await processPayment(c.env, adapter(c.env), c.req.param("paymentId"))
    return c.json(
      await readPayment(c.env.DB, session.user.id, c.req.param("paymentId"))
    )
  })
  .post(
    "/webhooks/polar",
    bodyLimit({
      maxSize: 256 * 1024,
      onError: () => {
        throw new ApiFailure(
          "INVALID_INPUT",
          400,
          "The provider webhook is too large."
        )
      },
    }),
    async (c) => {
      try {
        const result = await acceptProviderWebhook(
          c.env.DB,
          adapter(c.env),
          await c.req.text(),
          c.req.header()
        )
        c.executionCtx.waitUntil(dispatchPaymentOutbox(c.env))
        return c.json(result, 202)
      } catch (error) {
        if (error instanceof ProviderOperationError)
          throw new ApiFailure(
            "INVALID_INPUT",
            400,
            "The provider webhook could not be verified."
          )
        throw error
      }
    }
  )
