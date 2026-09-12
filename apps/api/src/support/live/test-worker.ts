// Built only by live integration tests. This entry point is never imported by the application.
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { secureHeaders } from "hono/secure-headers"
import { createAuth } from "../../auth"
import type { Bindings } from "../../env"
import { createSupportRoutes } from "../index"
import { SupportCase } from "./room"
import { consumeSupportLiveOutbox } from "./outbox"

export class TestSupportCase extends SupportCase {
  subscriptionActors() {
    return this.ctx
      .getWebSockets()
      .map((socket) => socket.deserializeAttachment()?.actorId as string)
  }
  async forceRevalidation() {
    await this.alarm()
  }
}

const app = new Hono<{ Bindings: Bindings }>()
  .use("*", secureHeaders())
  .on(["GET", "POST"], "/api/auth/*", (c) =>
    createAuth(c.env).handler(c.req.raw)
  )
  .route("/api", createSupportRoutes())
  .onError((error, c) =>
    c.json(
      {
        error: {
          code: "TEST_REQUEST_FAILED",
          name: error.name,
          message: error.message,
        },
      },
      error instanceof HTTPException ? error.status : 500
    )
  )

export default {
  fetch: app.fetch,
  async queue(batch, env) {
    for (const message of batch.messages) {
      if (await consumeSupportLiveOutbox(env, message.body.id)) message.ack()
      else message.retry()
    }
  },
} satisfies ExportedHandler<Bindings, { id: string }>
