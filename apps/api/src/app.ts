import { Hono } from "hono"
import type { ApiErrorCode } from "@elc/shared"
import { HTTPException } from "hono/http-exception"
import { secureHeaders } from "hono/secure-headers"
import { createAuth, getAuthCapabilities, type AuthDependencies } from "./auth"
import { requireVerifiedSession } from "./auth/session"
import type { Bindings } from "./env"

function authenticationDependencies(env: Bindings): AuthDependencies {
  if (env.ENVIRONMENT !== "local") return {}
  return {
    sendEmail: async (email) => {
      await env.DB.prepare(
        "INSERT INTO development_mail (id, recipient, kind, subject, body, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
        .bind(
          crypto.randomUUID(),
          email.to,
          email.kind,
          email.subject,
          email.text,
          Date.now()
        )
        .run()
    },
  }
}

export const app = new Hono<{
  Bindings: Bindings
  Variables: { requestId: string }
}>()
  .use("*", secureHeaders())
  .use("/api/*", async (c, next) => {
    const requestId = crypto.randomUUID()
    c.set("requestId", requestId)
    c.header("X-Request-ID", requestId)
    c.header("Cache-Control", "no-store")
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const origin = c.req.header("Origin")
      const site = c.req.header("Sec-Fetch-Site")
      if (
        (origin && ![c.env.APP_ORIGIN, "elc://"].includes(origin)) ||
        (!origin && site && site !== "same-origin" && site !== "none")
      ) {
        throw new HTTPException(403, {
          message: "This request origin is not permitted.",
        })
      }
    }
    await next()
  })
  .get("/api/health", async (c) => {
    await c.env.DB.prepare("SELECT 1").first()
    return c.json({
      service: "elc",
      environment: c.env.ENVIRONMENT,
      database: "ready",
    })
  })
  .get("/api/auth-capabilities", (c) =>
    c.json(getAuthCapabilities(c.env, authenticationDependencies(c.env)))
  )
  .on(["GET", "POST"], "/api/auth/*", (c) =>
    createAuth(c.env, authenticationDependencies(c.env)).handler(c.req.raw)
  )
  .get("/api/me", async (c) => {
    const session = await requireVerifiedSession(c)
    return c.json({
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        emailVerified: session.user.emailVerified,
      },
    })
  })
  .all("/api/*", (c) =>
    c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Endpoint not found",
          requestId: c.get("requestId"),
        },
      },
      404
    )
  )

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    const codes: Record<number, ApiErrorCode> = {
      400: "INVALID_INPUT",
      401: "UNAUTHENTICATED",
      403: "FORBIDDEN",
      404: "NOT_FOUND",
      409: "CONFLICT",
      429: "RATE_LIMITED",
      503: "SERVICE_UNAVAILABLE",
    }
    return c.json(
      {
        error: {
          code: codes[error.status] ?? "INTERNAL_ERROR",
          message: error.message,
          requestId: c.get("requestId"),
        },
      },
      error.status
    )
  }
  // Do not expose raw provider/database errors, credentials or personal content.
  console.error(
    JSON.stringify({ code: "INTERNAL_ERROR", requestId: c.get("requestId") })
  )
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        requestId: c.get("requestId"),
      },
    },
    500
  )
})

export type AppType = typeof app
