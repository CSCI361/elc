import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execute = promisify(execFile)
const directory = fileURLToPath(new URL("../", import.meta.url))
const origin = "http://localhost:5173"
const runId = randomUUID()
const accounts = ["owner", "buyer", "scanner"].map((role) => ({
  role,
  name: `Ticketing acceptance ${role}`,
  email: `ticketing-${runId}-${role}@example.test`,
  password: randomUUID() + randomUUID(),
  id: null,
  cookie: null,
}))
const [owner, buyer, scanner] = accounts
let step = "local health"
let diagnostic = ""
let succeeded = false
let cleanupSucceeded = false

const literal = (value) => `'${String(value).replaceAll("'", "''")}'`

// Wrangler is used only for private verification mail, explicit staff grants,
// record assertions and cleanup. Account sessions always come from HTTP sign-in.
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
    { cwd: directory, maxBuffer: 2 * 1024 * 1024 }
  )
  return JSON.parse(stdout)
}

async function request(
  path,
  { method = "GET", body, actor, status = 200 } = {}
) {
  diagnostic = ""
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(method === "GET" ? {} : { Origin: origin }),
      ...(actor?.cookie ? { Cookie: actor.cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  })
  const data = await response.json().catch(() => null)
  const code = data?.error?.code ?? data?.code
  diagnostic = ` HTTP ${response.status}${typeof code === "string" && /^[A-Z_]+$/.test(code) ? ` (${code})` : ""}.`
  assert.equal(response.status, status)
  diagnostic = ""
  return { response, data }
}

async function authenticate(account) {
  const body = {
    name: account.name,
    email: account.email,
    password: account.password,
  }
  step = `${account.role} registration`
  await request("/api/auth/sign-up/email", { method: "POST", body })
  step = `${account.role} unverified account rejection`
  await request("/api/auth/sign-in/email", {
    method: "POST",
    body,
    status: 403,
  })
  step = `${account.role} private verification mail`
  const mail = await query(
    `SELECT body FROM development_mail WHERE recipient = ${literal(account.email)} AND kind = 'verify-email' ORDER BY created_at DESC LIMIT 1`
  )
  const link = mail[0]?.results[0]?.body.match(/https?:\/\/[^\s]+/)?.[0]
  assert.ok(link)
  assert.equal(new URL(link).origin, origin)
  step = `${account.role} email verification`
  const verification = await fetch(link, {
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  })
  assert.ok([200, 302].includes(verification.status))
  step = `${account.role} authenticated sign-in`
  const signedIn = await request("/api/auth/sign-in/email", {
    method: "POST",
    body,
  })
  const cookies = signedIn.response.headers.getSetCookie()
  assert.ok(cookies.some((value) => value.includes("HttpOnly")))
  account.cookie = cookies.map((value) => value.split(";")[0]).join("; ")
  const { data } = await request("/api/me", { actor: account })
  assert.equal(data.user.email, account.email)
  assert.equal(data.user.emailVerified, true)
  assert.equal(typeof data.user.id, "string")
  account.id = data.user.id
}

