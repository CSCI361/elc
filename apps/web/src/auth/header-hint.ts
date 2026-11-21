const signedInKey = "elc.signed-in.v1"
const platformKey = "elc.platform-links.v1"
const platformHrefs = [
  "/admin/accounts",
  "/admin/settings",
  "/admin/deliveries",
] as const
export type PlatformHref = (typeof platformHrefs)[number]

export function platformHrefsFor(
  permissions: readonly string[]
): PlatformHref[] {
  const canModerate = permissions.includes("platform:moderate")
  const hrefs: PlatformHref[] = []
  if (canModerate || permissions.includes("platform:configure"))
    hrefs.push(canModerate ? "/admin/accounts" : "/admin/settings")
  if (permissions.includes("platform:recover")) hrefs.push("/admin/deliveries")
  return hrefs
}

export function parsePlatformHint(raw: string | null): PlatformHref[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]")
    return Array.isArray(value)
      ? value.filter((href): href is PlatformHref =>
          platformHrefs.includes(href)
        )
      : []
  } catch {
    return []
  }
}

export function readHeaderHint(): {
  signedIn: boolean
  platform: PlatformHref[]
} {
  try {
    return {
      signedIn: localStorage.getItem(signedInKey) === "1",
      platform: parsePlatformHint(localStorage.getItem(platformKey)),
    }
  } catch {
    return { signedIn: false, platform: [] }
  }
}

export function rememberSignedIn(signedIn: boolean) {
  try {
    if (signedIn) localStorage.setItem(signedInKey, "1")
    else {
      localStorage.removeItem(signedInKey)
      localStorage.removeItem(platformKey)
    }
  } catch {
    return
  }
}

export function rememberPlatform(hrefs: PlatformHref[]) {
  try {
    localStorage.setItem(platformKey, JSON.stringify(hrefs))
  } catch {
    return
  }
}
