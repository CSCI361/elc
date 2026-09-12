import { Hono, type Context } from "hono"
import type { SupportMutationResponse } from "@elc/shared"
import { requireSession } from "../auth/session"
import type { Bindings } from "../env"
import {
  listSupportCases,
  listSupportChanges,
  listSupportMessages,
  readSupportCase,
} from "./read"
import {
  addSupportMessage,
  assignSupportCase,
  changeSupportStatus,
  createSupportCase,
} from "./service"
import type { SupportDependencies } from "./store"
import { consumeSupportLiveOutbox } from "./live/outbox"
import { upgradeSupportLive } from "./live/upgrade"
import { listSupportAssignees } from "./assignees"

type Environment = { Bindings: Bindings }
type Dependencies = SupportDependencies & {
  identify?: (context: Context<Environment>) => Promise<string>
}
function saved(
  c: Context<Environment>,
  result: SupportMutationResponse,
  status: 200 | 201 = 200
) {
  if (c.env.SUPPORT)
    c.executionCtx.waitUntil(
      consumeSupportLiveOutbox(c.env, `support-live:${result.change.id}`).catch(
        () => {
          console.warn(JSON.stringify({ code: "SUPPORT_LIVE_IMMEDIATE_RETRY" }))
        }
      )
    )
  return c.json(result, status)
}
export function createSupportRoutes(dependencies: Dependencies = {}) {
  const actor =
    dependencies.identify ??
    (async (c: Context<Environment>) => (await requireSession(c)).user.id)
  return new Hono<Environment>()
    .get("/support/cases", async (c) =>
      c.json(await listSupportCases(c.env.DB, await actor(c), c.req.query()))
    )
    .post("/support/cases", async (c) =>
      saved(
        c,
        await createSupportCase(
          c.env.DB,
          await actor(c),
          await c.req.json().catch(() => null),
          dependencies
        ),
        201
      )
    )
    .get("/support/cases/:caseId/live", upgradeSupportLive)
    .get("/support/cases/:caseId/assignees", async (c) =>
      c.json(
        await listSupportAssignees(
          c.env.DB,
          await actor(c),
          c.req.param("caseId"),
          c.req.query()
        )
      )
    )
    .get("/support/cases/:caseId", async (c) =>
      c.json(
        await readSupportCase(c.env.DB, await actor(c), c.req.param("caseId"))
      )
    )
    .get("/support/cases/:caseId/messages", async (c) =>
      c.json(
        await listSupportMessages(
          c.env.DB,
          await actor(c),
          c.req.param("caseId"),
          c.req.query()
        )
      )
    )
    .post("/support/cases/:caseId/messages", async (c) =>
      saved(
        c,
        await addSupportMessage(
          c.env.DB,
          await actor(c),
          c.req.param("caseId"),
          await c.req.json().catch(() => null),
          dependencies
        ),
        201
      )
    )
    .get("/support/cases/:caseId/changes", async (c) =>
      c.json(
        await listSupportChanges(
          c.env.DB,
          await actor(c),
          c.req.param("caseId"),
          c.req.query()
        )
      )
    )
    .patch("/support/cases/:caseId/assignment", async (c) =>
      saved(
        c,
        await assignSupportCase(
          c.env.DB,
          await actor(c),
          c.req.param("caseId"),
          await c.req.json().catch(() => null),
          dependencies
        )
      )
    )
    .patch("/support/cases/:caseId/status", async (c) =>
      saved(
        c,
        await changeSupportStatus(
          c.env.DB,
          await actor(c),
          c.req.param("caseId"),
          await c.req.json().catch(() => null),
          dependencies
        )
      )
    )
}
export const supportRoutes = createSupportRoutes()
export {
  supportCaseAccessSql,
  voluntaryRefundSupportSql,
  requireVoluntaryRefundSupport,
  unresolvedOrderSupportSql,
} from "./guards"
export {
  consumeSupportLiveOutbox,
  dispatchSupportLiveOutbox,
} from "./live/outbox"
