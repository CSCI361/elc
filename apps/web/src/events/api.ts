import { apiErrorSchema } from "@elc/shared"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { useAccount } from "../auth/context"
import type { EventMessageKey } from "./messages"
import { forgetCached, readCached, writeCached } from "./resource-cache"

export type Parser<T> = { parse: (input: unknown) => T }
let serverOffset = 0
export function serverNow() {
  return Date.now() + serverOffset
}
export function useServerNow() {
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(serverNow()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}
export class EventApiError extends Error {
  readonly code: string
  readonly status: number
  readonly reference?: string
  constructor(code: string, status: number, reference?: string) {
    super(code)
    this.code = code
    this.status = status
    this.reference = reference
  }
}
export async function api<T>(
  path: string,
  schema: Parser<T>,
  options: RequestInit = {}
): Promise<T> {
  const started = Date.now()
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
  })
  const serverDate = Date.parse(response.headers.get("Date") ?? "")
  if (Number.isFinite(serverDate))
    serverOffset = serverDate + (Date.now() - started) / 2 - Date.now()
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body)
    throw new EventApiError(
      parsed.success ? parsed.data.error.code : "INTERNAL_ERROR",
      response.status,
      parsed.success ? parsed.data.error.requestId : undefined
    )
  }
  return schema.parse(body)
}
export function mutation<T>(
  path: string,
  schema: Parser<T>,
  body: unknown,
  method = "POST"
) {
  return api(path, schema, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}
export const segment = encodeURIComponent

type ResourceResult<T> = {
  path: string
  version: number
  data?: T
  error?: unknown
}
export function resourceView<T>(
  result: ResourceResult<T> | null,
  path: string,
  version: number,
  keepPrevious = false
): { data?: T; error?: unknown; loading: boolean; refreshing: boolean } {
  const data = result?.path === path || keepPrevious ? result?.data : undefined
  const current = result?.path === path && result.version === version
  return {
    data,
    error: current ? result.error : undefined,
    loading: !current && data === undefined,
    refreshing: !current && data !== undefined,
  }
}
export function useResource<T>(
  path: string,
  schema: Parser<T>,
  pollMs = 0,
  keepPrevious = false
) {
  const { account, status } = useAccount()
  const owner = account ? account.user.id : status === "signed-out" ? "" : null
  const ownerRef = useRef(owner)
  useLayoutEffect(() => {
    ownerRef.current = owner
  })
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<ResourceResult<T> | null>(null)
  const reload = useCallback(() => setVersion((value) => value + 1), [])
  const update = useCallback(
    (data: T) => {
      if (owner !== null) writeCached(owner, path, schema, data)
      setResult({ path, version, data })
    },
    [owner, path, schema, version]
  )
  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    const read = async () => {
      if (pending) return
      pending = true
      const requestOwner = ownerRef.current
      try {
        const data = await api(path, schema, { signal: controller.signal })
        if (controller.signal.aborted) return
        if (requestOwner !== null && ownerRef.current === requestOwner)
          writeCached(requestOwner, path, schema, data)
        setResult({ path, version, data })
      } catch (error) {
        if (controller.signal.aborted) return
        forgetCached(path)
        setResult((previous) => ({
          path,
          version,
          error,
          data:
            previous?.path === path && previous.version === version
              ? previous.data
              : undefined,
        }))
      } finally {
        pending = false
      }
    }
    void read()
    const timer = pollMs
      ? window.setInterval(() => {
          if (document.visibilityState === "visible") void read()
        }, pollMs)
      : undefined
    const focus = () => {
      void read()
    }
    window.addEventListener("focus", focus)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener("focus", focus)
    }
  }, [path, schema, version, pollMs])
  const cached =
    result?.path === path || owner === null
      ? undefined
      : (readCached(owner, path, schema) as T | undefined)
  return {
    ...resourceView(
      cached === undefined ? result : { path, version: -1, data: cached },
      path,
      version,
      keepPrevious
    ),
    reload,
    update,
  }
}

/** An uncertain response can be retried with the same operation ID and payload. */
export function useCommand() {
  const last = useRef<{ signature: string; requestId: string } | null>(null)
  const busy = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const send = useCallback(
    async <T>(
      path: string,
      schema: Parser<T>,
      body: Record<string, unknown>,
      method = "POST"
    ): Promise<T | undefined> => {
      if (busy.current) return undefined
      busy.current = true
      setPending(true)
      setError(null)
      const signature = JSON.stringify({ path, method, body })
      if (last.current?.signature !== signature)
        last.current = { signature, requestId: crypto.randomUUID() }
      try {
        return await mutation(
          path,
          schema,
          { ...body, requestId: last.current.requestId },
          method
        )
      } catch (failure) {
        setError(failure)
        return undefined
      } finally {
        busy.current = false
        setPending(false)
      }
    },
    []
  )
  return { pending, error, send, setError }
}

export function canRetry(error: unknown): boolean {
  const key = errorKey(error)
  return key !== "denied" && key !== "missing"
}

export function errorKey(error: unknown): EventMessageKey {
  if (!(error instanceof EventApiError)) return "error"
  switch (error.code) {
    case "INVALID_INPUT":
      return "invalid"
    case "CONFLICT":
      return "conflict"
    case "UNAUTHENTICATED":
    case "EMAIL_NOT_VERIFIED":
    case "FORBIDDEN":
      return "denied"
    case "NOT_FOUND":
    case "EVENT_UNAVAILABLE":
      return "missing"
    case "PAID_SALES_INACTIVE":
      return "paymentInactive"
    case "SALES_CLOSED":
      return "salesClosed"
    case "INVENTORY_UNAVAILABLE":
      return "inventoryChanged"
    case "RESERVATION_EXPIRED":
      return "expiredHint"
    case "CHECKOUT_FROZEN":
      return "frozen"
    case "ORDER_LIMIT":
      return "limit"
    case "SERVICE_UNAVAILABLE":
      return "serviceUnavailable"
    case "PROMO_INVALID":
    case "PROMO_EXHAUSTED":
      return "promoInvalid"
    default:
      return "error"
  }
}
