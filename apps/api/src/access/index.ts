import { Hono, type Context } from "hono"
import { requireSession } from "../auth/session"
import type { Bindings } from "../env"
import {
  acceptEventInvitation,
  createEventInvitation,
  listEventInvitations,
  reissueEventInvitation,
  revokeEventInvitation,
} from "./invitations"
import { listEventStaff, replaceEventStaff } from "./staff"
import type { AccessDependencies } from "./store"

type Environment = { Bindings: Bindings }
type Dependencies = AccessDependencies & {
  identify?: (context: Context<Environment>) => Promise<string>
}
export function createAccessRoutes(dependencies: Dependencies = {}) {
  const actor =
    dependencies.identify ??
    (async (c: Context<Environment>) => (await requireSession(c)).user.id)
  const clock = dependencies.now ?? Date.now
  return new Hono<Environment>()
    .get("/events/:eventId/staff", async (c) =>
      c.json(
        await listEventStaff(
          c.env.DB,
          await actor(c),
          c.req.param("eventId"),
          c.req.query()
        )
      )
    )
    .patch("/events/:eventId/staff", async (c) =>
      c.json(
        await replaceEventStaff(
          c.env.DB,
          await actor(c),
          c.req.param("eventId"),
          await c.req.json().catch(() => null),
          dependencies
        )
      )
    )
    .get("/events/:eventId/invitations", async (c) =>
      c.json(
        await listEventInvitations(
          c.env.DB,
          await actor(c),
          c.req.param("eventId"),
          c.req.query(),
          clock()
        )
      )
    )
    .post("/events/:eventId/invitations", async (c) =>
      c.json(
        await createEventInvitation(
          c.env,
          await actor(c),
          c.req.param("eventId"),
          await c.req.json().catch(() => null),
          dependencies
        ),
        201
      )
    )
    .post("/events/:eventId/invitations/:invitationId/reissue", async (c) =>
      c.json(
        await reissueEventInvitation(
          c.env,
          await actor(c),
          c.req.param("eventId"),
          c.req.param("invitationId"),
          await c.req.json().catch(() => null),
          dependencies
        ),
        201
      )
    )
    .post("/events/:eventId/invitations/:invitationId/revoke", async (c) =>
      c.json(
        await revokeEventInvitation(
          c.env.DB,
          await actor(c),
          c.req.param("eventId"),
          c.req.param("invitationId"),
          await c.req.json().catch(() => null),
          dependencies
        )
      )
    )
    .post("/invitations/accept", async (c) =>
      c.json(
        await acceptEventInvitation(
          c.env.DB,
          await actor(c),
          await c.req.json().catch(() => null),
          dependencies
        )
      )
    )
}
export const accessRoutes = createAccessRoutes()
