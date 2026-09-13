import { appendFile, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import { restoreBackup } from "./lib/backup-core.mjs"

try {
  const { values } = parseArgs({
    options: {
      manifest: { type: "string" },
      sql: { type: "string" },
      source: { type: "string" },
      target: { type: "string" },
      "confirm-target": { type: "string" },
      adapter: { type: "string" },
      journal: { type: "string" },
      resume: { type: "boolean", default: false },
    },
  })
  if (
    !["manifest", "sql", "source", "target", "adapter", "journal"].every(
      (name) => values[name]
    ) ||
    values.target !== values["confirm-target"]
  )
    throw new Error(
      "Use --manifest <file> --sql <file> --source <source UUID> --target <target UUID> --confirm-target <target UUID> --adapter <trusted operator module> --journal <private JSONL path> [--resume]"
    )
  const manifest = JSON.parse(await readFile(values.manifest, "utf8"))
  const bytes = await readFile(values.sql)
  // A local operator module connects this checked sequence to the deployment's own
  // maintenance controls and provider reconciliation. Never import an untrusted module.
  const module = await import(pathToFileURL(resolve(values.adapter)).href)
  if (typeof module.createRecoveryAdapter !== "function")
    throw new Error("Operator module must export createRecoveryAdapter")
  const adapter = await module.createRecoveryAdapter({
    sourceId: values.source,
    targetId: values.target,
  })
  adapter.journal = async (entry) =>
    appendFile(values.journal, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
  const result = await restoreBackup({
    adapter,
    manifest,
    bytes,
    sourceId: values.source,
    targetId: values.target,
    resume: values.resume,
  })
  console.log(
    JSON.stringify({
      recoveryId: result.recoveryId,
      state: result.state,
      targetId: result.targetId,
    })
  )
} catch {
  // Recovery hooks may contain provider payloads. Do not print their errors or data.
  console.error(
    "Restore stopped. Maintenance remains enabled after any failed recovery step. Inspect the private recovery journal and operator controls."
  )
  process.exitCode = 1
}
