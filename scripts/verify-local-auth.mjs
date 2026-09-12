import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { promisify } from "node:util"

const execute = promisify(execFile)
const origin = "http://localhost:5173"
const email = `runtime-${randomUUID()}@example.test`
const password = randomUUID() + randomUUID()
let step = "health"

async function query(sql) {
  const { stdout } = await execute(
    "vp",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "elc-local",
      "--local",
      "--config",
      "apps/api/wrangler.jsonc",
      "--persist-to",
      ".wrangler/state",
      "--command",
      sql,
      "--json",
    ],
    { maxBuffer: 1024 * 1024 }
  )
  return JSON.parse(stdout)
}

async function post(path, body, cookie) {
  return fetch(`${origin}/api/auth${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
    redirect: "manual",
  })
}

try {
  const health = await fetch(`${origin}/api/health`).then((response) =>
    response.json()
  )
  assert.equal(
    health.environment,
    "local",
    "This check only runs against local resources"
  )
  step = "register"
  const account = { name: "Runtime acceptance fixture", email, password }
  assert.equal((await post("/sign-up/email", account)).status, 200)
  step = "deny unverified sign-in"
  assert.equal((await post("/sign-in/email", account)).status, 403)
  step = "read private verification mail"
  const messages = await query(
    `SELECT body FROM development_mail WHERE recipient = '${email}' AND kind = 'verify-email' ORDER BY created_at DESC LIMIT 1`
  )
  const link = messages[0].results[0].body.match(/https?:\/\/[^\s]+/)?.[0]
  assert.equal(Boolean(link), true)
  assert.equal(new URL(link).origin, origin)
  step = "verify"
  const verification = await fetch(link, { redirect: "manual" })
  assert.equal([200, 302].includes(verification.status), true)
  step = "sign in"
  const signIn = await post("/sign-in/email", account)
  assert.equal(signIn.status, 200)
  const setCookies = signIn.headers.getSetCookie()
  assert.equal(
    setCookies.some((value) => value.includes("HttpOnly")),
    true
  )
  const cookie = setCookies.map((value) => value.split(";")[0]).join("; ")
  step = "authenticated application API"
  const me = await fetch(`${origin}/api/me`, { headers: { Cookie: cookie } })
  assert.equal(me.status, 200)
  assert.equal((await me.json()).user.email === email, true)
  step = "sign out and deny revoked session"
  assert.equal((await post("/sign-out", {}, cookie)).status, 200)
  assert.equal(
    (await fetch(`${origin}/api/me`, { headers: { Cookie: cookie } })).status,
    401
  )
  console.log(
    "PASS: workerd + D1 registration, verification, cookie authentication, application access and sign-out."
  )
} catch {
  // The private mail response and cookie are deliberately absent from diagnostics.
  console.error(
    `FAIL: local authentication check at ${step}. Inspect the local server's safe error codes.`
  )
  process.exitCode = 1
} finally {
  try {
    await query(
      `DELETE FROM development_mail WHERE recipient = '${email}'; DELETE FROM user WHERE email = '${email}';`
    )
  } catch {
    console.error("Local fixture cleanup could not finish.")
    process.exitCode = 1
  }
}
