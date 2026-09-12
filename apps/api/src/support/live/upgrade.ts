import type { Context } from "hono"
import { requireSession } from "../../auth/session"
import { ApiFailure } from "../../db/transitions"
import type { Bindings } from "../../env"
import { requireSupportCase } from "../store"
import { liveQuerySchema, SUPPORT_PROTOCOL } from "./protocol"

/** Authenticate at the public API; caller-supplied internal headers are never forwarded. */
export async function upgradeSupportLive(c: Context<{ Bindings: Bindings }>) {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket")
    return new Response("WebSocket upgrade required.", {
      status: 426,
      headers: { Upgrade: "websocket" },
    })
  const origin = new URL(c.env.APP_ORIGIN).origin
  if (
    c.req.header("Origin") !== origin ||
    c.req.header("Sec-Fetch-Site") === "cross-site"
  )
    throw new ApiFailure(
      "FORBIDDEN",
      403,
      "This WebSocket origin is not permitted."
    )
  const protocols =
    c.req
      .header("Sec-WebSocket-Protocol")
      ?.split(",")
      .map((value) => value.trim()) ?? []
  if (!protocols.includes(SUPPORT_PROTOCOL))
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Use the supported support WebSocket protocol."
    )
  const parsed = liveQuerySchema.safeParse(c.req.query())
  if (!parsed.success)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "Provide a valid support update cursor."
    )
  // This intentionally ignores the test-only identity override used by REST route unit tests.
  const session = await requireSession(c)
  const caseId = c.req.param("caseId") ?? ""
  if (!caseId || caseId.length > 128)
    throw new ApiFailure("INVALID_INPUT", 400, "Provide a valid support case.")
  const supportCase = await requireSupportCase(
    c.env.DB,
    session.user.id,
    caseId
  )
  if (parsed.data.after > supportCase.last_sequence)
    throw new ApiFailure(
      "INVALID_INPUT",
      400,
      "The update cursor is ahead of this case."
    )
  const url = new URL("https://support.internal/connect")
  url.searchParams.set("caseId", caseId)
  url.searchParams.set("after", String(parsed.data.after))
  const response = await c.env.SUPPORT.get(
    c.env.SUPPORT.idFromName(caseId)
  ).fetch(
    new Request(url, {
      headers: {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": SUPPORT_PROTOCOL,
        "X-Elc-Actor": session.user.id,
        "X-Elc-Session": session.session.id,
      },
    })
  )
  // Fetch responses have immutable headers. Preserve the upgrade while allowing
  // the application's secure-header middleware to finish normally.
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
    ...(response.webSocket ? { webSocket: response.webSocket } : {}),
  })
}
