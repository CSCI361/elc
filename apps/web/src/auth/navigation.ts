export type AuthMode =
  | "sign-in"
  | "sign-up"
  | "verify-email"
  | "forgot-password"
  | "reset-password"
  | "verified"

export function safeReturnPath(value: string | null, origin: string): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.split("").some((character) => character.charCodeAt(0) <= 32)
  )
    return "/account"
  try {
    const url = new URL(value, origin)
    if (url.origin !== origin || /^\/(api|auth)(\/|$)/.test(url.pathname))
      return "/account"
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return "/account"
  }
}

export function readAuthRoute(url: URL) {
  const mode =
    url.pathname === "/" ? "sign-in" : url.pathname.slice("/auth/".length)
  const modes: readonly string[] = [
    "sign-in",
    "sign-up",
    "verify-email",
    "forgot-password",
    "reset-password",
    "verified",
  ]
  return {
    mode:
      (url.pathname === "/" || url.pathname.startsWith("/auth/")) &&
      modes.includes(mode)
        ? (mode as AuthMode)
        : null,
    returnTo: safeReturnPath(url.searchParams.get("returnTo"), url.origin),
    resetToken:
      url.pathname === "/auth/reset-password"
        ? url.searchParams.get("token")
        : null,
    hasError: url.searchParams.has("error"),
    passwordReset: url.searchParams.get("notice") === "password-reset",
  }
}

/** Keep password-reset credentials out of subsequent links, history and referrers. */
export function withoutAuthSecrets(url: URL): string {
  const clean = new URL(url)
  for (const key of [
    "token",
    "code",
    "state",
    "email",
    "password",
    "error_description",
  ])
    clean.searchParams.delete(key)
  return `${clean.pathname}${clean.search}${clean.hash}`
}

export function authHref(mode: AuthMode, returnTo = "/account") {
  return `/auth/${mode}${returnTo === "/account" ? "" : `?returnTo=${encodeURIComponent(returnTo)}`}`
}
