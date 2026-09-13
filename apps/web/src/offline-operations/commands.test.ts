import { describe, expect, it, vi } from "vite-plus/test"
import { EventApiError } from "../events/api"
import { createOfflineCommands } from "./commands"
import { authorityFailed } from "./use-command"

const schema = { parse: (value: unknown) => value }
const body = { expectedRevision: 4, reason: "Device misplaced", lost: true }
const path = "/events/event/offline/devices/device/revoke"

describe("offline operation retry envelopes", () => {
  it("retries the original revision, reason, target and request ID despite newer polling data", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Network lost"))
      .mockResolvedValue({})
    const commands = createOfflineCommands(send)
    const originalInput = { ...body }
    expect(
      await commands.submit("device:device", path, schema, originalInput)
    ).toBe(false)
    const first = commands.get("device:device")!
    expect(first.phase).toBe("uncertain")
    expect(first.request.body.requestId).toEqual(expect.any(String))
    originalInput.reason = "Changed form text"
    expect(
      await commands.submit("device:device", "/different-target", schema, {
        expectedRevision: 5,
        reason: "Newer data",
        lost: false,
      })
    ).toBe(true)
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0])
    expect(first.request.body).toMatchObject({
      expectedRevision: 4,
      reason: "Device misplaced",
      lost: true,
    })
  })
  it("preserves a report resolution through card unsubscription, remount and reload attempts", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("Lost acknowledgement"))
      .mockResolvedValue({})
    const commands = createOfflineCommands(send),
      firstObserver = vi.fn()
    const stop = commands.subscribe(firstObserver)
    const report = {
      expectedRevision: 0,
      resolution: "admission_confirmed",
      reason: "Witness verified admission",
    }
    await commands.submit(
      "admission:op",
      "/events/event/offline/admissions/op/review",
      schema,
      report
    )
    stop()
    commands.resetFailed("admission:op")
    const secondObserver = vi.fn(),
      stopSecond = commands.subscribe(secondObserver)
    expect(commands.get("admission:op")?.request.body).toMatchObject(report)
    await commands.submit("admission:op", path, schema, {
      resolution: "no_admission",
    })
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0])
    expect(firstObserver).toHaveBeenCalledTimes(2)
    expect(secondObserver).toHaveBeenCalledTimes(2)
    stopSecond()
  })
  it("blocks double submits while a request is in flight and after acknowledgement", async () => {
    let finish!: (value: unknown) => void
    const send = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const commands = createOfflineCommands(send)
    const pending = commands.submit("device:d", path, schema, body)
    expect(commands.get("device:d")?.phase).toBe("pending")
    expect(await commands.submit("device:d", path, schema, body)).toBe(false)
    finish({})
    expect(await pending).toBe(true)
    expect(await commands.submit("device:d", path, schema, body)).toBe(false)
    commands.resetFailed("device:d")
    expect(send).toHaveBeenCalledTimes(1)
  })
  it.each([408, 429, 500, 502, 503])(
    "keeps an exact retry for HTTP %s",
    async (status) => {
      const commands = createOfflineCommands(async () => {
        throw new EventApiError("INTERNAL_ERROR", status)
      })
      await commands.submit("device:d", path, schema, body)
      expect(commands.get("device:d")?.phase).toBe("uncertain")
    }
  )
  it.each([400, 401, 403, 404, 409, 413])(
    "requires a new attempt after a definite HTTP %s failure",
    async (status) => {
      const send = vi
        .fn()
        .mockRejectedValueOnce(new EventApiError("CONFLICT", status))
        .mockResolvedValue({})
      const commands = createOfflineCommands(send)
      await commands.submit("device:d", path, schema, body)
      const previous = commands.get("device:d")!
      expect(previous.phase).toBe("failed")
      expect(authorityFailed(previous)).toBe([401, 403, 404].includes(status))
      commands.resetFailed("device:d")
      await commands.submit("device:d", path, schema, {
        ...body,
        expectedRevision: 5,
      })
      expect(commands.get("device:d")?.request.body.expectedRevision).toBe(5)
      expect(commands.get("device:d")?.request.body.requestId).not.toBe(
        previous.request.body.requestId
      )
    }
  )
  it("does not share uncertain operations between resource IDs or account workspaces", async () => {
    const send = vi.fn().mockRejectedValue(new Error("offline"))
    const first = createOfflineCommands(send),
      second = createOfflineCommands(send)
    await first.submit("device:a", path, schema, body)
    await first.submit("device:b", path, schema, body)
    expect(first.get("device:a")?.request.body.requestId).not.toBe(
      first.get("device:b")?.request.body.requestId
    )
    expect(second.get("device:a")).toBeUndefined()
  })
})
