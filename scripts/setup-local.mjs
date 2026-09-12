import { randomBytes } from "node:crypto"
import { appendFile, readFile, writeFile } from "node:fs/promises"

const destination = new URL("../apps/api/.dev.vars", import.meta.url)
try {
  await writeFile(
    destination,
    `AUTH_SECRET=${randomBytes(48).toString("base64url")}\nTICKET_ENCRYPTION_KEY=${randomBytes(32).toString("base64url")}\n`,
    {
      flag: "wx",
      mode: 0o600,
    }
  )
  console.log("Created private local authentication and ticket configuration.")
} catch (error) {
  if (error.code !== "EEXIST") throw error
  const existing = await readFile(destination, "utf8")
  if (!/^TICKET_ENCRYPTION_KEY=/m.test(existing)) {
    await appendFile(
      destination,
      `${existing.endsWith("\n") ? "" : "\n"}TICKET_ENCRYPTION_KEY=${randomBytes(32).toString("base64url")}\n`
    )
    console.log("Added a private ticket key; preserved existing configuration.")
  } else {
    console.log("Local configuration already exists; preserved it.")
  }
}
