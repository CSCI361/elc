import type { PaymentAdapter } from "@elc/shared"
import { app } from "./app"
import type { Bindings } from "./env"
import { createPolarSandboxAdapter } from "./payments/polar"
import { consumePaymentOutbox, dispatchPaymentOutbox } from "./payments/outbox"
import { simulateDuePayouts } from "./payments/payouts"
import { cleanupSupportAttachments } from "./support"
import {
  consumeSupportLiveOutbox,
  dispatchSupportLiveOutbox,
} from "./support/live/outbox"
import fontBytes from "./exports/assets/NotoSans-Regular.bin"
import { createResendEmailAdapter } from "./delivery/email"
import { createDeliverySources } from "./delivery/sources"
import {
  consumeEmailDelivery,
  dispatchEmailDeliveries,
  type DeliveryDependencies,
} from "./delivery/jobs"
import {
  consumeNotificationOutbox,
  dispatchNotificationOutbox,
} from "./delivery/fanout"
import { cleanupDeliveryPayloads } from "./delivery/payload-cleanup"
import { cleanupTrafficReports } from "./traffic/read"
import { recoveryPaused } from "./recovery/gate"
import { sweepExpiredReservations } from "./orders/expiry"
import { runRetentionCleanup } from "./retention"
import { cleanupEventImageAssets } from "./events/images/cleanup"
import {
  cleanupAuthEmailIntents,
  createAuthDeliverySources,
  isAuthDelivery,
} from "./auth/delivery"

export type { AppType } from "./app"
export { SupportCase } from "./support/live/room"

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, context) {
    if (recoveryPaused(env)) return
    if (_controller.cron === "0 0 * * *")
      context.waitUntil(
        (async () => {
          await cleanupAuthEmailIntents(env)
          await runRetentionCleanup(env)
        })()
      )
    context.waitUntil(sweepExpiredReservations(env))
    context.waitUntil(dispatchPaymentOutbox(env))
    context.waitUntil(dispatchSupportLiveOutbox(env))
    context.waitUntil(simulateDuePayouts(env.DB))
    context.waitUntil(cleanupSupportAttachments(env))
    context.waitUntil(dispatchNotificationOutbox(env))
    context.waitUntil(dispatchEmailDeliveries(env))
    context.waitUntil(cleanupDeliveryPayloads(env))
    context.waitUntil(cleanupTrafficReports(env.DB))
    context.waitUntil(cleanupAuthEmailIntents(env))
    context.waitUntil(cleanupEventImageAssets(env.DB))
  },
  async queue(batch, env) {
    if (recoveryPaused(env)) {
      batch.retryAll({ delaySeconds: 60 })
      return
    }
    let provider: PaymentAdapter | undefined
    const adapter = () => (provider ??= createPolarSandboxAdapter(env))
    let emailDependencies: DeliveryDependencies | undefined
    const email = () => {
      const business = createDeliverySources(env, {
        fontBytes: new Uint8Array(fontBytes),
      })
      const auth = createAuthDeliverySources(env)
      return (emailDependencies ??= {
        readCurrent: (row) =>
          (isAuthDelivery(row) ? auth : business).readCurrent(row),
        prepare: (row, current) =>
          (isAuthDelivery(row) ? auth : business).prepare(row, current),
        adapter: createResendEmailAdapter({ apiKey: env.RESEND_API_KEY }),
        available:
          env.ENVIRONMENT === "local" ||
          /^[A-Za-z0-9_-]{1,256}$/.test(env.RESEND_API_KEY ?? ""),
      })
    }
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
        if (await consumeNotificationOutbox(env, body.id)) {
          // Publish newly committed recipients promptly. D1 retains every unfinished step if publication fails.
          await dispatchEmailDeliveries(env)
          const remaining = await env.DB.prepare(
            "SELECT next_attempt_at FROM outbox WHERE id=? AND completed_at IS NULL"
          )
            .bind(body.id)
            .first<{ next_attempt_at: number }>()
          if (remaining) {
            try {
              await env.DELIVERY.send(
                { id: body.id },
                {
                  delaySeconds: Math.max(
                    1,
                    Math.min(
                      60,
                      Math.ceil((remaining.next_attempt_at - Date.now()) / 1000)
                    )
                  ),
                }
              )
            } catch {
              // Cron also resumes bounded fanout from the same committed cursor.
            }
          }
          message.ack()
          continue
        }
        const handled =
          (await consumeSupportLiveOutbox(env, body.id)) ||
          (body.id.startsWith("email:") &&
            (await consumeEmailDelivery(env, body.id, email()))) ||
          (await consumePaymentOutbox(env, adapter, body.id))
        if (handled) message.ack()
        else message.retry({ delaySeconds: 60 })
      } catch {
        message.retry({ delaySeconds: 60 })
      }
    }
  },
} satisfies ExportedHandler<Bindings>
