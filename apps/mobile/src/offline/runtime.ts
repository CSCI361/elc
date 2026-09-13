import Constants from "expo-constants"
import * as SecureStore from "expo-secure-store"
import * as Crypto from "expo-crypto"
import { authClient, configuration } from "../service"
import { createOfflineApi } from "./api"
import { ClockWatch, OfflineController } from "./controller"
import { OfflineVault } from "./vault"
import { createSnapshotVerifier } from "./verifier"
import { openEncryptedDatabase } from "./native-database"

const extra = Constants.expoConfig?.extra as
  | { offlinePublicKeyPin?: unknown }
  | undefined
// A missing pin disables snapshots, without disabling the online scanner or deleting an existing journal.
const verify = extra?.offlinePublicKeyPin
  ? createSnapshotVerifier(extra.offlinePublicKeyPin)
  : async () => null
const options = {
  keychainService: `kz.elc.offline.${configuration.environment}`,
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
}
export const offlineApi = createOfflineApi(configuration.apiOrigin, () =>
  authClient.getCookie()
)
export const offlineVault = new OfflineVault(
  configuration.environment,
  configuration.apiOrigin,
  {
    storage: {
      get: (key) => SecureStore.getItemAsync(key, options),
      set: (key, value) => SecureStore.setItemAsync(key, value, options),
      remove: (key) => SecureStore.deleteItemAsync(key, options),
    },
    open: openEncryptedDatabase,
    randomKey: async () =>
      Array.from(await Crypto.getRandomBytesAsync(32), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join(""),
    now: Date.now,
    monotonic: () => performance.now(),
    id: Crypto.randomUUID,
    verify,
    account: offlineApi.account,
  }
)
export const offlineClockWatch = new ClockWatch()
export const offlineController = new OfflineController(
  offlineVault,
  offlineApi,
  Crypto.randomUUID,
  () => performance.now(),
  () => offlineClockWatch.reset()
)
