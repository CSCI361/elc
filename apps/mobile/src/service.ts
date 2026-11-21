import Constants from "expo-constants"
import * as SecureStore from "expo-secure-store"
import { createAuthClient } from "better-auth/react"
import { expoClient } from "@better-auth/expo/client"
import { policy } from "@elc/shared"
import { createNativeApi } from "./api-client"
export { ServiceError } from "./transport"

type Configuration = {
  environment: "local" | "preview" | "demo"
  apiOrigin: string
}
const extra = Constants.expoConfig?.extra as Partial<Configuration> | undefined
if (!extra?.apiOrigin || !extra.environment)
  throw new Error("Mobile API configuration is missing.")
export const configuration: Configuration = {
  environment: extra.environment,
  apiOrigin: extra.apiOrigin,
}
export const authClient = createAuthClient({
  baseURL: configuration.apiOrigin,
  plugins: [
    expoClient({
      scheme: "elc",
      cookiePrefix: policy.authCookiePrefix,
      storagePrefix: `elc-${configuration.environment}`,
      storage: SecureStore,
      disableCache: true,
    }),
  ],
})
export const service = createNativeApi(configuration.apiOrigin, () =>
  authClient.getCookie()
)
