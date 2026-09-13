// Test-only entry point. Never imported by the application Worker.
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { secureHeaders } from "hono/secure-headers"
import { createAuth } from "../../auth"
import { ApiFailure } from "../../db/transitions"
import type { Bindings } from "../../env"
import { createSupportRoutes } from "../index"
import { validateAttachment } from "./validate"
import { AttachmentValidationError } from "./limits"

const app = new Hono<{ Bindings: Bindings }>()
  .use("*", secureHeaders())
  .on(["GET", "POST"], "/api/auth/*", (c) =>
    createAuth(c.env).handler(c.req.raw)
  )
  .post("/__test/validate", async (c) => {
    try {
      const result = await validateAttachment(
        new Uint8Array(await c.req.arrayBuffer()),
        c.req.header("Content-Type") ?? ""
      )
      return new Response(new Uint8Array(result.bytes).buffer, {
        headers: { "Content-Type": result.contentType },
      })
    } catch (error) {
      return c.json(
        {
          code:
            error instanceof AttachmentValidationError
              ? error.code
              : "UNEXPECTED",
        },
        422
      )
    }
  })
  .route("/api", createSupportRoutes())
  .onError((error, c) =>
    c.json(
      { code: error instanceof ApiFailure ? error.code : "REQUEST_FAILED" },
      error instanceof ApiFailure
        ? error.status
        : error instanceof HTTPException
          ? error.status
          : 500
    )
  )
export default app
