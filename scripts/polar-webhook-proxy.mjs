import { createServer } from "node:http"
import { mkdir, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"

// Expose only this bounded webhook handler when testing a temporary HTTPS tunnel.
const directory = new URL("../.wrangler/polar-webhooks/", import.meta.url)
await mkdir(directory, { recursive: true, mode: 0o700 })
const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/api/webhooks/polar") {
    response.writeHead(404).end()
    return
  }
  try {
    let size = 0
    const chunks = []
    for await (const chunk of request) {
      size += chunk.length
      if (size > 256 * 1024) {
        response.writeHead(413).end()
        return
      }
      chunks.push(chunk)
    }
    const headers = { "Content-Type": "application/json" }
    for (const name of [
      "webhook-id",
      "webhook-timestamp",
      "webhook-signature",
    ]) {
      const value = request.headers[name]
      if (typeof value !== "string") {
        response.writeHead(400).end()
        return
      }
      headers[name] = value
    }
    const body = Buffer.concat(chunks).toString("utf8")
    const upstream = await fetch("http://localhost:5173/api/webhooks/polar", {
      method: "POST",
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(25000),
    })
    await writeFile(
      new URL(`${randomUUID()}.json`, directory),
      JSON.stringify({
        receivedAt: new Date().toISOString(),
        headers,
        body,
        status: upstream.status,
      }),
      { mode: 0o600 }
    )
    response
      .writeHead(upstream.status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      .end(await upstream.text())
    console.log(
      JSON.stringify({ kind: "webhook_forwarded", status: upstream.status })
    )
  } catch {
    response.writeHead(502).end()
    console.error("Webhook forwarding failed; no request content logged.")
  }
})
server.requestTimeout = 30000
server.headersTimeout = 10000
server.listen(8799, "127.0.0.1", () =>
  console.log("Webhook-only proxy listening on 127.0.0.1:8799")
)
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close())