async function cleanup() {
  const emails = accounts.map((account) => literal(account.email)).join(",")
  const users = `SELECT id FROM user WHERE email IN (${emails})`
  const events = `SELECT id FROM events WHERE organizer_id IN (${users})`
  const orders = `SELECT id FROM orders WHERE event_id IN (${events})`
  const tickets = `SELECT id FROM tickets WHERE event_id IN (${events})`
  const checkins = `SELECT id FROM checkins WHERE ticket_id IN (${tickets})`
  const campaigns = `SELECT id FROM campaigns WHERE event_id IN (${events})`
  const payments = `SELECT id FROM payment_attempts WHERE (purpose = 'ticket_order' AND subject_id IN (${orders})) OR (purpose = 'event_activation' AND subject_id IN (${events}))`
  // Delete children first, preserving all records outside this run's exact accounts/events.
  await query(
    [
      `DELETE FROM outbox WHERE entity_id IN (${events}) OR entity_id IN (${orders}) OR entity_id IN (${tickets}) OR entity_id IN (${checkins})`,
      `DELETE FROM request_receipts WHERE actor_id IN (${users}) OR resource_id IN (${events}) OR resource_id IN (${orders}) OR resource_id IN (${tickets}) OR resource_id IN (${checkins})`,
      `DELETE FROM audit_entries WHERE event_id IN (${events}) OR actor_id IN (${users})`,
      `DELETE FROM checkins WHERE ticket_id IN (${tickets})`,
      `DELETE FROM tickets WHERE event_id IN (${events})`,
      `DELETE FROM refunds WHERE payment_attempt_id IN (${payments})`,
      `UPDATE reservations SET payment_attempt_id = NULL WHERE event_id IN (${events})`,
      `DELETE FROM payment_attempts WHERE id IN (${payments})`,
      `DELETE FROM promo_allocations WHERE order_id IN (${orders})`,
      `UPDATE inventory SET reservation_id = NULL, order_id = NULL WHERE event_id IN (${events})`,
      `DELETE FROM order_items WHERE order_id IN (${orders})`,
      `DELETE FROM reservations WHERE event_id IN (${events})`,
      `DELETE FROM orders WHERE event_id IN (${events})`,
      `DELETE FROM inventory WHERE event_id IN (${events})`,
      `DELETE FROM campaign_ticket_types WHERE campaign_id IN (${campaigns})`,
      `DELETE FROM campaigns WHERE event_id IN (${events})`,
      `DELETE FROM ticket_types WHERE event_id IN (${events})`,
      `DELETE FROM invitations WHERE event_id IN (${events})`,
      `DELETE FROM event_permissions WHERE event_id IN (${events}) OR user_id IN (${users})`,
      `DELETE FROM events WHERE id IN (${events})`,
      `DELETE FROM platform_grants WHERE user_id IN (${users})`,
      `DELETE FROM profiles WHERE user_id IN (${users})`,
      `DELETE FROM development_mail WHERE recipient IN (${emails})`,
      `DELETE FROM verification WHERE identifier IN (${emails})`,
      `DELETE FROM user WHERE email IN (${emails})`,
    ].join("; ") + ";"
  )
  const remaining = await query(
    `SELECT count(*) AS n FROM user WHERE email IN (${emails})`
  )
  assert.equal(remaining[0].results[0].n, 0)
}

