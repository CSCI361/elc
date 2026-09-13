import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { build } from "vite-plus"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { AttachmentValidationError, type AttachmentErrorCode } from "./limits"
import type { validateAttachment } from "./validate"

export async function buildAttachmentWorker() {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    ssr: {
      target: "webworker",
      noExternal: true,
      resolve: { conditions: ["workerd", "worker", "browser"] },
    },
    build: {
      ssr: fileURLToPath(new URL("./test-worker.ts", import.meta.url)),
      write: false,
      minify: false,
      rollupOptions: { external: [/^cloudflare:/, /^node:/] },
    },
  })
  if (Array.isArray(result) || !("output" in result))
    throw new Error("Unexpected attachment test bundle")
  const entry = result.output.find(
    (part) => part.type === "chunk" && part.isEntry
  )
  if (!entry || entry.type !== "chunk")
    throw new Error("Missing attachment test bundle")
  return entry.code
}
export async function attachmentRuntime(script: string) {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script,
      compatibilityDate: "2026-09-12",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      r2Buckets: ["FILES"],
      bindings: {
        ENVIRONMENT: "preview",
        APP_ORIGIN: "https://elc.test",
        AUTH_SECRET: "Synthetic support attachment authentication secret",
        EMAIL_FROM: "elc <noreply@example.invalid>",
      },
    })
  )
  try {
    const DB = (await runtime.getD1Database("DB")) as unknown as D1Database
    const FILES = (await runtime.getR2Bucket("FILES")) as unknown as R2Bucket
    const directory = new URL("../../../migrations/", import.meta.url)
    for (const file of (await readdir(directory))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      const statements = (await readFile(new URL(file, directory), "utf8"))
        .split("--> statement-breakpoint")
        .filter((sql) => sql.replace(/^\s*--.*$/gm, "").trim())
        .map((sql) => DB.prepare(sql))
      if (statements.length) await DB.batch(statements)
    }
    const validate: typeof validateAttachment = async (bytes, declaredType) => {
      const response = await runtime.dispatchFetch(
        "https://elc.test/__test/validate",
        {
          method: "POST",
          headers: { "Content-Type": declaredType },
          body: new Uint8Array(bytes).buffer,
        }
      )
      if (!response.ok)
        throw new AttachmentValidationError(
          ((await response.json()) as { code: AttachmentErrorCode }).code
        )
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: declaredType as
          | "image/png"
          | "image/jpeg"
          | "application/pdf",
      }
    }
    return { runtime, DB, FILES, validate }
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}
