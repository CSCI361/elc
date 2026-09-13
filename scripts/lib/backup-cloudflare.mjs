import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { exportLifetimeMs } from "./backup-core.mjs"
import { prepareRestoreStatements } from "./backup-sql.mjs"

const run = promisify(execFile)
export function validateTarget(target) {
  if (
    ![
      "accountId",
      "databaseId",
      "databaseName",
      "backupBucket",
      "filesBucket",
    ].every((key) => typeof target?.[key] === "string") ||
    !/^[a-f0-9]{32}$/.test(target?.accountId) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      target?.databaseId
    ) ||
    !/^[a-z][a-z0-9-]{2,62}$/.test(target?.databaseName) ||
    !/^[a-z][a-z0-9-]{2,62}$/.test(target?.backupBucket) ||
    !/^[a-z][a-z0-9-]{2,62}$/.test(target?.filesBucket) ||
    target.backupBucket === target.filesBucket ||
    ![7, 30].includes(target?.timeTravelDays)
  )
    throw new Error("Invalid explicit backup target")
  return target
}

export function verifyBucketConfiguration(managed, custom, lifecycle) {
  if (
    managed?.enabled !== false ||
    !Array.isArray(custom?.domains) ||
    custom.domains.length !== 0
  )
    throw new Error(
      "Backup bucket has public access or its privacy could not be verified"
    )
  const rules = lifecycle?.rules
  if (!Array.isArray(rules))
    throw new Error("Backup lifecycle could not be verified")
  const prefix = (rule) => rule.conditions?.prefix ?? ""
  if (
    rules.some(
      (rule) =>
        rule.enabled === true &&
        rule.deleteObjectsTransition &&
        typeof prefix(rule) !== "string"
    )
  )
    throw new Error("Malformed backup lifecycle prefix")
  const applicable = rules.filter(
    (rule) =>
      rule.enabled === true &&
      "exports/".startsWith(prefix(rule)) &&
      rule.deleteObjectsTransition
  )
  // An overlapping shorter rule silently destroys the required history, and a Date rule
  // does not express the agreed per-export lifetime. Require one unambiguous policy.
  if (
    !applicable.length ||
    applicable.some(
      (rule) =>
        rule.deleteObjectsTransition.condition?.type !== "Age" ||
        rule.deleteObjectsTransition.condition.maxAge !==
          exportLifetimeMs / 1000
    )
  )
    throw new Error("Backup exports require an unambiguous 30-day lifecycle")
  // A more-specific rule can shorten a subset of backups too.
  if (
    rules.some(
      (rule) =>
        rule.enabled &&
        prefix(rule).startsWith("exports/") &&
        rule.deleteObjectsTransition &&
        (rule.deleteObjectsTransition.condition?.type !== "Age" ||
          rule.deleteObjectsTransition.condition.maxAge !==
            exportLifetimeMs / 1000)
    )
  )
    throw new Error("A conflicting lifecycle covers part of the export prefix")
  return { private: true, expiresAfterSeconds: exportLifetimeMs / 1000 }
}

