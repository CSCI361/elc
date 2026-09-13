import { Hono, type Context } from "hono"
import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import {
  createCampaignRequestSchema,
  createEventRequestSchema,
  createTicketTypeRequestSchema,
  eventListQuerySchema,
  eventRevisionRequestSchema,
  paginationQuerySchema,
  updateEventRequestSchema,
  updateSeatRequestSchema,
  updateTicketTypeRequestSchema,
} from "@elc/shared"
import { requireSession } from "../auth/session"
import { ApiFailure } from "../db/transitions"
import type { Bindings } from "../env"
import {
  createCampaign,
  createEvent,
  createTicketType,
  setCampaignEnabled,
  setPublication,
  setSeatEnabled,
  updateEvent,
  updateTicketType,
} from "./mutations"
import { listEvents, readCampaigns, readEvent, readInventory } from "./queries"
import type { EventContext } from "./store"
import { createEventImageRoutes } from "./images/routes"

type Environment = { Bindings: Bindings; Variables: { requestId: string } }
type Dependencies = {
  identify?: (context: Context<Environment>) => Promise<string | undefined>
  now?: () => number
}

async function sessionActor(context: Context<Environment>) {
  try {
    return (await requireSession(context)).user.id
  } catch (error) {
    if (error instanceof HTTPException && error.status === 401) return undefined
    throw error
  }
}

function parse<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown
): z.output<Schema> {
  const result = schema.safeParse(value)
  if (!result.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "The request contains missing or invalid fields."
    )
  return result.data
}

async function body<Schema extends z.ZodType>(
  context: Context<Environment>,
  schema: Schema
) {
  let value: unknown
  try {
    value = await context.req.json()
  } catch {
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "A JSON request body is required."
    )
  }
  return parse(schema, value)
}

const inventoryQuerySchema = z.strictObject({
  preview: z.enum(["true", "false"]).optional(),
})

export function createEventsRoutes(dependencies: Dependencies = {}) {
  const identify = dependencies.identify ?? sessionActor
  const now = dependencies.now ?? Date.now
  async function actor(context: Context<Environment>) {
    const actorId = await identify(context)
    if (!actorId)
      throw new ApiFailure("UNAUTHENTICATED", 401, "Sign in to continue.")
    return actorId
  }
  async function mutationContext(
    context: Context<Environment>
  ): Promise<EventContext> {
    return {
      db: context.env.DB,
      actorId: await actor(context),
      correlationId: context.get("requestId") ?? crypto.randomUUID(),
      appOrigin: context.env.APP_ORIGIN,
      now: now(),
    }
  }
  return new Hono<Environment>()
    .route("/", createEventImageRoutes({ ...dependencies, identify }))
    .get("/events", async (c) =>
      c.json(
        await listEvents(
          c.env.DB,
          parse(eventListQuerySchema, c.req.query()),
          now()
        )
      )
    )
    .get("/organizer/events", async (c) =>
      c.json(
        await listEvents(
          c.env.DB,
          parse(eventListQuerySchema, c.req.query()),
          now(),
          await actor(c)
        )
      )
    )
    .post("/events", async (c) =>
      c.json(
        await createEvent(
          await mutationContext(c),
          await body(c, createEventRequestSchema)
        ),
        201
      )
    )
    .get("/events/:eventId", async (c) =>
      c.json(
        await readEvent(
          c.env.DB,
          c.req.param("eventId"),
          now(),
          await identify(c)
        )
      )
    )
    .get("/events/:eventId/preview", async (c) =>
      c.json(
        await readEvent(
          c.env.DB,
          c.req.param("eventId"),
          now(),
          await actor(c),
          true
        )
      )
    )
    .patch("/events/:eventId", async (c) =>
      c.json(
        await updateEvent(
          await mutationContext(c),
          c.req.param("eventId"),
          await body(c, updateEventRequestSchema)
        )
      )
    )
    .post("/events/:eventId/publish", async (c) =>
      c.json(
        await setPublication(
          await mutationContext(c),
          c.req.param("eventId"),
          await body(c, eventRevisionRequestSchema),
          true
        )
      )
    )
    .post("/events/:eventId/unpublish", async (c) =>
      c.json(
        await setPublication(
          await mutationContext(c),
          c.req.param("eventId"),
          await body(c, eventRevisionRequestSchema),
          false
        )
      )
    )
    .get("/events/:eventId/inventory", async (c) => {
      const query = parse(inventoryQuerySchema, c.req.query())
      return c.json(
        await readInventory(
          c.env.DB,
          c.req.param("eventId"),
          now(),
          await identify(c),
          query.preview === "true"
        )
      )
    })
    .post("/events/:eventId/ticket-types", async (c) =>
      c.json(
        await createTicketType(
          await mutationContext(c),
          c.req.param("eventId"),
          await body(c, createTicketTypeRequestSchema)
        ),
        201
      )
    )
    .patch("/events/:eventId/ticket-types/:ticketTypeId", async (c) =>
      c.json(
        await updateTicketType(
          await mutationContext(c),
          c.req.param("eventId"),
          c.req.param("ticketTypeId"),
          await body(c, updateTicketTypeRequestSchema)
        )
      )
    )
    .patch("/events/:eventId/inventory/:seatId", async (c) =>
      c.json(
        await setSeatEnabled(
          await mutationContext(c),
          c.req.param("eventId"),
          c.req.param("seatId"),
          await body(c, updateSeatRequestSchema)
        )
      )
    )
    .post("/events/:eventId/campaigns", async (c) =>
      c.json(
        await createCampaign(
          await mutationContext(c),
          c.req.param("eventId"),
          await body(c, createCampaignRequestSchema)
        ),
        201
      )
    )
    .get("/events/:eventId/campaigns", async (c) =>
      c.json(
        await readCampaigns(
          c.env.DB,
          c.req.param("eventId"),
          await actor(c),
          c.env.APP_ORIGIN,
          undefined,
          parse(paginationQuerySchema, c.req.query())
        )
      )
    )
    .get("/events/:eventId/campaigns/:campaignId", async (c) =>
      c.json(
        (
          await readCampaigns(
            c.env.DB,
            c.req.param("eventId"),
            await actor(c),
            c.env.APP_ORIGIN,
            c.req.param("campaignId")
          )
        ).items[0]
      )
    )
    .post("/events/:eventId/campaigns/:campaignId/enable", async (c) =>
      c.json(
        await setCampaignEnabled(
          await mutationContext(c),
          c.req.param("eventId"),
          c.req.param("campaignId"),
          await body(c, eventRevisionRequestSchema),
          true
        )
      )
    )
    .post("/events/:eventId/campaigns/:campaignId/disable", async (c) =>
      c.json(
        await setCampaignEnabled(
          await mutationContext(c),
          c.req.param("eventId"),
          c.req.param("campaignId"),
          await body(c, eventRevisionRequestSchema),
          false
        )
      )
    )
}

export const eventsRoutes = createEventsRoutes()