try {
  const health = await request("/api/health")
  assert.equal(
    health.data.environment,
    "local",
    "Only local resources are permitted"
  )
  for (const account of accounts) await authenticate(account)

  const now = Date.now()
  const iso = (offset) => new Date(now + offset).toISOString()
  step = "create event through authenticated HTTP"
  const event = (
    await request("/api/events", {
      method: "POST",
      actor: owner,
      status: 201,
      body: {
        requestId: randomUUID(),
        title: `Disposable ticketing acceptance ${runId}`,
        description:
          "Synthetic local Worker acceptance fixture; deleted after this run.",
        category: "Acceptance",
        venueName: "Local test hall",
        venueAddress: "Synthetic address",
        startsAt: iso(3600000),
        endsAt: iso(7200000),
        timeZone: "Asia/Almaty",
        visibility: "unlisted",
        seatingMode: "general_admission",
        capacity: 2,
        maxTicketsPerOrder: 2,
        registrationOpensAt: iso(-60000),
        registrationClosesAt: iso(3600000),
        refundInstructions: "Synthetic acceptance instructions.",
      },
    })
  ).data
  assert.equal(event.revision, 0)
  const eventId = event.eventId
  assert.equal(typeof eventId, "string")

  step = "create free ticket type through authenticated HTTP"
  const ticketType = (
    await request(`/api/events/${eventId}/ticket-types`, {
      method: "POST",
      actor: owner,
      status: 201,
      body: {
        requestId: randomUUID(),
        expectedRevision: event.revision,
        eventId,
        name: "Free acceptance ticket",
        description: "Synthetic",
        kind: "free",
        priceMinor: 0,
        currency: "KZT",
        quantity: 2,
        salesStartAt: iso(-60000),
        salesEndAt: iso(3600000),
        hidden: false,
      },
    })
  ).data
  step = "publish event through authenticated HTTP"
  const published = (
    await request(`/api/events/${eventId}/publish`, {
      method: "POST",
      actor: owner,
      body: { requestId: randomUUID(), expectedRevision: ticketType.revision },
    })
  ).data
  assert.equal(published.revision, 2)
  const detail = (await request(`/api/events/${eventId}`)).data
  assert.equal(detail.event.publicationState, "published")
  assert.equal(detail.ticketTypes[0].available, 2)

  step = "reserve free ticket through authenticated HTTP"
  const reserveInput = {
    requestId: randomUUID(),
    eventId,
    items: [
      {
        ticketTypeId: ticketType.resourceId,
        quantity: 1,
        attendeeNames: ["Synthetic guest"],
      },
    ],
  }
  const checkout = (
    await request("/api/checkouts", {
      method: "POST",
      actor: buyer,
      status: 201,
      body: reserveInput,
    })
  ).data
  assert.equal(checkout.order.totalMinor, 0)
  assert.equal(
    checkout.refundPolicy.instructions,
    "Synthetic acceptance instructions."
  )
  assert.equal(
    Date.parse(checkout.reservation.expiresAt) -
      Date.parse(checkout.reservation.createdAt),
    600000
  )
  assert.deepEqual(
    (
      await request("/api/checkouts", {
        method: "POST",
        actor: buyer,
        status: 201,
        body: reserveInput,
      })
    ).data,
    checkout
  )

  step = "complete zero-total order through authenticated HTTP"
  const completeInput = {
    requestId: randomUUID(),
    expectedRevision: checkout.revision,
  }
  const completed = (
    await request(`/api/orders/${checkout.order.id}/complete`, {
      method: "POST",
      actor: buyer,
      body: completeInput,
    })
  ).data
  assert.equal(completed.state, "completed")
  assert.equal(completed.ticketIds.length, 1)
  assert.deepEqual(
    (
      await request(`/api/orders/${checkout.order.id}/complete`, {
        method: "POST",
        actor: buyer,
        body: completeInput,
      })
    ).data,
    completed
  )

  step = "retrieve canonical credential through purchaser session"
  const ticketId = completed.ticketIds[0]
  const delivered = (
    await request(`/api/tickets/${ticketId}/credential`, { actor: buyer })
  ).data
  assert.equal(delivered.credential.kind, "elc_admission")
  assert.equal(delivered.credential.version, 1)
  assert.equal(typeof delivered.credential.token, "string")
  assert.deepEqual(
    (await request(`/api/tickets/${ticketId}/credential`, { actor: buyer }))
      .data.credential,
    delivered.credential
  )
  await request(`/api/tickets/${ticketId}/credential`, {
    actor: scanner,
    status: 403,
  })

  step = "deny unassigned scanner and organizer implicit scan authority"
  const scanInput = {
    eventId,
    operationId: randomUUID(),
    credential: delivered.credential,
  }
  await request("/api/checkins", {
    method: "POST",
    actor: scanner,
    body: scanInput,
    status: 403,
  })
  await request("/api/checkins", {
    method: "POST",
    actor: owner,
    body: { ...scanInput, operationId: randomUUID() },
    status: 403,
  })

  step = "grant explicit local scanner and correction permissions"
  await query(`INSERT INTO event_permissions (user_id, event_id, permission, granted_at) VALUES
    (${literal(scanner.id)}, ${literal(eventId)}, 'ticket:scan', ${Date.now()}),
    (${literal(scanner.id)}, ${literal(eventId)}, 'checkin:reverse', ${Date.now()})`)
  step = "scan, replay and independently reject duplicate admission"
  const first = (
    await request("/api/checkins", {
      method: "POST",
      actor: scanner,
      body: scanInput,
    })
  ).data
  assert.equal(first.result, "checked_in")
  assert.equal(typeof first.checkInId, "string")
  assert.deepEqual(
    (
      await request("/api/checkins", {
        method: "POST",
        actor: scanner,
        body: scanInput,
      })
    ).data,
    first
  )
  const duplicate = (
    await request("/api/checkins", {
      method: "POST",
      actor: scanner,
      body: { ...scanInput, operationId: randomUUID() },
    })
  ).data
  assert.equal(duplicate.result, "already_used")
  assert.equal(duplicate.checkInId, null)

  step = "reverse admission and scan again"
  const reversalInput = {
    requestId: randomUUID(),
    reason: "Synthetic acceptance correction.",
  }
  const reversalPath = `/api/events/${eventId}/checkins/${first.checkInId}/reverse`
  const reversal = (
    await request(reversalPath, {
      method: "POST",
      actor: scanner,
      body: reversalInput,
    })
  ).data
  assert.equal(reversal.reversed, true)
  assert.deepEqual(
    (
      await request(reversalPath, {
        method: "POST",
        actor: scanner,
        body: reversalInput,
      })
    ).data,
    reversal
  )
  const afterReversal = (
    await request("/api/checkins", {
      method: "POST",
      actor: scanner,
      body: { ...scanInput, operationId: randomUUID() },
    })
  ).data
  assert.equal(afterReversal.result, "checked_in")
  assert.notEqual(afterReversal.checkInId, first.checkInId)

  step = "verify canonical D1 records and outbox effects"
  const record = (
    await query(`SELECT
    (SELECT count(*) FROM tickets WHERE order_id = ${literal(checkout.order.id)}) AS tickets,
    (SELECT count(*) FROM checkins WHERE ticket_id = ${literal(ticketId)}) AS admissions,
    (SELECT count(*) FROM checkins WHERE ticket_id = ${literal(ticketId)} AND reversed_at IS NULL) AS activeAdmissions,
    (SELECT count(*) FROM outbox WHERE kind = 'order.completed' AND entity_id = ${literal(checkout.order.id)}) AS completionJobs,
    (SELECT count(*) FROM payment_attempts WHERE purpose = 'ticket_order' AND subject_id = ${literal(checkout.order.id)}) AS paymentAttempts,
    (SELECT state FROM orders WHERE id = ${literal(checkout.order.id)}) AS orderState,
    (SELECT state FROM reservations WHERE order_id = ${literal(checkout.order.id)}) AS reservationState`)
  )[0].results[0]
  assert.deepEqual(record, {
    tickets: 1,
    admissions: 2,
    activeAdmissions: 1,
    completionJobs: 1,
    paymentAttempts: 0,
    orderState: "completed",
    reservationState: "consumed",
  })
  step = "revoke scanner session through HTTP sign-out"
  await request("/api/auth/sign-out", {
    method: "POST",
    actor: scanner,
    body: {},
  })
  await request("/api/checkins", {
    method: "POST",
    actor: scanner,
    body: { ...scanInput, operationId: randomUUID() },
    status: 401,
  })
  succeeded = true
} catch {
  // Never print HTTP bodies, assertion values, private mail, cookies or credentials.
  console.error(`FAIL: local ticketing check at ${step}.${diagnostic}`)
  process.exitCode = 1
} finally {
  try {
    await cleanup()
    cleanupSucceeded = true
  } catch {
    console.error(
      "FAIL: cleanup of this run's disposable local ticketing fixtures did not finish."
    )
    process.exitCode = 1
  }
}

if (succeeded && cleanupSucceeded)
  console.log(
    "PASS: local Worker HTTP account verification, event/type publication, reservation, zero-total issuance, canonical credential, explicit staff scan, retry/duplicate handling, reversal and rescan; fixture cleanup verified."
  )
