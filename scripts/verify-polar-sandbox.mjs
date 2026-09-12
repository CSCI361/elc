import { mkdir, readFile, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execute = promisify(execFile)
const directory = fileURLToPath(new URL("../", import.meta.url))
const origin = "http://localhost:5173"
const runId = randomUUID()
const accounts = ["owner", "buyer"].map((role) => ({
  role,
  name: `Ticketing acceptance ${role}`,
  email:
    role === "buyer"
      ? process.env.POLAR_TEST_CUSTOMER_EMAIL
      : `polar-${runId}-owner@example.test`,
  password: randomUUID() + randomUUID(),
  id: null,
  cookie: null,
}))
const [owner, buyer] = accounts
let step = "local health"
let diagnostic = ""

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
    signal: AbortSignal.timeout(60000),
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
    signal: AbortSignal.timeout(60000),
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

// Manual, opt-in sandbox acceptance. State contains a private session cookie.
const statePath = new URL("../.wrangler/polar-acceptance.json", import.meta.url)
const launchPath = new URL("../.wrangler/polar-checkout.html", import.meta.url)
const command = process.argv[2] ?? "status"
try {
  if (command === "create") {
    assert.ok(
      process.env.POLAR_TEST_CUSTOMER_EMAIL,
      "Supply an allowed sandbox member alias through POLAR_TEST_CUSTOMER_EMAIL"
    )
    const old = await readFile(statePath, "utf8").catch(() => null)
    assert.equal(
      old,
      null,
      "An acceptance run already exists; inspect its status before creating another"
    )
    const health = await request("/api/health")
    assert.equal(health.data.environment, "local")
    for (const account of accounts) await authenticate(account)
    const now = Date.now()
    const iso = (offset) => new Date(now + offset).toISOString()
    step = "event creation"
    const event = (
      await request("/api/events", {
        method: "POST",
        actor: owner,
        status: 201,
        body: {
          requestId: randomUUID(),
          title: `Polar acceptance ${runId}`,
          description: "Synthetic sandbox provider acceptance fixture.",
          category: "Acceptance",
          venueName: "Demo hall",
          venueAddress: "Synthetic address",
          startsAt: iso(7200000),
          endsAt: iso(10800000),
          timeZone: "Asia/Almaty",
          visibility: "unlisted",
          seatingMode: "general_admission",
          capacity: 6,
          maxTicketsPerOrder: 6,
          registrationOpensAt: iso(-60000),
          registrationClosesAt: iso(7200000),
          refundInstructions: "Sandbox full-refund acceptance.",
        },
      })
    ).data
    let revision = event.revision
    const types = []
    for (const [name, priceMinor, quantity] of [
      ["Adult", 500000, 2],
      ["Student", 200000, 4],
    ]) {
      step = "ticket type creation"
      const type = (
        await request(`/api/events/${event.eventId}/ticket-types`, {
          method: "POST",
          actor: owner,
          status: 201,
          body: {
            requestId: randomUUID(),
            expectedRevision: revision,
            eventId: event.eventId,
            name,
            description: "Synthetic sandbox ticket",
            kind: "paid",
            priceMinor,
            currency: "KZT",
            quantity,
            salesStartAt: iso(-60000),
            salesEndAt: iso(7200000),
            hidden: false,
          },
        })
      ).data
      revision = type.revision
      types.push(type.ticketTypeId)
    }
    step = "event publication"
    await request(`/api/events/${event.eventId}/publish`, {
      method: "POST",
      actor: owner,
      body: { requestId: randomUUID(), expectedRevision: revision },
    })
    // This provider probe does not establish paid-sales activation acceptance.
    await query(
      `UPDATE events SET paid_sales_state = 'active' WHERE id = ${literal(event.eventId)}`
    )
    step = "reserve mixed basket"
    const checkout = (
      await request("/api/checkouts", {
        method: "POST",
        actor: buyer,
        status: 201,
        body: {
          requestId: randomUUID(),
          eventId: event.eventId,
          items: [
            {
              ticketTypeId: types[0],
              quantity: 1,
              attendeeNames: ["Sandbox adult"],
            },
            {
              ticketTypeId: types[1],
              quantity: 2,
              attendeeNames: ["Sandbox student one", "Sandbox student two"],
            },
          ],
        },
      })
    ).data
    assert.equal(checkout.order.totalMinor, 900000)
    assert.equal(checkout.order.processingFeeMinor, 27000)
    const state = {
      runId,
      actor: buyer,
      organizer: owner,
      eventId: event.eventId,
      orderId: checkout.order.id,
      expectedRevision: checkout.revision,
      requestId: randomUUID(),
      paymentId: null,
    }
    await mkdir(new URL("../.wrangler/", import.meta.url), { recursive: true })
    await writeFile(statePath, JSON.stringify(state), { mode: 0o600 })
    step = "create sandbox payment through Worker HTTP"
    const payment = (
      await request(`/api/orders/${state.orderId}/payment`, {
        method: "POST",
        actor: buyer,
        body: {
          requestId: state.requestId,
          expectedRevision: checkout.revision,
        },
      })
    ).data.payment
    state.paymentId = payment.id
    await writeFile(statePath, JSON.stringify(state), { mode: 0o600 })
    assert.ok(
      payment.checkoutUrl,
      "Checkout URL is pending or the provider rejected creation"
    )
    const url = new URL(payment.checkoutUrl)
    assert.equal(url.origin, "https://sandbox.polar.sh")
    const escaped = url.href.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    await writeFile(
      launchPath,
      `<!doctype html><meta charset="utf-8"><title>Sandbox checkout</title><meta http-equiv="refresh" content="0;url=${escaped}"><a href="${escaped}">Open sandbox checkout</a>`,
      { mode: 0o600 }
    )
    console.log(
      JSON.stringify({
        step: "sandbox checkout created",
        orderId: state.orderId,
        paymentId: payment.id,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        reservationExpiresAt: checkout.reservation.expiresAt,
        launcher: ".wrangler/polar-checkout.html",
        activationAcceptance: "fixture only",
      })
    )
  } else if (command === "status") {
    const state = JSON.parse(await readFile(statePath, "utf8"))
    assert.ok(
      state.paymentId,
      "No payment was recorded; inspect the preparation failure"
    )
    const payment = (
      await request(`/api/payments/${state.paymentId}/reconcile`, {
        method: "POST",
        actor: state.actor,
      })
    ).data.payment
    const order = (
      await request(`/api/orders/${state.orderId}`, { actor: state.actor })
    ).data.order
    const tickets = (
      await request(`/api/orders/${state.orderId}/tickets`, {
        actor: state.actor,
      })
    ).data
    console.log(
      JSON.stringify({
        paymentId: payment.id,
        paymentState: payment.state,
        dispatchState: payment.dispatchState,
        refundState: payment.refundState,
        orderState: order.state,
        amountMinor: order.totalMinor,
        currency: order.currency,
        ticketCount: tickets.items.length,
      })
    )
  } else throw new Error("Use create or status")
} catch (error) {
  console.error(`Sandbox acceptance stopped at ${step}.${diagnostic}`)
  if (error instanceof assert.AssertionError)
    console.error(
      "Acceptance assertion failed; private run state is preserved."
    )
  process.exitCode = 1
}
