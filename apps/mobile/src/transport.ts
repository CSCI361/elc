export class ServiceError extends Error {
  readonly status: number | null
  constructor(status: number | null) {
    super("The service request failed.")
    this.status = status
  }
}
export type ApiOptions = {
  method?: "GET" | "POST" | "PATCH"
  body?: unknown
  signal?: AbortSignal
}
export const uncertainRequest = (error: unknown) =>
  !(error instanceof ServiceError) ||
  error.status === null ||
  error.status >= 500 ||
  error.status === 408 ||
  error.status === 429

/** Cookie forwarding is confined to this environment's API origin. No automatic retries. */
export function authenticatedFetch(
  apiOrigin: string,
  getCookie: () => Promise<string | null>,
  fetcher: typeof fetch = fetch
): typeof fetch {
  return async (input, options = {}) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    )
    if (
      url.origin !== apiOrigin ||
      !url.pathname.startsWith("/api/") ||
      url.username ||
      url.password
    )
      throw new ServiceError(403)
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), 15_000)
    const abort = () => timeout.abort()
    options.signal?.addEventListener("abort", abort, { once: true })
    if (options.signal?.aborted) timeout.abort()
    try {
      const cookie = await getCookie()
      if (timeout.signal.aborted) throw new ServiceError(null)
      const headers = new Headers(options.headers)
      headers.set("Origin", "elc://")
      headers.set("Content-Type", "application/json")
      headers.delete("Cookie")
      if (cookie) headers.set("Cookie", cookie)
      const response = await fetcher(url.href, {
        ...options,
        headers,
        credentials: "omit",
        redirect: "error",
        signal: timeout.signal,
      })
      if (!response.ok) throw new ServiceError(response.status)
      // Consume the bounded JSON response while the abort deadline is still active.
      const body = await response.text()
      return new Response(response.status === 204 ? null : body, {
        status: response.status,
        headers: response.headers,
      })
    } catch (error) {
      if (error instanceof ServiceError) throw error
      throw new ServiceError(null)
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", abort)
    }
  }
}
export async function responseJson(
  response: Promise<{ json(): Promise<unknown> }>
): Promise<unknown> {
  try {
    return await (await response).json()
  } catch (error) {
    if (error instanceof ServiceError) throw error
    throw new ServiceError(null)
  }
}
export function requestJson(
  apiOrigin: string,
  getCookie: () => Promise<string | null>,
  path: string,
  options: ApiOptions = {},
  fetcher: typeof fetch = fetch
): Promise<unknown> {
  return responseJson(
    authenticatedFetch(
      apiOrigin,
      getCookie,
      fetcher
    )(`${apiOrigin}/api${path}`, {
      method: options.method ?? "GET",
      signal: options.signal,
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    })
  )
}
