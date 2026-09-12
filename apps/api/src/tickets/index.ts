import { Hono } from "hono"
import {
  completeOrderSchema,
  reverseCheckInSchema,
  scanTicketSchema,
} from "@elc/shared"
import { requireVerifiedSession } from "../auth/session"
import { ApiFailure } from "../db/transitions"
import type { Bindings } from "../env"
import { completeZeroTotalOrder } from "./issue"
import { readOrderTickets, readTicket } from "./read"
import { reverseCheckIn, scanOnline } from "./scan"

export const ticketRoutes = new Hono<{ Bindings: Bindings }>()
  .get("/orders/:orderId/tickets", async (c) => {
    const session = await requireVerifiedSession(c)
    const cursor = c.req.query("cursor")
    if (cursor && cursor.length > 128)
      throw new ApiFailure("INVALID_INPUT", 400, "Invalid ticket cursor.")
    return c.json(
      await readOrderTickets(
        c.env,
        session.user.id,
        c.req.param("orderId"),
        cursor
      )
    )
  })
  .post("/orders/:orderId/complete", async (c) => {
    const session = await requireVerifiedSession(c)
    const parsed = completeOrderSchema.safeParse(
      await c.req.json().catch(() => null)
    )
    if (!parsed.success)
      throw new ApiFailure(
        "INVALID_INPUT",
        400,
        "Provide the current checkout revision and request identifier."
      )
    return c.json(
      await completeZeroTotalOrder(
        c.env,
        session.user.id,
        c.req.param("orderId"),
        parsed.data
      )
    )
  })
  .get("/tickets/:ticketId", async (c) => {
    const session = await requireVerifiedSession(c)
    return c.json(
      await readTicket(c.env, session.user.id, c.req.param("ticketId"))
    )
  })
  .get("/tickets/:ticketId/credential", async (c) => {
    const session = await requireVerifiedSession(c)
    return c.json(
      await readTicket(c.env, session.user.id, c.req.param("ticketId"), true)
    )
  })
  .post("/checkins", async (c) => {
    const session = await requireVerifiedSession(c)
    const parsed = scanTicketSchema.safeParse(
      await c.req.json().catch(() => null)
    )
    if (!parsed.success)
      throw new ApiFailure(
        "INVALID_ADMISSION",
        400,
        "Scan an elc admission ticket."
      )
    return c.json(await scanOnline(c.env.DB, session.user.id, parsed.data))
  })
  .post("/events/:eventId/checkins/:checkInId/reverse", async (c) => {
    const session = await requireVerifiedSession(c)
    const parsed = reverseCheckInSchema.safeParse(
      await c.req.json().catch(() => null)
    )
    if (!parsed.success)
      throw new ApiFailure(
        "INVALID_INPUT",
        400,
        "Provide a reason and request identifier."
      )
    return c.json(
      await reverseCheckIn(
        c.env.DB,
        session.user.id,
        c.req.param("eventId"),
        c.req.param("checkInId"),
        parsed.data
      )
    )
  })
