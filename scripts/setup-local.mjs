import { createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto"
import { appendFile, chmod, mkdir, readFile, writeFile } from "node:fs/promises"

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

// Keep snapshot signing separate from authentication and recoverable ticket keys.
let configuration = await readFile(destination, "utf8")
function setting(name) {
  const lines = configuration
    .split(/\r?\n/)
    .filter((line) => line.startsWith(`${name}=`))
  if (lines.length > 1) throw new Error(`Duplicate local setting: ${name}`)
  const value = lines[0]?.slice(name.length + 1).trim() ?? ""
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  )
    return value.slice(1, -1)
  return value
}
let encodedKey = setting("OFFLINE_SIGNING_PRIVATE_JWK")
let keyId = setting("OFFLINE_SIGNING_KEY_ID")
if (Boolean(encodedKey) !== Boolean(keyId))
  throw new Error(
    "Restore both local offline signing settings before setup; an existing key is never replaced."
  )
if (!encodedKey) {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  encodedKey = JSON.stringify(pair.privateKey.export({ format: "jwk" }))
  keyId = "local-v1"
  for (const [name, value] of [
    ["OFFLINE_SIGNING_PRIVATE_JWK", `'${encodedKey}'`],
    ["OFFLINE_SIGNING_KEY_ID", keyId],
  ]) {
    const line = `${name}=${value}`
    const pattern = new RegExp(`^${name}=.*$`, "m")
    configuration = pattern.test(configuration)
      ? configuration.replace(pattern, () => line)
      : `${configuration}${configuration.endsWith("\n") ? "" : "\n"}${line}\n`
  }
  await writeFile(destination, configuration, { mode: 0o600 })
  await chmod(destination, 0o600)
  console.log("Created a private local offline signing key.")
}
let publicJwk
try {
  const privateJwk = JSON.parse(encodedKey)
  if (
    privateJwk.kty !== "EC" ||
    privateJwk.crv !== "P-256" ||
    !privateJwk.d ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(keyId)
  )
    throw new Error("Invalid key")
  publicJwk = createPublicKey({ key: privateJwk, format: "jwk" }).export({
    format: "jwk",
  })
} catch {
  throw new Error(
    "Local offline signing configuration is invalid; restore its original key pair."
  )
}
const publicPath = new URL(
  "../.wrangler/offline-public-key.json",
  import.meta.url
)
await mkdir(new URL("../.wrangler/", import.meta.url), { recursive: true })
await writeFile(
  publicPath,
  JSON.stringify({ keyId, publicJwk }, null, 2) + "\n",
  { mode: 0o600 }
)
console.log(
  "Saved the local public-key pin in .wrangler/offline-public-key.json."
)
