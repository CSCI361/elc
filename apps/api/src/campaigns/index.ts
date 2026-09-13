import { Hono, type Context } from "hono"
import { bodyLimit } from "hono/body-limit"
import { HTTPException } from "hono/http-exception"
import type { Bindings } from "../env"
import { requireSession } from "../auth/session"
import { ApiFailure } from "../db/transitions"
import { resolveCampaign, type CampaignDependencies } from "./resolve"

type Environment = { Bindings: Bindings; Variables: { requestId: string } }
type Dependencies = CampaignDependencies & {
  identify?: (context: Context<Environment>) => Promise<string | undefined>
}
async function sessionActor(c: Context<Environment>) {
  try {
    return (await requireSession(c)).user.id
  } catch (error) {
    if (error instanceof HTTPException && error.status === 401) return undefined
    throw error
  }
}
export function createCampaignRoutes(dependencies: Dependencies = {}) {
  const identify = dependencies.identify ?? sessionActor
  return new Hono<Environment>().post(
    "/events/:eventId/campaigns/resolve",
    bodyLimit({
      maxSize: 4 * 1024,
      onError: () => {
        throw new ApiFailure(
          "INVALID_INPUT",
          413,
          "The campaign request is too large."
        )
      },
    }),
    async (c) => {
      c.header("Cache-Control", "private, no-store")
      c.header("Vary", "Cookie")
      return c.json(
        await resolveCampaign(
          c.env.DB,
          c.req.param("eventId"),
          await c.req.json().catch(() => null),
          await identify(c),
          dependencies
        )
      )
    }
  )
}
