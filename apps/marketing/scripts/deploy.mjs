import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const environment = process.argv[2]
if (!["preview", "demo"].includes(environment)) {
  throw new Error("Choose the preview or demo deployment environment")
}

const projectDirectory = fileURLToPath(new URL("..", import.meta.url))
const env = { ...process.env, PUBLIC_DEPLOYMENT_ENV: environment }

// Rebuild with the selected public app origin before uploading static assets.
for (const [command, args] of [
  ["astro", ["build"]],
  ["wrangler", ["deploy", "--config", "wrangler.jsonc", "--env", environment]],
]) {
  const result = spawnSync(command, args, {
    cwd: projectDirectory,
    env,
    stdio: "inherit",
    shell: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
