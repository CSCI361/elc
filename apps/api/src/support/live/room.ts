import { DurableObject } from "cloudflare:workers"
import type { Bindings } from "../../env"
import { recoveryPaused } from "../../recovery/gate"
import { liveAccess } from "./access"
import {
  clientMessageSchema,
  connectionSchema,
  liveJobSchema,
  liveQuerySchema,
  MAX_ACTOR_SOCKETS,
  MAX_CASE_SOCKETS,
  MAX_CLIENT_BYTES,
  MAX_CLIENT_MESSAGES_PER_MINUTE,
  MAX_CONNECTION_MS,
  MAX_SESSION_SOCKETS,
  MAX_UPDATES_PER_MINUTE,
  REVALIDATE_MS,
  SUPPORT_PROTOCOL,
  type Connection,
  type SupportLiveFrame,
} from "./protocol"

type CommittedUpdate = { id: string; case_id: string; sequence: number }

/** D1 owns the conversation. This object stores only hibernatable subscription state. */
export class SupportCase extends DurableObject<Bindings> {
  private connection(ws: WebSocket): Connection | null {
    const parsed = connectionSchema.safeParse(ws.deserializeAttachment())
    if (parsed.success) return parsed.data
    this.close(ws, 1008, "Subscription unavailable.")
    return null
  }

  private close(ws: WebSocket, code: number, reason: string) {
    if (ws.readyState === WebSocket.OPEN) ws.close(code, reason)
  }

  private sameCase(caseId: string) {
    return this.ctx.id.equals(this.env.SUPPORT.idFromName(caseId))
  }

  private async authorize(ws: WebSocket) {
    if (recoveryPaused(this.env)) {
      this.close(ws, 1013, "Service recovery is in progress.")
      return null
    }
    const state = this.connection(ws)
    if (!state) return null
    if (
      !this.sameCase(state.caseId) ||
      Date.now() - state.connectedAt >= MAX_CONNECTION_MS
    ) {
      this.close(ws, 1008, "Reconnect to continue.")
      return null
    }
    try {
      const allowed = await liveAccess(
        this.env.DB,
        state.caseId,
        state.actorId,
        state.sessionId
      )
      if (!allowed) this.close(ws, 1008, "Access no longer available.")
      return allowed
    } catch (error) {
      this.close(ws, 1011, "Access check unavailable.")
      throw error
    }
  }

  private send(ws: WebSocket, frame: SupportLiveFrame) {
    if (ws.readyState !== WebSocket.OPEN) return
    try {
      ws.send(JSON.stringify(frame))
    } catch {
      this.close(ws, 1013, "Reconnect to recover updates.")
    }
  }

  private async maintainAlarm() {
    const open = this.ctx
      .getWebSockets()
      .some((ws) => ws.readyState === WebSocket.OPEN)
    if (!open) {
      await this.ctx.storage.deleteAlarm()
      return
    }
    const existing = await this.ctx.storage.getAlarm()
    const next = Date.now() + REVALIDATE_MS
    if (existing === null || existing > next)
      await this.ctx.storage.setAlarm(next)
  }

