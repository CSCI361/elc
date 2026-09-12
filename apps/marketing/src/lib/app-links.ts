export function resolveAppOrigin(
  configuredOrigin: string | undefined,
  environment: string = "local"
): string {
  if (!["local", "preview", "demo"].includes(environment)) {
    throw new Error("PUBLIC_DEPLOYMENT_ENV must be local, preview, or demo")
  }
  if (!configuredOrigin && environment !== "local") {
    throw new Error("PUBLIC_APP_ORIGIN is required for preview and demo builds")
  }
  const url = new URL(configuredOrigin || "http://localhost:5173")
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "PUBLIC_APP_ORIGIN must be an HTTP(S) origin without a path or credentials"
    )
  }
  if (
    environment !== "local" &&
    (url.protocol !== "https:" ||
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  ) {
    throw new Error(
      "Preview and demo builds require a public HTTPS application origin"
    )
  }
  return url.origin
}

export function appLink(origin: string, locale: "kk" | "ru" | "en"): string {
  const url = new URL("/", origin)
  url.searchParams.set("lang", locale)
  return url.toString()
}
