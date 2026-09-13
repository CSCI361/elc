import { Hono, type Context } from "hono"
import { bodyLimit } from "hono/body-limit"
import { requireVerifiedSession } from "../auth/session"
import { ApiFailure } from "../db/transitions"
import type { Bindings } from "../env"
import {
  readOrganizerProfile,
  updateOrganizerProfile,
  type ProfileDependencies,
} from "./service"

type Environment = { Bindings: Bindings; Variables: { requestId: string } }
export function createOrganizerProfileRoutes(
  dependencies: ProfileDependencies & {
    identify?: (context: Context<Environment>) => Promise<string>
  } = {}
) {
  const identify =
    dependencies.identify ??
    (async (c: Context<Environment>) =>
      (await requireVerifiedSession(c)).user.id)
  return new Hono<Environment>()
    .get("/me/organizer-profile", async (c) => {
      c.header("Cache-Control", "private, no-store")
      c.header("Vary", "Cookie")
      return c.json(
        await readOrganizerProfile(c.env.DB, await identify(c), dependencies)
      )
    })
    .patch(
      "/me/organizer-profile",
      bodyLimit({
        maxSize: 4 * 1024,
        onError: () => {
          throw new ApiFailure(
            "INVALID_INPUT",
            413,
            "The organizer profile request is too large."
          )
        },
      }),
      async (c) => {
        c.header("Cache-Control", "private, no-store")
        c.header("Vary", "Cookie")
        return c.json(
          await updateOrganizerProfile(
            c.env.DB,
            await identify(c),
            await c.req.json().catch(() => null),
            dependencies
          )
        )
      }
    )
}
export const organizerProfileRoutes = createOrganizerProfileRoutes()
