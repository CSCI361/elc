import { readFile, readdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { build } from "vite-plus"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import type { Bindings } from "../../env"

export async function buildSupportTestWorker() {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    ssr: {
      target: "webworker",
      noExternal: true,
      resolve: { conditions: ["workerd", "worker", "browser"] },
    },
    resolve: { conditions: ["workerd", "worker", "browser"] },
    build: {
      ssr: fileURLToPath(new URL("./test-worker.ts", import.meta.url)),
      write: false,
      minify: false,
      rollupOptions: {
        external: [/^cloudflare:/, /^node:/],
      },
    },
  })
  if (Array.isArray(result) || !("output" in result))
    throw new Error("Unexpected support test bundle")
  const entry = result.output.find(
    (file) => file.type === "chunk" && file.isEntry
  )
  if (!entry || entry.type !== "chunk")
    throw new Error("Support test entry was not generated")
  return entry.code
}

export async function createSupportLiveRuntime(
  script: string,
  recoveryMode?: "paused"
) {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      name: "support-live-test",
      modules: true,
      script,
      compatibilityDate: "2026-09-12",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      queueProducers: { DELIVERY: "support-live-delivery" },
      queueConsumers: {
        "support-live-delivery": { maxBatchSize: 5, maxBatchTimeout: 1 },
      },
      durableObjects: {
        SUPPORT: { className: "TestSupportCase", useSQLite: true },
      },
      bindings: {
        ENVIRONMENT: "preview",
        APP_ORIGIN: "https://elc.test",
        AUTH_SECRET: "Disposable support live authentication fixture secret",
        EMAIL_FROM: "elc <noreply@example.invalid>",
        ...(recoveryMode ? { RECOVERY_MODE: recoveryMode } : {}),
      },
    })
  )
  try {
    const DB = (await runtime.getD1Database("DB")) as unknown as D1Database
    const migrationDirectory = new URL("../../../migrations/", import.meta.url)
    for (const file of (await readdir(migrationDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      const contents = await readFile(new URL(file, migrationDirectory), "utf8")
      const statements = contents
        .split("--> statement-breakpoint")
        .filter((part) => part.replace(/^\s*--.*$/gm, "").trim())
        .map((sql) => DB.prepare(sql))
      if (statements.length) await DB.batch(statements)
    }
    const SUPPORT = (await runtime.getDurableObjectNamespace(
      "SUPPORT"
    )) as unknown as Bindings["SUPPORT"]
    const DELIVERY = (await runtime.getQueueProducer(
      "DELIVERY"
    )) as unknown as Bindings["DELIVERY"]
    return { runtime, DB, SUPPORT, DELIVERY }
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}
