import { hashPassword } from "better-auth/crypto"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vite-plus/test"
import { supportLiveFrameSchema, type SupportLiveFrame } from "@elc/shared"
import { createSupportCase, addSupportMessage } from "../service"
import {
  buildSupportTestWorker,
  createSupportLiveRuntime,
} from "./test-runtime"
import { consumeSupportLiveOutbox, dispatchSupportLiveOutbox } from "./outbox"
import { SUPPORT_PROTOCOL } from "./protocol"

describe("support WebSocket hibernation in workerd", () => {
  let code: string
  let database: Awaited<ReturnType<typeof createSupportLiveRuntime>>
  let db: D1Database
  let caseId: string
  let now: number
  const password = "Disposable support WebSocket fixture password."
  const sockets: WebSocket[] = []
  beforeAll(async () => {
    code = await buildSupportTestWorker()
  }, 60_000)
  beforeEach(async () => {
    database = await createSupportLiveRuntime(code)
    db = database.DB
    now = Date.now()
    const hash = await hashPassword(password)
    for (const id of ["owner", "buyer", "support", "other", "platform"]) {
      await db
        .prepare(
          "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
        )
        .bind(id, id, `${id}@example.test`, now, now)
        .run()
      await db
        .prepare(
          "INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, 'credential', ?, ?, ?, ?)"
        )
        .bind(`account-${id}`, id, id, hash, now, now)
        .run()
    }
    await db
      .prepare(`INSERT INTO events (id, organizer_id, title, description, category, venue_name, venue_address, starts_at, ends_at,
      registration_opens_at, registration_closes_at, capacity, publication_state, calendar_uid, reporting_id, created_at, updated_at)
      VALUES ('event', 'owner', 'Live support fixture', 'Description', 'Education', 'Hall', 'Address', ?, ?, ?, ?, 10, 'published', 'live@elc', 'rpt_live0000', ?, ?)`)
      .bind(
        now + 3600000,
        now + 7200000,
        now - 3600000,
        now + 3600000,
        now,
        now
      )
      .run()
    await db
      .prepare(
        "INSERT INTO event_permissions (event_id, user_id, permission, granted_at) VALUES ('event', 'support', 'support:manage', ?)"
      )
      .bind(now)
      .run()
    await db
      .prepare(
        "INSERT INTO platform_grants (user_id, permission, granted_at) VALUES ('platform', 'platform:support', ?)"
      )
      .bind(now)
      .run()
    const opened = await createSupportCase(db, "buyer", {
      requestId: "open",
      audience: "attendee",
      category: "event_information",
      subject: "Private support subject",
      eventId: "event",
      body: "Private support body",
    })
    caseId = opened.case.id
  })
  afterEach(async () => {
    for (const socket of sockets.splice(0))
      if (socket.readyState === WebSocket.OPEN) socket.close()
    await database?.runtime.dispose()
  })

  async function signIn(user: string) {
    const response = await database.runtime.dispatchFetch(
      "https://elc.test/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://elc.test",
        },
        body: JSON.stringify({ email: `${user}@example.test`, password }),
      }
    )
    expect(response.status).toBe(200)
    const cookies = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0]!)
      .join("; ")
    expect(cookies.length).toBeGreaterThan(0)
    return cookies
  }
  async function upgrade(
    cookie: string,
    options: {
      origin?: string
      id?: string
      after?: number
      protocol?: string
      extra?: Record<string, string>
    } = {}
  ) {
    return database.runtime.dispatchFetch(
      `https://elc.test/api/support/cases/${options.id ?? caseId}/live?after=${options.after ?? 0}`,
      {
        headers: {
          Upgrade: "websocket",
          Origin: options.origin ?? "https://elc.test",
          "Sec-WebSocket-Protocol": options.protocol ?? SUPPORT_PROTOCOL,
          Cookie: cookie,
          ...options.extra,
        },
      }
    )
  }
  async function connect(
    cookie: string,
    options: { after?: number; id?: string } = {}
  ) {
    const response = await upgrade(cookie, options)
    if (response.status !== 101)
      throw new Error(`Support upgrade failed: ${await response.text()}`)
    expect(response.status).toBe(101)
    if (!response.webSocket) throw new Error("Missing WebSocket upgrade")
    const socket = response.webSocket as unknown as WebSocket
    sockets.push(socket)
    const frames: SupportLiveFrame[] = []
    const waiters: Array<() => void> = []
    let closeCode: number | null = null
    socket.addEventListener("message", (event) => {
      frames.push(supportLiveFrameSchema.parse(JSON.parse(String(event.data))))
      for (const waiter of waiters.splice(0)) waiter()
    })
    socket.addEventListener("close", (event) => {
      closeCode = event.code
      for (const waiter of waiters.splice(0)) waiter()
    })
    socket.accept()
    async function waitFor<T>(read: () => T | undefined): Promise<T> {
      const deadline = Date.now() + 5000
      while (true) {
        const result = read()
        if (result !== undefined) return result
        if (Date.now() >= deadline)
          throw new Error("Support WebSocket event timed out")
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 100)
          waiters.push(() => {
            clearTimeout(timer)
            resolve()
          })
        })
      }
    }
    return {
      socket,
      frames,
      next: (type: SupportLiveFrame["type"]) =>
        waitFor(() => {
          const index = frames.findIndex((frame) => frame.type === type)
          return index < 0 ? undefined : frames.splice(index, 1)[0]
        }),
      closed: () => waitFor(() => closeCode ?? undefined),
    }
  }
  async function append(revision: number, body = "Another private reply") {
    return addSupportMessage(db, "buyer", caseId, {
      requestId: crypto.randomUUID(),
      expectedRevision: revision,
      body,
    })
  }
  async function subscriptionActors() {
    const room = database.SUPPORT.get(
      database.SUPPORT.idFromName(caseId)
    ) as unknown as { subscriptionActors(): Promise<string[]> }
    return room.subscriptionActors()
  }

  it("uses real Better Auth sign-in and a hibernatable socket with safe metadata frames", async () => {
    const client = await connect(await signIn("buyer"))
    expect(await client.next("ready")).toMatchObject({
      caseId,
      throughSequence: 1,
    })
    const update = await append(1)
    expect(
      await consumeSupportLiveOutbox(
        database,
        `support-live:${update.change.id}`
      )
    ).toBe(true)
    const frame = await client.next("case_update")
    expect(frame).toEqual({
      type: "case_update",
      version: 1,
      caseId,
      updateId: update.change.id,
      sequence: 2,
    })
    expect(JSON.stringify(frame)).not.toContain("private")
    client.socket.send(JSON.stringify({ type: "ping" }))
    expect(await client.next("pong")).toMatchObject({ throughSequence: 2 })
  })

  it("rejects missing sessions, cross-site origins, unsupported protocols and forged identity headers", async () => {
    const buyer = await signIn("buyer")
    const other = await signIn("other")
    expect((await upgrade("")).status).toBe(401)
    expect(
      (await upgrade(buyer, { origin: "https://attacker.test" })).status
    ).toBe(403)
    expect((await upgrade(buyer, { origin: "null" })).status).toBe(403)
    expect(
      (await upgrade(buyer, { extra: { "Sec-Fetch-Site": "cross-site" } }))
        .status
    ).toBe(403)
    expect((await upgrade(buyer, { protocol: "untrusted" })).status).toBe(400)
    expect((await upgrade(buyer, { after: 9000 })).status).toBe(400)
    expect(
      (
        await upgrade(other, {
          extra: { "X-Elc-Actor": "buyer", "X-Elc-Session": "forged" },
        })
      ).status
    ).toBe(404)
    const missingOrigin = await database.runtime.dispatchFetch(
      `https://elc.test/api/support/cases/${caseId}/live`,
      {
        headers: {
          Upgrade: "websocket",
          "Sec-WebSocket-Protocol": SUPPORT_PROTOCOL,
          Cookie: buyer,
        },
      }
    )
    expect(missingOrigin.status).toBe(403)
  })

  it("publishes immediately after an actual authenticated REST save and removes a logged-out subscription before delivery", async () => {
    const buyerCookie = await signIn("buyer")
    const staffCookie = await signIn("support")
    const buyer = await connect(buyerCookie, { after: 1 })
    const staff = await connect(staffCookie, { after: 1 })
    await buyer.next("ready")
    await staff.next("ready")
    const logout = await database.runtime.dispatchFetch(
      "https://elc.test/api/auth/sign-out",
      {
        method: "POST",
        headers: {
          Cookie: buyerCookie,
          Origin: "https://elc.test",
          "Content-Type": "application/json",
        },
        body: "{}",
      }
    )
    expect(logout.status).toBe(200)
    const response = await database.runtime.dispatchFetch(
      `https://elc.test/api/support/cases/${caseId}/messages`,
      {
        method: "POST",
        headers: {
          Cookie: staffCookie,
          Origin: "https://elc.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId: "http-reply",
          expectedRevision: 1,
          body: "Private staff response",
        }),
      }
    )
    expect(response.status).toBe(201)
    expect(await staff.next("case_update")).toMatchObject({ sequence: 2 })
    expect(await subscriptionActors()).not.toContain("buyer")
    // Miniflare does not promptly surface a publish-initiated close event. Verify
    // server detachment and absence of updates; ping/alarm close codes are separate tests.
    buyer.socket.close()
    expect(
      buyer.frames.filter((frame) => frame.type === "case_update")
    ).toHaveLength(0)
    const saved = (await response.json()) as { change: { id: string } }
    const job = await db
      .prepare("SELECT completed_at FROM outbox WHERE id = ?")
      .bind(`support-live:${saved.change.id}`)
      .first<{ completed_at: number | null }>()
    expect(job?.completed_at).not.toBeNull()
    expect((await upgrade(buyerCookie)).status).toBe(401)
  })

  it("rechecks staff revocation, account suspension and stored session expiry on delivery and ping", async () => {
    const staff = await connect(await signIn("support"), { after: 1 })
    await staff.next("ready")
    await db
      .prepare(
        "UPDATE event_permissions SET revoked_at = ? WHERE user_id = 'support'"
      )
      .bind(Date.now())
      .run()
    const update = await append(1)
    await consumeSupportLiveOutbox(database, `support-live:${update.change.id}`)
    expect(await subscriptionActors()).not.toContain("support")
    staff.socket.close()
    expect(
      staff.frames.filter((frame) => frame.type === "case_update")
    ).toHaveLength(0)

    const buyer = await connect(await signIn("buyer"))
    await buyer.next("ready")
    await db
      .prepare("UPDATE session SET expires_at = ? WHERE user_id = 'buyer'")
      .bind(Date.now() - 1)
      .run()
    buyer.socket.send(JSON.stringify({ type: "ping" }))
    expect(await buyer.closed()).toBe(1008)
    const owner = await connect(await signIn("owner"))
    await owner.next("ready")
    await db
      .prepare(
        "INSERT INTO profiles (user_id, suspended_at, updated_at) VALUES ('owner', ?, ?)"
      )
      .bind(Date.now(), Date.now())
      .run()
    owner.socket.send(JSON.stringify({ type: "ping" }))
    expect(await owner.closed()).toBe(1008)
  })

  it("retains serialized subscription state through real hibernation and revalidates through the alarm handler", async () => {
    const client = await connect(await signIn("support"), { after: 1 })
    await client.next("ready")
    await database.runtime.unsafeEvictDurableObject(
      "support-live-test",
      "TestSupportCase",
      { name: caseId, webSockets: "hibernate" }
    )
    client.socket.send(JSON.stringify({ type: "ping" }))
    expect(await client.next("pong")).toMatchObject({ throughSequence: 1 })
    await db.prepare("DELETE FROM session WHERE user_id = 'support'").run()
    const stub = database.SUPPORT.get(
      database.SUPPORT.idFromName(caseId)
    ) as unknown as { forceRevalidation(): Promise<void> }
    await stub.forceRevalidation()
    expect(await client.closed()).toBe(1008)
  })

  it("handles duplicate and out-of-order update delivery and reconnects through canonical REST catch-up", async () => {
    const cookie = await signIn("buyer")
    const client = await connect(cookie, { after: 1 })
    await client.next("ready")
    const second = await append(1)
    const third = await append(2)
    await consumeSupportLiveOutbox(database, `support-live:${third.change.id}`)
    expect(await client.next("case_update")).toMatchObject({
      updateId: third.change.id,
      sequence: 3,
    })
    await consumeSupportLiveOutbox(database, `support-live:${second.change.id}`)
    await consumeSupportLiveOutbox(database, `support-live:${third.change.id}`)
    const direct = await database.SUPPORT.get(
      database.SUPPORT.idFromName(caseId)
    ).fetch("https://support.internal/publish", {
      method: "POST",
      body: JSON.stringify({ outboxId: `support-live:${third.change.id}` }),
    })
    expect(direct.status).toBe(204)
    client.socket.send(JSON.stringify({ type: "ping" }))
    await client.next("pong")
    expect(
      client.frames.filter((frame) => frame.type === "case_update")
    ).toHaveLength(0)
    client.socket.close()
    const reconnected = await connect(cookie, { after: 1 })
    expect(await reconnected.next("ready")).toMatchObject({
      throughSequence: 3,
    })
    const response = await database.runtime.dispatchFetch(
      `https://elc.test/api/support/cases/${caseId}/changes?after=1`,
      { headers: { Cookie: cookie } }
    )
    expect(response.status).toBe(200)
    const history = (await response.json()) as {
      items: Array<{ id: string; sequence: number }>
      throughSequence: number
    }
    expect(history.items.map((item) => item.id)).toEqual([
      second.change.id,
      third.change.id,
    ])
    expect(history.throughSequence).toBe(3)
  })

  it("retries a failed queue dispatch through the real local Queue consumer and preserves failed room delivery", async () => {
    const client = await connect(await signIn("buyer"), { after: 1 })
    await client.next("ready")
    const update = await append(1)
    const id = `support-live:${update.change.id}`
    const unavailableQueue = {
      send: async () => {
        throw new Error("synthetic queue outage")
      },
    } as unknown as typeof database.DELIVERY
    await dispatchSupportLiveOutbox({ DB: db, DELIVERY: unavailableQueue })
    expect(
      await db
        .prepare("SELECT completed_at, dispatched_at FROM outbox WHERE id = ?")
        .bind(id)
        .first()
    ).toEqual({ completed_at: null, dispatched_at: null })
    await dispatchSupportLiveOutbox(database)
    expect(await client.next("case_update")).toMatchObject({ sequence: 2 })
    const later = await append(2)
    const badRoom = {
      idFromName: database.SUPPORT.idFromName.bind(database.SUPPORT),
      get: () => ({ fetch: async () => new Response(null, { status: 503 }) }),
    } as unknown as typeof database.SUPPORT
    expect(
      await consumeSupportLiveOutbox(
        { DB: db, SUPPORT: badRoom },
        `support-live:${later.change.id}`
      )
    ).toBe(true)
    const pending = await db
      .prepare(
        "SELECT completed_at, attempts, next_attempt_at FROM outbox WHERE id = ?"
      )
      .bind(`support-live:${later.change.id}`)
      .first<{
        completed_at: number | null
        attempts: number
        next_attempt_at: number
      }>()
    expect(pending).toMatchObject({ completed_at: null, attempts: 1 })
    expect(pending!.next_attempt_at).toBeGreaterThan(Date.now())
    await consumeSupportLiveOutbox(database, `support-live:${later.change.id}`)
    expect(await client.next("case_update")).toMatchObject({ sequence: 3 })
    expect(
      await consumeSupportLiveOutbox(
        database,
        `support-notify:${later.change.id}`
      )
    ).toBe(false)
  })

  it("rejects uncommitted or cross-case broadcasts and bounds subscriptions and client messages", async () => {
    const cookie = await signIn("buyer")
    const clients = await Promise.all([
      connect(cookie),
      connect(cookie),
      connect(cookie),
    ])
    for (const client of clients) await client.next("ready")
    expect((await upgrade(cookie)).status).toBe(429)
    const room = database.SUPPORT.get(database.SUPPORT.idFromName(caseId))
    expect(
      (
        await room.fetch("https://support.internal/publish", {
          method: "POST",
          body: JSON.stringify({ outboxId: "not-committed" }),
        })
      ).status
    ).toBe(409)
    expect(
      (
        await room.fetch("https://support.internal/publish", {
          method: "POST",
          body: JSON.stringify({
            outboxId: "not-committed",
            body: "untrusted support content",
          }),
        })
      ).status
    ).toBe(400)
    const secondCase = await createSupportCase(db, "buyer", {
      requestId: "second-case",
      audience: "attendee",
      category: "technical",
      subject: "Other case",
      eventId: "event",
      body: "Other private body",
    })
    expect(
      (
        await room.fetch("https://support.internal/publish", {
          method: "POST",
          body: JSON.stringify({
            outboxId: `support-live:${secondCase.change.id}`,
          }),
        })
      ).status
    ).toBe(409)
    clients[0]!.socket.send("x".repeat(257))
    expect(await clients[0]!.closed()).toBe(1009)
    clients[1]!.socket.send(
      JSON.stringify({ type: "message", body: "Cannot save through WebSocket" })
    )
    expect(await clients[1]!.closed()).toBe(1008)
    for (let i = 0; i < 13; i++)
      clients[2]!.socket.send(JSON.stringify({ type: "ping" }))
    expect(await clients[2]!.closed()).toBe(1008)
    expect(
      await db
        .prepare(
          "SELECT count(*) AS count FROM support_messages WHERE case_id = ?"
        )
        .bind(caseId)
        .first()
    ).toEqual({ count: 1 })
  })

  it("filters the exact-case assignee picker by audience and current account/grant eligibility", async () => {
    const owner = await signIn("owner")
    const requester = await signIn("buyer")
    const platform = await signIn("platform")
    const read = (cookie: string, id = caseId, query = "") =>
      database.runtime.dispatchFetch(
        `https://elc.test/api/support/cases/${id}/assignees${query}`,
        { headers: { Cookie: cookie } }
      )
    expect((await read(requester)).status).toBe(404)
    const first = (await (await read(owner, caseId, "?limit=1")).json()) as {
      items: Array<{ userId: string; name: string }>
      nextCursor: string
    }
    expect(first.items).toEqual([{ userId: "owner", name: "owner" }])
    expect(first.nextCursor).toBe("owner")
    const second = (await (
      await read(owner, caseId, `?cursor=${first.nextCursor}`)
    ).json()) as { items: Array<{ userId: string; name: string }> }
    expect(second.items.map((item) => item.userId)).toEqual([
      "platform",
      "support",
    ])
    expect(JSON.stringify(second)).not.toContain("email")
    const privateCase = await createSupportCase(db, "owner", {
      requestId: "platform-case",
      audience: "organizer_platform",
      category: "payment",
      subject: "Platform matter",
      eventId: "event",
      body: "Private question",
    })
    expect((await read(owner, privateCase.case.id)).status).toBe(404)
    expect(
      (
        (await (await read(platform, privateCase.case.id)).json()) as {
          items: unknown[]
        }
      ).items
    ).toEqual([{ userId: "platform", name: "platform" }])
    await db
      .prepare(
        "UPDATE event_permissions SET revoked_at = ? WHERE user_id = 'support'"
      )
      .bind(Date.now())
      .run()
    await db
      .prepare(
        "INSERT INTO profiles (user_id, suspended_at, updated_at) VALUES ('platform', ?, ?)"
      )
      .bind(Date.now(), Date.now())
      .run()
    expect(
      ((await (await read(owner)).json()) as { items: unknown[] }).items
    ).toEqual([{ userId: "owner", name: "owner" }])
  })
})
