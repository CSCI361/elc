import { readFile } from "node:fs/promises"
import { parseArgs } from "node:util"
import { createBackup } from "./lib/backup-core.mjs"
import {
  validateTarget,
  withCloudflareBackup,
} from "./lib/backup-cloudflare.mjs"

try {
  const { values } = parseArgs({
    options: {
      target: { type: "string" },
      "confirm-database": { type: "string" },
      reason: { type: "string", default: "daily" },
      remote: { type: "boolean", default: false },
    },
  })
  if (!values.target || !values.remote)
    throw new Error(
      "Use --target <private JSON file> --remote --confirm-database <database UUID> [--reason daily|pre-migration|pre-demonstration|pre-restore]"
    )
  const target = validateTarget(
    JSON.parse(await readFile(values.target, "utf8"))
  )
  if (values["confirm-database"] !== target.databaseId)
    throw new Error("Explicit database confirmation does not match the target")
  const result = await withCloudflareBackup(target, (adapter) =>
    createBackup({
      adapter,
      sourceId: target.databaseId,
      reason: values.reason,
    })
  )
  console.log(
    JSON.stringify({
      success: true,
      databaseId: target.databaseId,
      manifestKey: result.manifestKey,
      createdAt: result.manifest.createdAt,
      expiresAt: result.manifest.expiresAt,
      sha256: result.manifest.sha256,
    })
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : "Backup failed")
  process.exitCode = 1
}
