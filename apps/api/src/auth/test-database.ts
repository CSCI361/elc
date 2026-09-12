import { readFile, readdir } from "node:fs/promises"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import type { Bindings } from "../env"

export async function createAuthTestDatabase() {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script:
        "export default { fetch() { return new Response('auth database test'); } }",
      compatibilityDate: "2026-09-12",
      d1Databases: ["DB"],
    })
  )
  try {
    const DB = await runtime.getD1Database("DB")
    const migrationDirectory = new URL("../../migrations/", import.meta.url)
    for (const file of (await readdir(migrationDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(new URL(file, migrationDirectory), "utf8")
      for (const statement of sql
        .split("--> statement-breakpoint")
        .filter((part) => part.replace(/^\s*--.*$/gm, "").trim())) {
        await DB.prepare(statement).run()
      }
    }
    return { runtime, DB: DB as unknown as Bindings["DB"] }
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}
