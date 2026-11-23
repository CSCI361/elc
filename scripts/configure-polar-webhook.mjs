import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseEnv } from "node:util"

// Usage:
//   setup <https://….trycloudflare.com/api/webhooks/polar>   local Worker via a tunnel
//   preview                                                  deployed preview Worker
//   deliveries [preview] | disable [preview]
const directory = fileURLToPath(new URL("../", import.meta.url))
const varsPath = new URL("../apps/api/.dev.vars", import.meta.url)
const wranglerPath = new URL("../apps/api/wrangler.jsonc", import.meta.url)
const action = process.argv[2]
const target =
  action === "preview" || process.argv[3] === "preview" ? "preview" : "local"
const statePath = new URL(
  target === "preview"
    ? "../.wrangler/polar-webhook-endpoint.preview.json"
    : "../.wrangler/polar-webhook-endpoint.json",
  import.meta.url
)
const contents = await readFile(varsPath, "utf8")
const env = parseEnv(contents)
const saved = await readFile(statePath, "utf8")
  .then(JSON.parse)
  .catch(() => null)
// The Worker's own sandbox configuration; never printed.
const previewSecrets = [
  "POLAR_ACCESS_TOKEN",
  "POLAR_ORGANIZATION_ID",
  "POLAR_PRODUCT_ID",
]
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Errors whose messages never contain secret values. */
class SafeError extends Error {}

async function call(path, method = "GET", body) {
  const response = await fetch(`https://sandbox-api.polar.sh/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.POLAR_ACCESS_TOKEN}`,
      "Polar-Version": "2026-04",
      "User-Agent": "elc-sandbox-acceptance/1.0",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(25000),
  })
  if (!response.ok)
    throw new Error(`Sandbox webhook API returned HTTP ${response.status}`)
  return response.status === 204 ? null : response.json()
}

/** The preview origin comes from the committed Wrangler environment, not from input. */
async function previewWebhookUrl() {
  const source = await readFile(wranglerPath, "utf8")
  const config = JSON.parse(source.replace(/,(\s*[}\]])/g, "$1"))
  const vars = config.env?.preview?.vars
  assert.equal(vars?.ENVIRONMENT, "preview")
  const origin = new URL(vars.APP_ORIGIN)
  assert.equal(origin.protocol, "https:")
  assert.ok(origin.hostname.endsWith(".workers.dev"))
  return new URL("/api/webhooks/polar", origin)
}

/** The workspace Wrangler, run through Node so no shell or global install is needed. */
async function wranglerBin() {
  const require = createRequire(import.meta.url)
  const manifest = require.resolve("wrangler/package.json")
  const { bin } = JSON.parse(await readFile(manifest, "utf8"))
  return join(dirname(manifest), typeof bin === "string" ? bin : bin.wrangler)
}

/** Secret values reach Wrangler on stdin only, so they never appear in argv or output. */
async function putPreviewSecret(name, value) {
  const bin = await wranglerBin()
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        bin,
        "secret",
        "put",
        name,
        "--env",
        "preview",
        "--config",
        "apps/api/wrangler.jsonc",
      ],
      {
        cwd: directory,
        stdio: ["pipe", "ignore", "inherit"],
      }
    )
    child.on("error", () =>
      reject(new SafeError(`Wrangler could not start for ${name}`))
    )
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new SafeError(`Wrangler could not store ${name}`))
    )
    child.stdin.end(value)
  })
}