  async fetch(request: Request): Promise<Response> {
    if (recoveryPaused(this.env))
      return new Response(null, {
        status: 503,
        headers: { "Retry-After": "60" },
      })
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === "/connect")
      return this.upgradeConnection(request, url)
    if (request.method === "POST" && url.pathname === "/publish") {
      if (Number(request.headers.get("Content-Length") ?? 0) > 512)
        return new Response(null, { status: 413 })
      const raw = await request.text()
      if (new TextEncoder().encode(raw).length > 512)
        return new Response(null, { status: 413 })
      let body: unknown
      try {
        body = JSON.parse(raw)
      } catch {
        return new Response(null, { status: 400 })
      }
      const parsed = liveJobSchema.safeParse(body)
      if (!parsed.success) return new Response(null, { status: 400 })
      const update =
        await this.env.DB.prepare(`SELECT ch.id, ch.case_id, ch.sequence FROM outbox o
        JOIN support_case_changes ch ON ch.id = json_extract(o.payload_json, '$.changeId')
        WHERE o.id = ? AND o.kind = 'support.live' AND o.entity_id = ch.case_id
          AND json_extract(o.payload_json, '$.caseId') = ch.case_id AND json_extract(o.payload_json, '$.sequence') = ch.sequence`)
          .bind(parsed.data.outboxId)
          .first<CommittedUpdate>()
      if (!update || !this.sameCase(update.case_id))
        return new Response(null, { status: 409 })
      for (const ws of this.ctx.getWebSockets()) await this.deliver(ws, update)
      await this.maintainAlarm()
      return new Response(null, { status: 204 })
    }
    return new Response(null, { status: 404 })
  }

  private async upgradeConnection(
    request: Request,
    url: URL
  ): Promise<Response> {
    if (
      request.headers.get("Upgrade")?.toLowerCase() !== "websocket" ||
      request.headers.get("Sec-WebSocket-Protocol") !== SUPPORT_PROTOCOL
    )
      return new Response(null, { status: 426 })
    const caseId = url.searchParams.get("caseId") ?? ""
    const actorId = request.headers.get("X-Elc-Actor") ?? ""
    const sessionId = request.headers.get("X-Elc-Session") ?? ""
    if (
      [caseId, actorId, sessionId].some(
        (id) => id.length === 0 || id.length > 128
      ) ||
      !this.sameCase(caseId)
    )
      return new Response(null, { status: 403 })
    const query = liveQuerySchema.safeParse({
      after: url.searchParams.get("after") ?? "0",
    })
    if (!query.success) return new Response(null, { status: 400 })
    const allowed = await liveAccess(this.env.DB, caseId, actorId, sessionId)
    if (!allowed) return new Response(null, { status: 403 })
    if (query.data.after > allowed.last_sequence)
      return new Response(null, { status: 400 })
    const connections = this.ctx
      .getWebSockets()
      .filter((ws) => ws.readyState === WebSocket.OPEN)
    const states = connections.flatMap((ws) => {
      const state = this.connection(ws)
      return state ? [state] : []
    })
    if (
      connections.length >= MAX_CASE_SOCKETS ||
      states.filter((state) => state.sessionId === sessionId).length >=
        MAX_SESSION_SOCKETS ||
      states.filter((state) => state.actorId === actorId).length >=
        MAX_ACTOR_SOCKETS
    )
      return new Response(null, { status: 429 })
    // oxlint-disable-next-line no-undef -- Provided by the Workers runtime and Workers types.
    const pair = new WebSocketPair()
    const now = Date.now()
    const state: Connection = {
      version: 1,
      caseId,
      actorId,
      sessionId,
      connectedAt: now,
      lastSentSequence: query.data.after,
      inputWindowAt: now,
      inputCount: 0,
      outputWindowAt: now,
      outputCount: 0,
    }
    this.ctx.acceptWebSocket(pair[1])
    pair[1].serializeAttachment(state)
    // No await between the final persisted-session check above and this first metadata frame.
    this.send(pair[1], {
      type: "ready",
      version: 1,
      caseId,
      throughSequence: allowed.last_sequence,
      revalidateAfterMs: REVALIDATE_MS,
    })
    await this.maintainAlarm()
    return new Response(null, {
      status: 101,
      webSocket: pair[0],
      headers: { "Sec-WebSocket-Protocol": SUPPORT_PROTOCOL },
    })
  }

  private async deliver(ws: WebSocket, update: CommittedUpdate) {
    if (ws.readyState !== WebSocket.OPEN || !(await this.authorize(ws))) return
    const state = this.connection(ws)
    if (
      !state ||
      update.case_id !== state.caseId ||
      update.sequence <= state.lastSentSequence
    )
      return
    const now = Date.now()
    if (now - state.outputWindowAt >= 60_000) {
      state.outputWindowAt = now
      state.outputCount = 0
    }
    if (++state.outputCount > MAX_UPDATES_PER_MINUTE) {
      this.close(ws, 1013, "Reconnect to recover updates.")
      return
    }
    this.send(ws, {
      type: "case_update",
      version: 1,
      caseId: update.case_id,
      updateId: update.id,
      sequence: update.sequence,
    })
    state.lastSentSequence = update.sequence
    ws.serializeAttachment(state)
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (
      typeof message !== "string" ||
      message.length > MAX_CLIENT_BYTES ||
      new TextEncoder().encode(message).length > MAX_CLIENT_BYTES
    ) {
      this.close(ws, 1009, "Message limit exceeded.")
      return
    }
    let raw: unknown
    try {
      raw = JSON.parse(message)
    } catch {
      this.close(ws, 1008, "Use the support protocol.")
      return
    }
    if (!clientMessageSchema.safeParse(raw).success) {
      this.close(ws, 1008, "Messages are saved through REST.")
      return
    }
    const state = this.connection(ws)
    if (!state) return
    const now = Date.now()
    if (now - state.inputWindowAt >= 60_000) {
      state.inputWindowAt = now
      state.inputCount = 0
    }
    if (++state.inputCount > MAX_CLIENT_MESSAGES_PER_MINUTE) {
      this.close(ws, 1008, "Ping limit exceeded.")
      return
    }
    ws.serializeAttachment(state)
    const allowed = await this.authorize(ws)
    if (allowed)
      this.send(ws, {
        type: "pong",
        version: 1,
        throughSequence: allowed.last_sequence,
      })
    await this.maintainAlarm()
  }

  async alarm() {
    try {
      for (const ws of this.ctx.getWebSockets())
        if (ws.readyState === WebSocket.OPEN) await this.authorize(ws)
    } finally {
      await this.maintainAlarm()
    }
  }

  async webSocketClose() {
    await this.maintainAlarm()
  }
  async webSocketError(ws: WebSocket) {
    this.close(ws, 1011, "Reconnect to continue.")
    await this.maintainAlarm()
  }
}
