import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { assertLocalOrigin, buildSeedPlan } from "./lib/seed-plan.mjs"

const execute = promisify(execFile)
const directory = fileURLToPath(new URL("../", import.meta.url))
const origin = assertLocalOrigin(
  process.env.ELC_SEED_ORIGIN ?? "http://localhost:5173"
)
const credentialsPath = new URL(
  "../.wrangler/seed-accounts.json",
  import.meta.url
)
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`

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
    { cwd: directory, maxBuffer: 4 * 1024 * 1024 }
  )
  return JSON.parse(stdout)[0]?.results ?? []
}

async function request(
  path,
  { method = "GET", body, cookie, status = 200 } = {}
) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(method === "GET" ? {} : { Origin: origin }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  })
  const data = await response.json().catch(() => null)
  if (response.status !== status) {
    const code = data?.error?.code ?? data?.code ?? "UNKNOWN"
    throw new Error(
      `${method} ${path} returned HTTP ${response.status} (${code}).`
    )
  }
  return { response, data }
}

async function loadCredentials() {
  try {
    return JSON.parse(await readFile(credentialsPath, "utf8"))
  } catch (error) {
    if (error.code === "ENOENT") return {}
    throw new Error(
      "The saved seed credentials file is unreadable; restore or remove it."
    )
  }
}

async function saveCredentials(credentials) {
  await mkdir(new URL("../.wrangler/", import.meta.url), { recursive: true })
  await writeFile(
    credentialsPath,
    JSON.stringify(credentials, null, 2) + "\n",
    { mode: 0o600 }
  )
  await chmod(credentialsPath, 0o600)
}

async function signIn(account, password) {
  const { response } = await request("/api/auth/sign-in/email", {
    method: "POST",
    body: { email: account.email, password },
  })
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
}

async function ensureAccount(account, credentials) {
  const existing = await query(
    `SELECT id FROM user WHERE email = ${literal(account.email)}`
  )
  if (existing.length) {
    const password = credentials[account.email]
    if (!password)
      throw new Error(
        `${account.email} exists without saved seed credentials. Remove that local account or restore .wrangler/seed-accounts.json.`
      )
    return {
      id: existing[0].id,
      cookie: await signIn(account, password),
      created: false,
    }
  }
  const password = randomBytes(24).toString("base64url")
  await request("/api/auth/sign-up/email", {
    method: "POST",
    body: { name: account.name, email: account.email, password },
  })
  credentials[account.email] = password
  await saveCredentials(credentials)
  const [mail] = await query(
    `SELECT body FROM development_mail WHERE recipient = ${literal(account.email)} AND kind = 'verify-email' ORDER BY created_at DESC LIMIT 1`
  )
  const link = mail?.body.match(/https?:\/\/[^\s]+/)?.[0]
  assert.ok(link, `No local verification mail for ${account.email}.`)
  assert.equal(new URL(link).origin, origin)
  const verified = await fetch(link, {
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  })
  assert.ok(
    [200, 302].includes(verified.status),
    `Verification failed for ${account.email}.`
  )
  const cookie = await signIn(account, password)
  const { data } = await request("/api/me", { cookie })
  return { id: data.user.id, cookie, created: true }
}

async function ensureEvent(event, organizer, requestIds) {
  const [existing] = await query(
    `SELECT id FROM events WHERE organizer_id = ${literal(organizer.id)} AND title = ${literal(event.body.title)}`
  )
  if (existing) return { id: existing.id, created: false }
  const created = (
    await request("/api/events", {
      method: "POST",
      cookie: organizer.cookie,
      status: 201,
      body: { requestId: requestIds[`event:${event.key}`], ...event.body },
    })
  ).data
  let revision = created.revision
  for (const type of event.ticketTypes) {
    const { key, ...body } = type
    const saved = (
      await request(`/api/events/${created.eventId}/ticket-types`, {
        method: "POST",
        cookie: organizer.cookie,
        status: 201,
        body: {
          requestId: requestIds[`ticketType:${event.key}:${key}`],
          expectedRevision: revision,
          eventId: created.eventId,
          ...body,
        },
      })
    ).data
    revision = saved.revision
  }
  await request(`/api/events/${created.eventId}/publish`, {
    method: "POST",
    cookie: organizer.cookie,
    body: {
      requestId: requestIds[`publish:${event.key}`],
      expectedRevision: revision,
    },
  })
  return { id: created.eventId, created: true }
}

const { data: health } = await request("/api/health")
if (health?.environment !== "local")
  throw new Error(
    "The running application is not the local environment; nothing was seeded."
  )

const plan = buildSeedPlan(Date.now())
const credentials = await loadCredentials()
const accounts = {}
for (const account of plan.accounts)
  accounts[account.role] = {
    ...account,
    ...(await ensureAccount(account, credentials)),
  }

const events = []
for (const event of plan.events)
  events.push({
    ...event,
    ...(await ensureEvent(event, accounts.organizer, plan.requestIds)),
  })

const grantedAt = Date.now()
const platformGrants = Object.entries(plan.grants.platform).flatMap(
  ([role, permissions]) =>
    permissions.map(
      (permission) =>
        `(${literal(accounts[role].id)}, ${literal(permission)}, ${grantedAt})`
    )
)
const eventGrants = Object.entries(plan.grants.event).flatMap(
  ([role, permissions]) =>
    events.flatMap((event) =>
      permissions.map(
        (permission) =>
          `(${literal(accounts[role].id)}, ${literal(event.id)}, ${literal(permission)}, ${grantedAt})`
      )
    )
)
await query(
  `INSERT OR IGNORE INTO platform_grants (user_id, permission, granted_at) VALUES ${platformGrants.join(", ")}; ` +
    `INSERT OR IGNORE INTO event_permissions (user_id, event_id, permission, granted_at) VALUES ${eventGrants.join(", ")};`
)

console.log("Local demo data is ready.")
for (const account of Object.values(accounts))
  console.log(
    `  ${account.role.padEnd(9)} ${account.email} ${account.created ? "(created)" : "(existing)"}`
  )
for (const event of events)
  console.log(
    `  event     ${event.body.title} ${event.created ? "(created)" : "(existing)"} ${origin}/events/${event.id}`
  )
console.log(
  "Passwords are stored only in .wrangler/seed-accounts.json (ignored by Git, mode 600)."
)
