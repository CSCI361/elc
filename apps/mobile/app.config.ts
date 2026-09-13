// oxlint-disable-next-line no-undef -- Expo evaluates this dynamic configuration in Node CommonJS.
const configDirectory = __dirname
import process from "node:process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { ExpoConfig } from "expo/config"

const environment = process.env.EXPO_PUBLIC_APP_ENVIRONMENT ?? "local"
if (!["local", "preview", "demo"].includes(environment))
  throw new Error("Use local, preview, or demo for the mobile environment.")
const apiOrigin =
  process.env.EXPO_PUBLIC_API_ORIGIN ??
  (environment === "local" ? "http://localhost:5173" : "")
if (!apiOrigin)
  throw new Error(
    "Configure EXPO_PUBLIC_API_ORIGIN for this mobile environment."
  )
const parsedOrigin = new URL(apiOrigin)
if (
  !["http:", "https:"].includes(parsedOrigin.protocol) ||
  parsedOrigin.username ||
  parsedOrigin.password ||
  parsedOrigin.pathname !== "/" ||
  parsedOrigin.search ||
  parsedOrigin.hash ||
  (environment !== "local" && parsedOrigin.protocol !== "https:")
)
  throw new Error(
    "Use an API origin without credentials, paths, or query parameters; preview and demo require HTTPS."
  )
const localPin = resolve(
  configDirectory,
  "../../.wrangler/offline-public-key.json"
)
const offlinePublicKeyPin: unknown = process.env
  .EXPO_PUBLIC_OFFLINE_PUBLIC_KEY_JSON
  ? JSON.parse(process.env.EXPO_PUBLIC_OFFLINE_PUBLIC_KEY_JSON)
  : environment === "local" && existsSync(localPin)
    ? JSON.parse(readFileSync(localPin, "utf8"))
    : null
if (JSON.stringify(offlinePublicKeyPin).includes('"d":'))
  throw new Error(
    "Mobile configuration must contain only the public signing-key pin."
  )

const config: ExpoConfig = {
  name:
    environment === "demo" ? "elc Event Admin" : `elc Admin (${environment})`,
  slug: "elc-event-admin",
  scheme: "elc",
  version: "0.0.1",
  orientation: "portrait",
  userInterfaceStyle: "light",
  platforms: ["ios", "android"],
  ios: {
    bundleIdentifier: `kz.elc.admin${environment === "demo" ? "" : `.${environment}`}`,
    supportsTablet: true,
    infoPlist:
      environment === "local"
        ? {
            NSAppTransportSecurity: {
              NSAllowsArbitraryLoads: true,
              NSAllowsLocalNetworking: true,
            },
          }
        : {},
  },
  android: {
    package: `kz.elc.admin${environment === "demo" ? "" : `.${environment}`}`,
  },
  plugins: [
    [
      "expo-camera",
      {
        cameraPermission:
          "elc билетінің QR кодын тексеру үшін камераға рұқсат беріңіз.",
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    "expo-secure-store",
    ["expo-sqlite", { useSQLCipher: true }],
    [
      "expo-build-properties",
      {
        ios: { deploymentTarget: "16.4" },
        android: {
          minSdkVersion: 29,
          usesCleartextTraffic: environment === "local",
        },
      },
    ],
  ],
  extra: { environment, apiOrigin: parsedOrigin.origin, offlinePublicKeyPin },
}
export default config
