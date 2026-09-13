import { EventApiError, mutation, type Parser } from "../events/api"

export type OfflineCommand = {
  phase: "pending" | "uncertain" | "failed" | "succeeded"
  request: { path: string; body: Readonly<Record<string, unknown>> }
  error?: unknown
}
type Send = (
  path: string,
  schema: Parser<unknown>,
  body: unknown
) => Promise<unknown>

/** The exact envelope outlives card remounts and polling failures within this account workspace. */
export function createOfflineCommands(send: Send = mutation) {
  const listeners = new Set<() => void>()
  const records = new Map<string, OfflineCommand>()
  const publish = (key: string, value: OfflineCommand) => {
    records.set(key, value)
    listeners.forEach((notify) => notify())
  }
  return {
    get: (key: string) => records.get(key),
    subscribe: (notify: () => void) => {
      listeners.add(notify)
      return () => {
        listeners.delete(notify)
      }
    },
    resetFailed(key: string) {
      if (records.get(key)?.phase !== "failed") return
      records.delete(key)
      listeners.forEach((notify) => notify())
    },
    async submit(
      key: string,
      path: string,
      schema: Parser<unknown>,
      body: Record<string, unknown>
    ) {
      const previous = records.get(key)
      if (previous?.phase === "pending" || previous?.phase === "succeeded")
        return false
      const request =
        previous?.phase === "uncertain"
          ? previous.request
          : {
              path,
              body: Object.freeze(
                structuredClone({ ...body, requestId: crypto.randomUUID() })
              ),
            }
      publish(key, { phase: "pending", request })
      try {
        await send(request.path, schema, request.body)
        publish(key, { phase: "succeeded", request })
        return true
      } catch (error) {
        const definite =
          error instanceof EventApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408 &&
          error.status !== 429
        publish(key, {
          phase: definite ? "failed" : "uncertain",
          request,
          error,
        })
        return false
      }
    },
  }
}
export type OfflineCommands = ReturnType<typeof createOfflineCommands>