async function configureEndpoint(url, name) {
  // Recover an uncertain previous create by name; do not make duplicate endpoints.
  const list = await call(
    `/webhooks/endpoints?organization_id=${encodeURIComponent(env.POLAR_ORGANIZATION_ID)}&limit=100`
  )
  assert.ok(
    list.pagination.max_page <= 1,
    "Review the bounded endpoint list before continuing"
  )
  const matching = list.items.filter((item) => item.name === name)
  assert.ok(matching.length <= 1, "Ambiguous sandbox endpoint")
  const existing = saved ?? matching[0]
  const body = {
    url: url.href,
    name,
    format: "raw",
    api_version: "2026-04",
    events: [
      "checkout.created",
      "checkout.updated",
      "checkout.expired",
      "order.created",
      "order.updated",
      "order.paid",
      "order.refunded",
      "refund.created",
      "refund.updated",
    ],
  }
  const endpoint = existing
    ? await call(`/webhooks/endpoints/${existing.id}`, "PATCH", {
        ...body,
        enabled: true,
      })
    : await call("/webhooks/endpoints", "POST", {
        ...body,
        // The scoped organization token supplies this association.
      })
  assert.equal(endpoint.organization_id, env.POLAR_ORGANIZATION_ID)
  assert.equal(endpoint.api_version, "2026-04")
  assert.ok(typeof endpoint.secret === "string" && endpoint.secret.length >= 20)
  await writeFile(
    statePath,
    JSON.stringify({
      id: endpoint.id,
      url: endpoint.url,
      apiVersion: endpoint.api_version,
    }),
    { mode: 0o600 }
  )
  return endpoint
}

try {
  if (action === "setup") {
    const url = new URL(process.argv[3])
    assert.equal(url.protocol, "https:")
    assert.ok(url.hostname.endsWith(".trycloudflare.com"))
    assert.equal(url.pathname, "/api/webhooks/polar")
    assert.equal(url.search + url.hash + url.username + url.password, "")
    const endpoint = await configureEndpoint(url, "elc-local-acceptance")
    const next = contents
      .split("\n")
      .filter((line) => !/^POLAR_WEBHOOK_SECRET\s*=/.test(line))
      .join("\n")
      .trimEnd()
    await writeFile(
      varsPath,
      `${next}\nPOLAR_WEBHOOK_SECRET=${JSON.stringify(endpoint.secret)}\n`,
      { mode: 0o600 }
    )
    console.log(
      JSON.stringify({
        configured: true,
        endpointId: endpoint.id,
        apiVersion: endpoint.api_version,
        secretSaved: true,
      })
    )
  } else if (action === "preview") {
    assert.ok(env.POLAR_ACCESS_TOKEN, "Add POLAR_ACCESS_TOKEN to .dev.vars")
    assert.ok(
      uuid.test(env.POLAR_ORGANIZATION_ID ?? ""),
      "Add a valid POLAR_ORGANIZATION_ID"
    )
    assert.ok(
      uuid.test(env.POLAR_PRODUCT_ID ?? ""),
      "Add a valid POLAR_PRODUCT_ID"
    )
    const url = await previewWebhookUrl()
    const endpoint = await configureEndpoint(url, "elc-preview")
    // The local signing secret belongs to a different endpoint; preview gets its own.
    for (const name of previewSecrets) await putPreviewSecret(name, env[name])
    await putPreviewSecret("POLAR_WEBHOOK_SECRET", endpoint.secret)
    console.log(
      JSON.stringify({
        configured: true,
        endpointId: endpoint.id,
        url: endpoint.url,
        apiVersion: endpoint.api_version,
        previewSecretsStored: [...previewSecrets, "POLAR_WEBHOOK_SECRET"],
      })
    )
  } else if (action === "disable") {
    assert.ok(saved?.id)
    await call(`/webhooks/endpoints/${saved.id}`, "PATCH", { enabled: false })
    console.log(`Sandbox webhook endpoint (${target}) disabled.`)
  } else if (action === "deliveries") {
    assert.ok(saved?.id)
    const result = await call(
      `/webhooks/deliveries?endpoint_id=${saved.id}&limit=100`
    )
    console.log(
      JSON.stringify(
        result.items.map((item) => ({
          id: item.id,
          createdAt: item.created_at,
          succeeded: item.succeeded,
          httpCode: item.http_code,
          eventType: item.webhook_event?.type,
        }))
      )
    )
  } else
    throw new SafeError(
      "Use setup with a webhook-only tunnel URL, preview, deliveries [preview], or disable [preview]"
    )
} catch (error) {
  console.error(
    error instanceof assert.AssertionError
      ? `Webhook configuration assertion failed: ${error.generatedMessage ? "inspect the private endpoint state." : error.message}`
      : error instanceof SafeError ||
          (error instanceof Error &&
            /^Sandbox webhook API returned HTTP \d+$/.test(error.message))
        ? error.message
        : "Sandbox webhook configuration stopped; no secrets logged."
  )
  process.exitCode = 1
}
