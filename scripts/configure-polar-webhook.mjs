import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { parseEnv } from "node:util"

const varsPath = new URL("../apps/api/.dev.vars", import.meta.url)
const statePath = new URL(
  "../.wrangler/polar-webhook-endpoint.json",
  import.meta.url
)
const contents = await readFile(varsPath, "utf8")
const env = parseEnv(contents)
const saved = await readFile(statePath, "utf8")
  .then(JSON.parse)
  .catch(() => null)
const action = process.argv[2]
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
try {
  if (action === "setup") {
    const url = new URL(process.argv[3])
    assert.equal(url.protocol, "https:")
    assert.ok(url.hostname.endsWith(".trycloudflare.com"))
    assert.equal(url.pathname, "/api/webhooks/polar")
    assert.equal(url.search + url.hash + url.username + url.password, "")
    const name = "elc-local-acceptance"
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
          organization_id: env.POLAR_ORGANIZATION_ID,
        })
    assert.equal(endpoint.organization_id, env.POLAR_ORGANIZATION_ID)
    assert.equal(endpoint.api_version, "2026-04")
    assert.ok(
      typeof endpoint.secret === "string" && endpoint.secret.length >= 20
    )
    await writeFile(
      statePath,
      JSON.stringify({
        id: endpoint.id,
        url: endpoint.url,
        apiVersion: endpoint.api_version,
      }),
      { mode: 0o600 }
    )
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
  } else if (action === "disable") {
    assert.ok(saved?.id)
    await call(`/webhooks/endpoints/${saved.id}`, "PATCH", { enabled: false })
    console.log("Temporary sandbox webhook endpoint disabled.")
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
    throw new Error(
      "Use setup with a webhook-only tunnel URL, deliveries, or disable"
    )
} catch (error) {
  console.error(
    error instanceof assert.AssertionError
      ? "Webhook configuration assertion failed; inspect the private endpoint state."
      : error instanceof Error &&
          /^Sandbox webhook API returned HTTP \d+$/.test(error.message)
        ? error.message
        : "Sandbox webhook configuration stopped; no secrets logged."
  )
  process.exitCode = 1
}
