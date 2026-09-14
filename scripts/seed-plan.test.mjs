import assert from "node:assert/strict"
import test from "node:test"
import { assertLocalOrigin, buildSeedPlan } from "./lib/seed-plan.mjs"

const now = Date.parse("2026-09-14T09:00:00Z")
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

await test("seed plan defines one distinct local account per demo role", () => {
  const { accounts } = buildSeedPlan(now)
  assert.deepEqual(accounts.map((account) => account.role).sort(), [
    "attendee",
    "moderator",
    "organizer",
    "scanner",
  ])
  const emails = accounts.map((account) => account.email)
  assert.equal(new Set(emails).size, emails.length)
  for (const email of emails) assert.match(email, /^demo-[a-z]+@example\.test$/)
})

await test("seed plan never contains credentials", () => {
  const serialized = JSON.stringify(buildSeedPlan(now)).toLowerCase()
  assert.equal(serialized.includes("password"), false)
  assert.equal(serialized.includes("secret"), false)
})

await test("seed events are upcoming with valid windows and capacity", () => {
  const { events } = buildSeedPlan(now)
  assert.ok(events.length >= 2)
  for (const event of events) {
    const starts = Date.parse(event.body.startsAt)
    assert.ok(starts > now, event.key)
    assert.ok(Date.parse(event.body.endsAt) > starts, event.key)
    assert.ok(
      Date.parse(event.body.registrationOpensAt) <= now &&
        Date.parse(event.body.registrationClosesAt) > now,
      event.key
    )
    assert.ok(event.body.maxTicketsPerOrder <= event.body.capacity, event.key)
    const total = event.ticketTypes.reduce(
      (sum, type) => sum + type.quantity,
      0
    )
    assert.ok(total <= event.body.capacity, event.key)
    for (const type of event.ticketTypes) {
      assert.equal(type.kind, "free", event.key)
      assert.equal(type.priceMinor, 0, event.key)
    }
  }
})

await test("seed request identifiers are stable UUIDs and unique across the plan", () => {
  const first = buildSeedPlan(now)
  assert.deepEqual(buildSeedPlan(now).requestIds, first.requestIds)
  const ids = Object.values(first.requestIds)
  assert.ok(ids.length > 0)
  for (const id of ids) assert.match(id, uuid)
  assert.equal(new Set(ids).size, ids.length)
})

await test("seed grants moderator platform access and scanner event access", () => {
  const { grants } = buildSeedPlan(now)
  assert.ok(grants.platform.moderator.includes("platform:moderate"))
  assert.ok(grants.event.scanner.length > 0)
})

await test("seed refuses non-local origins", () => {
  assert.equal(
    assertLocalOrigin("http://localhost:5173"),
    "http://localhost:5173"
  )
  assert.equal(
    assertLocalOrigin("http://127.0.0.1:5173/"),
    "http://127.0.0.1:5173"
  )
  for (const origin of [
    "https://elc-preview.example.workers.dev",
    "http://localhost.evil.test",
    "ftp://localhost",
    "not a url",
  ])
    assert.throws(() => assertLocalOrigin(origin), /local/)
})
