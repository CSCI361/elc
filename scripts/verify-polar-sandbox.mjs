import { mkdir, readFile, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execute = promisify(execFile)
const directory = fileURLToPath(new URL("../", import.meta.url))
const origin = "http://localhost:5173"
const statePath = new URL("../.wrangler/polar-acceptance.json", import.meta.url)
const launchPath = new URL("../.wrangler/polar-checkout.html", import.meta.url)
const savedState = await readFile(statePath, "utf8")
  .then(JSON.parse)
  .catch(() => null)
const runId = savedState?.runId ?? randomUUID()
const memberEmail = process.env.POLAR_TEST_CUSTOMER_EMAIL
const memberAlias = (role) => {
  if (!memberEmail) return undefined
  const [local, domain] = memberEmail.split("@")
  return `${local.split("+")[0]}+elc-${runId.slice(0, 8)}-${role}@${domain}`
}
const accounts =
  savedState?.accounts ??
  ["owner", "buyer"].map((role) => ({
    role,
    name: `Sandbox ${role}`,
    email: memberAlias(role),
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
  const existing = await query(
    `SELECT id, email_verified FROM user WHERE email = ${literal(account.email)}`
  )
  if (!existing[0]?.results.length)
    await request("/api/auth/sign-up/email", { method: "POST", body })
  if (!existing[0]?.results[0]?.email_verified) {
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
  }
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

// This opt-in probe calls the real local Worker and the configured Polar sandbox.
// The state file contains account passwords/cookies; it is private and ignored.
const command = process.argv[2] ?? "status"
const state = savedState ?? {
  runId,
  accounts,
  eventId: null,
  ticketTypes: [],
  campaignCode: null,
  activationPaymentId: null,
  orderId: null,
  paymentId: null,
  orders: [],
}
async function save() {
  await mkdir(new URL("../.wrangler/", import.meta.url), { recursive: true })
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600 })
}
async function launch(payment) {
  assert.ok(
    payment.checkoutUrl,
    "Checkout is pending or provider creation was rejected"
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
      paymentId: payment.id,
      purpose: payment.purpose,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      state: payment.state,
      launcher: ".wrangler/polar-checkout.html",
    })
  )
}
try {
  const health = await request("/api/health")
  assert.equal(health.data.environment, "local")
  if (command === "prepare") {
    assert.ok(
      memberEmail || savedState,
      "Supply the sandbox member email through POLAR_TEST_CUSTOMER_EMAIL"
    )
    await save()
    for (const account of accounts) {
      if (!account.cookie) await authenticate(account)
      await save()
    }
    const now = Date.now()
    const iso = (offset) => new Date(now + offset).toISOString()
    step = "event creation"
    if (!state.eventId) {
      const event = (
        await request("/api/events", {
          method: "POST",
          actor: owner,
          status: 201,
          body: {
            requestId: `event-${runId}`,
            title: `Polar acceptance ${runId}`,
            description: "Synthetic sandbox provider acceptance fixture.",
            category: "Acceptance",
            venueName: "Demo hall",
            venueAddress: "Synthetic address",
            startsAt: iso(86400000),
            endsAt: iso(90000000),
            timeZone: "Asia/Almaty",
            visibility: "unlisted",
            seatingMode: "general_admission",
            capacity: 12,
            maxTicketsPerOrder: 6,
            registrationOpensAt: iso(-60000),
            registrationClosesAt: iso(86400000),
            refundInstructions: "Sandbox full-refund acceptance.",
          },
        })
      ).data
      state.eventId = event.eventId
      await save()
    }
    for (const [index, [name, priceMinor, quantity]] of [
      ["Adult", 500000, 4],
      ["Student", 250000, 8],
    ].entries()) {
      if (state.ticketTypes[index]) continue
      step = "ticket type creation"
      const event = (
        await request(`/api/events/${state.eventId}/preview`, { actor: owner })
      ).data.event
      const type = (
        await request(`/api/events/${state.eventId}/ticket-types`, {
          method: "POST",
          actor: owner,
          status: 201,
          body: {
            requestId: `type-${index}-${runId}`,
            expectedRevision: event.revision,
            eventId: state.eventId,
            name,
            description: "Synthetic sandbox ticket",
            kind: "paid",
            priceMinor,
            currency: "KZT",
            quantity,
            salesStartAt: iso(-60000),
            salesEndAt: iso(86400000),
            hidden: false,
          },
        })
      ).data
      state.ticketTypes[index] = type.resourceId
      await save()
    }
    step = "campaign creation"
    if (!state.campaignId) {
      const event = (
        await request(`/api/events/${state.eventId}/preview`, { actor: owner })
      ).data.event
      const campaign = (
        await request(`/api/events/${state.eventId}/campaigns`, {
          method: "POST",
          actor: owner,
          status: 201,
          body: {
            requestId: `campaign-${runId}`,
            expectedRevision: event.revision,
            eventId: state.eventId,
            name: "Sandbox 10 percent",
            discount: { kind: "percentage", basisPoints: 1000 },
            applicableTicketTypeIds: state.ticketTypes,
            maxRedemptions: 10,
          },
        })
      ).data
      state.campaignId = campaign.resourceId
      await save()
    }
    if (!state.campaignCode) {
      const detail = (
        await request(
          `/api/events/${state.eventId}/campaigns/${state.campaignId}`,
          { actor: owner }
        )
      ).data
      state.campaignCode = detail.code
      await save()
    }
    const event = (
      await request(`/api/events/${state.eventId}/preview`, { actor: owner })
    ).data.event
    const campaign = (
      await request(
        `/api/events/${state.eventId}/campaigns/${state.campaignId}`,
        { actor: owner }
      )
    ).data
    if (!campaign.enabled)
      await request(
        `/api/events/${state.eventId}/campaigns/${state.campaignId}/enable`,
        {
          method: "POST",
          actor: owner,
          body: {
            requestId: `campaign-enable-${runId}`,
            expectedRevision: event.revision,
          },
        }
      )
    step = "event publication"
    const current = (
      await request(`/api/events/${state.eventId}/preview`, { actor: owner })
    ).data.event
    if (current.publicationState !== "published")
      await request(`/api/events/${state.eventId}/publish`, {
        method: "POST",
        actor: owner,
        body: {
          requestId: `publish-${runId}`,
          expectedRevision: current.revision,
        },
      })
    console.log(
      JSON.stringify({
        step: "prepared through HTTP",
        eventId: state.eventId,
        ticketTypeCount: state.ticketTypes.length,
        discountPercent: 10,
      })
    )
  } else if (command === "activate") {
    assert.ok(state.eventId, "Prepare the run first")
    step = "activation checklist"
    let activation = (
      await request(`/api/events/${state.eventId}/activation`, { actor: owner })
    ).data.activation
    if (!state.activationPaymentId) {
      activation = (
        await request(`/api/events/${state.eventId}/activation`, {
          method: "PATCH",
          actor: owner,
          body: {
            requestId: `checklist-${runId}`,
            expectedRevision: activation.revision,
            profile: {
              displayName: "Sandbox organizer",
              legalName: "Demonstration organizer",
              contact: "Synthetic contact",
              dummyPayoutReference: "DEMO-SANDBOX",
            },
            identityCheck: "passed",
            payoutCheck: "passed",
            acceptedTermsVersion: "elc-demo-paid-2026-09-13",
          },
        })
      ).data.activation
      step = "activation sandbox checkout"
      const payment = (
        await request(`/api/events/${state.eventId}/activation/payment`, {
          method: "POST",
          actor: owner,
          body: {
            requestId: `activate-${runId}`,
            expectedRevision: activation.revision,
          },
        })
      ).data.payment
      state.activationPaymentId = payment.id
      await save()
      await launch(payment)
    } else {
      const payment = (
        await request(`/api/payments/${state.activationPaymentId}/reconcile`, {
          method: "POST",
          actor: owner,
        })
      ).data.payment
      if (payment.checkoutUrl) await launch(payment)
      else
        console.log(
          JSON.stringify({
            paymentId: payment.id,
            paymentState: payment.state,
            refundState: payment.refundState,
            activation: activation.eligibility,
          })
        )
    }
  } else if (command === "checkout") {
    assert.ok(state.activationPaymentId, "Activation is required")
    await request(`/api/payments/${state.activationPaymentId}/reconcile`, {
      method: "POST",
      actor: owner,
    })
    const activation = (
      await request(`/api/events/${state.eventId}/activation`, { actor: owner })
    ).data.activation
    assert.equal(activation.eligibility, "active")
    if (state.orderId) {
      const existing = (
        await request(`/api/orders/${state.orderId}`, { actor: buyer })
      ).data.order
      assert.notEqual(
        existing.state,
        "pending",
        "An order is already pending; inspect status instead"
      )
    }
    step = "reserve mixed discounted basket"
    const checkout = (
      await request("/api/checkouts", {
        method: "POST",
        actor: buyer,
        status: 201,
        body: {
          requestId: randomUUID(),
          eventId: state.eventId,
          promoCode: state.campaignCode,
          items: [
            {
              ticketTypeId: state.ticketTypes[0],
              quantity: 1,
              attendeeNames: ["Sandbox adult"],
            },
            {
              ticketTypeId: state.ticketTypes[1],
              quantity: 2,
              attendeeNames: ["Sandbox student one", "Sandbox student two"],
            },
          ],
        },
      })
    ).data
    assert.equal(checkout.order.subtotalMinor, 1000000)
    assert.equal(checkout.order.totalMinor, 900000)
    assert.equal(checkout.order.processingFeeMinor, 27000)
    state.orderId = checkout.order.id
    state.paymentRequestId = randomUUID()
    state.expectedRevision = checkout.revision
    state.paymentId = null
    await save()
    step = "ticket sandbox checkout"
    const payment = (
      await request(`/api/orders/${state.orderId}/payment`, {
        method: "POST",
        actor: buyer,
        body: {
          requestId: state.paymentRequestId,
          expectedRevision: state.expectedRevision,
        },
      })
    ).data.payment
    state.paymentId = payment.id
    state.orders.push({ orderId: state.orderId, paymentId: payment.id })
    await save()
    await launch(payment)
  } else if (command === "verify-paid") {
    step = "verify completed paid basket and canonical exports"
    assert.ok(state.orderId)
    const order = (
      await request(`/api/orders/${state.orderId}`, { actor: buyer })
    ).data.order
    assert.equal(order.state, "completed")
    const tickets = (
      await request(`/api/orders/${state.orderId}/tickets`, { actor: buyer })
    ).data.items
    assert.equal(tickets.length, 3)
    let pdfCount = 0
    for (const ticket of tickets) {
      const before = (
        await request(`/api/tickets/${ticket.id}/credential`, { actor: buyer })
      ).data.credential
      for (const locale of ["kk", "ru", "en"]) {
        const response = await fetch(
          `${origin}/api/tickets/${ticket.id}/pdf?locale=${locale}`,
          {
            headers: { Cookie: buyer.cookie },
            redirect: "manual",
            signal: AbortSignal.timeout(30000),
          }
        )
        assert.equal(response.status, 200)
        assert.equal(response.headers.get("content-type"), "application/pdf")
        assert.equal(response.headers.get("cache-control"), "private, no-store")
        const bytes = new Uint8Array(await response.arrayBuffer())
        assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-")
        assert.ok(bytes.length > 1000)
        pdfCount++
      }
      assert.deepEqual(
        (
          await request(`/api/tickets/${ticket.id}/credential`, {
            actor: buyer,
          })
        ).data.credential,
        before
      )
    }
    const counts = (
      await query(
        `SELECT (SELECT count(*) FROM tickets WHERE order_id = ${literal(state.orderId)}) AS tickets, (SELECT count(*) FROM inventory WHERE order_id = ${literal(state.orderId)}) AS soldSlots, (SELECT count(*) FROM promo_allocations WHERE order_id = ${literal(state.orderId)} AND committed_at IS NOT NULL AND released_at IS NULL) AS committedPromo`
      )
    )[0].results[0]
    assert.deepEqual(counts, { tickets: 3, soldSlots: 3, committedPromo: 1 })
    state.verifiedPaidOrderId = state.orderId
    await save()
    console.log(
      JSON.stringify({
        orderState: order.state,
        totalMinor: order.totalMinor,
        processingFeeMinor: order.processingFeeMinor,
        pdfCount,
        canonicalCredentialsUnchanged: true,
        ...counts,
      })
    )
  } else if (command === "abandon") {
    step = "abandon reserved order"
    const order = (
      await request(`/api/orders/${state.orderId}`, { actor: buyer })
    ).data
    await request(`/api/orders/${state.orderId}/abandon`, {
      method: "POST",
      actor: buyer,
      body: {
        requestId: `abandon-${state.orderId}`,
        expectedRevision: order.revision,
      },
    })
    console.log(
      "Checkout abandoned; any later payment must be fully compensated."
    )
  } else if (command === "status") {
    const id = state.paymentId ?? state.activationPaymentId
    assert.ok(id, "No payment has been prepared")
    const actor = state.paymentId ? buyer : owner
    const payment = (
      await request(`/api/payments/${id}/reconcile`, { method: "POST", actor })
    ).data.payment
    const activation = (
      await request(`/api/events/${state.eventId}/activation`, { actor: owner })
    ).data.activation
    let orderState = null
    let ticketCount = 0
    if (state.orderId) {
      orderState = (
        await request(`/api/orders/${state.orderId}`, { actor: buyer })
      ).data.order.state
      ticketCount = (
        await request(`/api/orders/${state.orderId}/tickets`, { actor: buyer })
      ).data.items.length
    }
    console.log(
      JSON.stringify({
        paymentId: payment.id,
        paymentState: payment.state,
        dispatchState: payment.dispatchState,
        refundState: payment.refundState,
        activation: activation.eligibility,
        orderState,
        ticketCount,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
      })
    )
  } else
    throw new Error(
      "Use prepare, activate, checkout, verify-paid, abandon or status"
    )
} catch (error) {
  console.error(`Sandbox acceptance stopped at ${step}.${diagnostic}`)
  if (error instanceof assert.AssertionError)
    console.error(
      "Acceptance assertion failed; private run state is preserved."
    )
  process.exitCode = 1
}