export async function withCloudflareBackup(target, callback) {
  validateTarget(target)
  if (!process.env.CLOUDFLARE_API_TOKEN)
    throw new Error(
      "CLOUDFLARE_API_TOKEN is required in the process environment"
    )
  const directory = await mkdtemp(join(tmpdir(), "elc-backup-"))
  const configPath = join(directory, "wrangler.json")
  const envPath = join(directory, ".env")
  const wranglerPath = new URL(
    "../../node_modules/wrangler/bin/wrangler.js",
    import.meta.url
  ).pathname
  try {
    await writeFile(envPath, "", { mode: 0o600 })
    await writeFile(
      configPath,
      JSON.stringify({
        name: "elc-backup-operator",
        account_id: target.accountId,
        compatibility_date: "2026-09-12",
        d1_databases: [
          {
            binding: "DB",
            database_name: target.databaseName,
            database_id: target.databaseId,
          },
        ],
        r2_buckets: [{ binding: "BACKUPS", bucket_name: target.backupBucket }],
      }),
      { mode: 0o600 }
    )
    const wrangler = async (args) => {
      try {
        const result = await run(
          process.execPath,
          [
            wranglerPath,
            ...args,
            "--config",
            configPath,
            "--env-file",
            envPath,
          ],
          {
            cwd: directory,
            env: {
              ...process.env,
              CI: "true",
              WRANGLER_SEND_METRICS: "false",
              WRANGLER_LOG_PATH: join(directory, "wrangler.log"),
            },
            maxBuffer: 4 * 1024 * 1024,
            timeout: 10 * 60 * 1000,
          }
        )
        return result.stdout
      } catch {
        // Wrangler export output includes a signed download URL. Never forward stdout,
        // stderr, child error objects, or provider payloads into application/CI logs.
        throw new Error(
          "Cloudflare backup operation failed; inspect the target and credentials without publishing provider output"
        )
      }
    }
    const api = async (suffix) => {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${target.accountId}/r2/buckets/${target.backupBucket}/${suffix}`,
        {
          headers: {
            authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
          },
          signal: AbortSignal.timeout(30000),
          redirect: "error",
        }
      )
      if (!response.ok)
        throw new Error(`Backup policy request failed (${response.status})`)
      const result = await response.json()
      if (result.success !== true)
        throw new Error("Backup policy request was rejected")
      return result.result
    }
    const adapter = {
      remote: true,
      async policy() {
        const [managed, custom, lifecycle] = await Promise.all([
          api("domains/managed"),
          api("domains/custom"),
          api("lifecycle"),
        ])
        return verifyBucketConfiguration(managed, custom, lifecycle)
      },
      async bookmark() {
        const result = JSON.parse(
          await wrangler(["d1", "time-travel", "info", "DB", "--json"])
        )
        if (typeof result.bookmark !== "string")
          throw new Error("Time Travel returned no bookmark")
        return result.bookmark
      },
      async exportSql() {
        const path = join(directory, "export.sql")
        await writeFile(path, "", { mode: 0o600 })
        await wrangler([
          "d1",
          "export",
          "DB",
          "--remote",
          "--output",
          path,
          "--skip-confirmation",
        ])
        return readFile(path)
      },
      async restoreSql(bytes) {
        const inspected = JSON.parse(
          await wrangler([
            "d1",
            "execute",
            "DB",
            "--remote",
            "--json",
            "--command",
            "SELECT count(*) AS count FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'",
          ])
        )
        if (
          !Array.isArray(inspected) ||
          inspected[0]?.results?.[0]?.count !== 0
        )
          throw new Error("SQL restore requires an empty replacement database")
        const path = join(directory, "restore.sql")
        await writeFile(
          path,
          prepareRestoreStatements(bytes.toString("utf8")).join("\n"),
          { mode: 0o600 }
        )
        await wrangler([
          "d1",
          "execute",
          "DB",
          "--remote",
          "--file",
          path,
          "--yes",
        ])
        const integrity = JSON.parse(
          await wrangler([
            "d1",
            "execute",
            "DB",
            "--remote",
            "--json",
            "--command",
            "PRAGMA foreign_key_check",
          ])
        )
        if (
          !Array.isArray(integrity) ||
          !Array.isArray(integrity[0]?.results) ||
          integrity[0].results.length !== 0
        )
          throw new Error("Restored database failed foreign-key verification")
      },
      async put(key, bytes, type) {
        const path = join(directory, "upload")
        await writeFile(path, bytes, { mode: 0o600 })
        await wrangler([
          "r2",
          "object",
          "put",
          `${target.backupBucket}/${key}`,
          "--remote",
          "--file",
          path,
          "--content-type",
          type,
          "--cache-control",
          "no-store",
          "--force",
        ])
      },
      async get(key) {
        const path = join(directory, "download")
        await writeFile(path, "", { mode: 0o600 })
        await wrangler([
          "r2",
          "object",
          "get",
          `${target.backupBucket}/${key}`,
          "--remote",
          "--file",
          path,
        ])
        return readFile(path)
      },
    }
    return await callback(adapter)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
