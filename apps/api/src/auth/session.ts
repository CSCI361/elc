import { HTTPException } from "hono/http-exception"
import type { Bindings } from "../env"
import { createAuth, type AuthDependencies } from "./index"
import { requireActiveAccount } from "./permissions"

type AuthRequestContext = { env: Bindings; req: { raw: Request } }

export async function requireSession(
  context: AuthRequestContext,
  dependencies?: AuthDependencies
) {
  const session = await createAuth(context.env, dependencies).api.getSession({
    headers: context.req.raw.headers,
    query: { disableCookieCache: true },
  })
  if (!session) {
    throw new HTTPException(401, { message: "Sign in to continue." })
  }
  return session
}

/** This verifies the account only. Each operation must also check ownership/permissions. */
export async function requireVerifiedSession(
  context: AuthRequestContext,
  dependencies?: AuthDependencies
) {
  const session = await requireSession(context, dependencies)
  if (!session.user.emailVerified) {
    throw new HTTPException(403, {
      message: "Verify your email address to continue.",
    })
  }
  await requireActiveAccount(context.env.DB, session.user.id)
  return session
}
