import type { PaymentAdapter } from "@elc/shared"
import { app } from "./app"
import type { Bindings } from "./env"
import { createPolarSandboxAdapter } from "./payments/polar"
import { consumePaymentOutbox, dispatchPaymentOutbox } from "./payments/outbox"
import { simulateDuePayouts } from "./payments/payouts"
import {
  consumeSupportLiveOutbox,
  dispatchSupportLiveOutbox,
} from "./support/live/outbox"

export type { AppType } from "./app"
export { SupportCase } from "./support/live/room"

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, context) {
    context.waitUntil(dispatchPaymentOutbox(env))
    context.waitUntil(dispatchSupportLiveOutbox(env))
    context.waitUntil(simulateDuePayouts(env.DB))
  },
  async queue(batch, env) {
    let provider: PaymentAdapter | undefined
    const adapter = () => (provider ??= createPolarSandboxAdapter(env))
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
        const handled =
          (await consumeSupportLiveOutbox(env, body.id)) ||
          (await consumePaymentOutbox(env, adapter, body.id))
        if (handled) message.ack()
        else message.retry({ delaySeconds: 60 })
      } catch {
        message.retry({ delaySeconds: 60 })
      }
    }
  },
} satisfies ExportedHandler<Bindings>
