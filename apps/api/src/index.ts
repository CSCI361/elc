import { DurableObject } from "cloudflare:workers"
import { app } from "./app"
import type { Bindings } from "./env"

export type { AppType } from "./app"

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Bindings>

// The binding is reserved for case-scoped subscriptions; it denies access until
// participant authorization and committed-update delivery are implemented.
export class SupportCase extends DurableObject<Bindings> {
  fetch() {
    return new Response("Not found", { status: 404 })
  }
}
