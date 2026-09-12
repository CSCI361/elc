import { randomBytes } from "node:crypto"
import { writeFile } from "node:fs/promises"

const destination = new URL("../apps/api/.dev.vars", import.meta.url)
try {
  await writeFile(
    destination,
    `AUTH_SECRET=${randomBytes(48).toString("base64url")}\n`,
    {
      flag: "wx",
      mode: 0o600,
    }
  )
  console.log("Created private local authentication configuration.")
} catch (error) {
  if (error.code !== "EEXIST") throw error
  console.log(
    "Local authentication configuration already exists; preserved it."
  )
}
