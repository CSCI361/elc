import { Hono, type Context } from "hono"
import type { PaymentAdapter } from "@elc/shared"
import { requirePlatformPermission } from "../auth/permissions"
import { requireSession } from "../auth/session"
import { ApiFailure } from "../db/transitions"
import type { Bindings } from "../env"
import { createPolarSandboxAdapter } from "../payments/polar"
import {
  moderateActivation,
  updateActivation,
  updateActivationSettings,
} from "./mutations"
import { startActivationPayment } from "./payment"
import {
  readActivation,
  readActivationSettings,
  type ActivationDependencies,
} from "./store"

type Environment = { Bindings: Bindings }
type Dependencies = ActivationDependencies & {
  identify?: (context: Context<Environment>) => Promise<string>
  adapter?: PaymentAdapter
}

export function createActivationRoutes(dependencies: Dependencies = {}) {
  const actor =
    dependencies.identify ??
    (async (c: Context<Environment>) => (await requireSession(c)).user.id)
  const clock = dependencies.now ?? Date.now
  function adapter(env: Bindings) {
    if (dependencies.adapter) return dependencies.adapter
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
  return new Hono<Environment>()
    .get("/events/:eventId/activation", async (c) =>
      c.json(
        await readActivation(
          c.env.DB,
          c.req.param("eventId"),
          await actor(c),
          clock()
        )
      )
    )
    .patch("/events/:eventId/activation", async (c) =>
      c.json(
        await updateActivation(
          c.env.DB,
          await actor(c),
          c.req.param("eventId"),
          await c.req.json().catch(() => null),
          dependencies
        )
      )
    )
    .post("/events/:eventId/activation/payment", async (c) => {
      const actorId = await actor(c)
      return c.json(
        await startActivationPayment(
          c.env,
          adapter(c.env),
          actorId,
          c.req.param("eventId"),
          await c.req.json().catch(() => null),
          dependencies
        )
      )
    })
    .get("/platform/activation-settings", async (c) => {
      await requirePlatformPermission(
        c.env.DB,
        await actor(c),
        "platform:configure"
      )
      return c.json(await readActivationSettings(c.env.DB))
    })
    .patch("/platform/activation-settings", async (c) =>
      c.json(
        await updateActivationSettings(
          c.env.DB,
          await actor(c),
          await c.req.json().catch(() => null),
          dependencies
        )
      )
    )
    .get("/platform/events/:eventId/activation", async (c) => {
      const actorId = await actor(c)
      await requirePlatformPermission(c.env.DB, actorId, "platform:moderate")
      return c.json(
        await readActivation(
          c.env.DB,
          c.req.param("eventId"),
          actorId,
          clock(),
          true
        )
      )
    })
    .patch("/platform/events/:eventId/activation", async (c) =>
      c.json(
        await moderateActivation(
          c.env.DB,
          await actor(c),
          c.req.param("eventId"),
          await c.req.json().catch(() => null),
          dependencies
        )
      )
    )
}

export const activationRoutes = createActivationRoutes()
export { activationEligibilitySql, paidSalesEligibilitySql } from "./guards"
export { completeActivation, completedActivation } from "./complete"
