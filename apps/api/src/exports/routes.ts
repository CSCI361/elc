import { Hono, type Context } from "hono"
import { calendarExportResponseSchema } from "@elc/shared"
import { HTTPException } from "hono/http-exception"
import { requireSession } from "../auth/session"
import { ApiFailure } from "../db/transitions"
import type { Bindings } from "../env"
import { readCalendarExport } from "./calendar"
import type { ExportLocale } from "./labels"
import { downloadTicketPdf } from "./ticket-pdf"

type Environment = { Bindings: Bindings }
type Dependencies = {
  fontBytes: Uint8Array
  identify?: (context: Context<Environment>) => Promise<string | undefined>
}

async function sessionActor(context: Context<Environment>) {
  try {
    return (await requireSession(context)).user.id
  } catch (error) {
    if (error instanceof HTTPException && error.status === 401) return undefined
    throw error
  }
}

function locale(context: Context<Environment>): ExportLocale {
  const value = context.req.query("locale") ?? "kk"
  if (value !== "kk" && value !== "ru" && value !== "en")
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Choose kk, ru or en for the export language."
    )
  return value
}

export function createExportRoutes(dependencies: Dependencies) {
  const identify = dependencies.identify ?? sessionActor
  return new Hono<Environment>()
    .get("/tickets/:ticketId/pdf", async (context) => {
      const actorId = await identify(context)
      if (!actorId)
        throw new ApiFailure(
          "UNAUTHENTICATED",
          401,
          "Sign in to download a ticket."
        )
      return downloadTicketPdf(
        context.env,
        actorId,
        context.req.param("ticketId"),
        locale(context),
        dependencies.fontBytes
      )
    })
    .get("/events/:eventId/calendar", async (context) => {
      const { ics: _ics, ...result } = await readCalendarExport(
        context.env.DB,
        context.env.APP_ORIGIN,
        context.req.param("eventId"),
        await identify(context),
        locale(context)
      )
      context.header("Cache-Control", "private, no-store")
      context.header("Referrer-Policy", "no-referrer")
      return context.json(calendarExportResponseSchema.parse(result))
    })
    .get("/events/:eventId/calendar.ics", async (context) => {
      const result = await readCalendarExport(
        context.env.DB,
        context.env.APP_ORIGIN,
        context.req.param("eventId"),
        await identify(context),
        locale(context)
      )
      return new Response(result.ics, {
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": 'attachment; filename="elc-event.ics"',
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        },
      })
    })
}
