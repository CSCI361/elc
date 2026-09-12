import { DurableObject } from "cloudflare:workers"
import { app } from "./app"
import type { Bindings } from "./env"
import { createPolarSandboxAdapter } from "./payments/polar"
import { consumePaymentOutbox, dispatchPaymentOutbox } from "./payments/outbox"

export type { AppType } from "./app"

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, context) {
    context.waitUntil(dispatchPaymentOutbox(env))
  },
  async queue(batch, env) {
    const adapter = createPolarSandboxAdapter(env)
    for (const message of batch.messages) {
      try {
        const body = message.body
        if (
          typeof body !== "object" ||
          body === null ||
          !("id" in body) ||
          typeof body.id !== "string" ||
          body.id.length > 256
        ) {
          message.ack()
          continue
        }
        const handled = await consumePaymentOutbox(env, adapter, body.id)
        if (handled) message.ack()
        else message.retry({ delaySeconds: 60 })
      } catch {
        message.retry({ delaySeconds: 60 })
      }
    }
  },
} satisfies ExportedHandler<Bindings>

// The binding is reserved for case-scoped subscriptions; it denies access until
// participant authorization and committed-update delivery are implemented.
export class SupportCase extends DurableObject<Bindings> {
  fetch() {
    return new Response("Not found", { status: 404 })
  }
}
