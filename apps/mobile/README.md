# elc Event Admin

This Expo application supports online ticket scanning and provisional offline admission for assigned event staff. It includes attendee search, canonical attendance counts, and corrections for staff with a separate `checkin:reverse` permission. The interface labels this as an academic demo and distinguishes server confirmation from an offline record.

## Run and check

Run commands from the repository root after the coordinated `vp install`:

```sh
vp run --filter @elc/mobile typecheck
vp run --filter @elc/mobile bundle
vp test run apps/mobile/src
vp run --filter @elc/mobile start
```

`bundle` exports iOS and Android Hermes bundles with Metro. `start` expects a native development build. Creating those builds requires the corresponding native toolchain:

```sh
vp run --filter @elc/mobile ios
vp run --filter @elc/mobile android
```

The release targets iOS 16.4+ and Android 10+. SQLCipher is enabled through the Expo SQLite config plugin. The encrypted cache requires a rebuilt native development client; Expo Go is unsupported.

## Environments

Copy `.env.example` to an ignored `.env.local` and set `EXPO_PUBLIC_APP_ENVIRONMENT` to `local`, `preview`, or `demo`. Configure `EXPO_PUBLIC_API_ORIGIN` as an origin without a path or query. Preview and demo require HTTPS and must point to their own backend resources.

`http://localhost:5173` addresses the development computer from an iOS simulator. A physical phone needs a reachable LAN address, or the preview HTTPS origin. The backend must listen on an interface that the phone can reach. Authentication callback URLs must also be reachable and match the configured provider when Google acceptance is performed.

The native callback scheme is `elc://`. Local and preview builds have distinct bundle identifiers; use the intended build for callback testing. Google sign-in is enabled only when the backend reports configured credentials. No external Google acceptance is recorded yet.

Offline snapshots require a deployment-pinned public ES256 key. Local configuration reads only `.wrangler/offline-public-key.json`, created by `vp run setup:local`. Preview and demo use `EXPO_PUBLIC_OFFLINE_PUBLIC_KEY_JSON` with their own public pin. Never put the private signing JWK, an auth secret, or a provider token in Expo configuration. A missing public pin prevents snapshot admission. A malformed or private pin is rejected; no downloaded key can replace the deployment pin.

## Authentication and admission

The Better Auth Expo plugin stores native session cookies in SecureStore under an environment-specific prefix. Hono's typed client reads the current cookie before each application API request, sends it only to the configured API origin, and uses `credentials: "omit"`. The `@elc/api/types` import is type-only. Cloudflare declarations and the API asset declaration are included for TypeScript's route inference; they add no Workers code or PDF assets to the native bundle.

Admission credentials remain in memory on the scanner screen. Campaign links and malformed QR payloads are rejected before submission. The camera pauses after capture and while backgrounded. In the offline workspace, a disconnected camera can capture only while a verified snapshot is available. A lost or invalid response stays unconfirmed. An explicit retry uses the same operation ID and body; the transport never retries automatically. Success requires a matching server operation ID and a canonical check-in ID. Leaving the screen discards the raw QR and component state. If an offline cache exists, a hash-only barrier retains the operation ID across restart; recapturing that QR online retries the same operation. A confirmed online scan cannot become a new provisional admission from an older snapshot.

The API requires current `ticket:scan` permission, including for owners. Search returns attendee names and seat details without contacts or admission credentials. It rechecks account and event permission in the same D1 read batch. Corrections use the existing server transition and require independent reversal permission. Pending offline reports appear as a separate count.

Online interface strings are in `packages/shared/src/mobile-locales.ts`; the offline workspace uses `src/offline/copy.ts`. Both cover Kazakh, Russian and English. A saved account preference takes priority; otherwise the first supported device locale is used, with Kazakh fallback. Explicit changes persist to the account.

## Offline storage and recovery

Open the offline workspace, connect with a verified scanner account, choose an assigned event, and prepare a snapshot. Its names, ticket hashes, ticket state and seat data are encrypted in SQLCipher SQLite. A random 256-bit key stays in SecureStore with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; each account, API origin and environment has a separate database. The key is applied before the first schema read. Startup rejects missing SQLCipher support or an unavailable existing key instead of creating a plaintext replacement.

The client verifies the pinned ES256 manifest and every page before installing a snapshot. It rejects partial, tampered, expired and incorrectly bound data. Connected refreshes run every minute while the prepared event is open and preserve pending local scans. Snapshot expiry is four hours from server issuance, capped at event end plus two hours; admission also stops when the event ends. A backwards clock disables offline admission across restart. Only a fresh authenticated snapshot can clear that flag.

Offline results are provisional. A local transaction prevents duplicate admission on this device. An undo can accompany its original scan only before the pair is sealed for upload. Interrupted uploads replay the same batch and operation IDs. Once a batch might have reached the server, the app cannot add a late local undo. The server decides canonical admission, applies current refund and staff/device rules, and reports conflicts separately.

Signing out removes snapshots and locks pending scans. A different account cannot read or upload them. The same account must authenticate online to recover the journal. Cleanup runs at startup, every 30 seconds, and on foregrounding. Acknowledged operation data expires after 24 hours; unsynced data expires seven days after capture. The workspace warns after 24 hours and displays the deletion deadline. Devices that are powered off cannot run cleanup.

The uploaded capture timestamp is an estimate anchored to signed server issuance plus elapsed device time. The encrypted journal also retains the raw device wall-clock capture. Neither timestamp determines canonical admission priority. Raw QR credentials are never persisted in snapshots or journal records.

## Dependency compatibility

Expo 57.0.22 uses React Native 0.86.3 and React 19.2.3. Mobile declares React DOM 19.2.3 as the matching peer provider even though this app exports only native platforms. Its Babel 7.29.7 dependency keeps Expo's Babel 7 transforms away from the root Babel 8 installation. These versions are isolated to the mobile workspace; the web toolchain continues to use Vite+.

The SDK package pins follow Expo's published `bundledNativeModules.json`; `expo install --check` reported that dependencies are up to date. The selected SDK requires Node 22.13+ and Xcode 26.4+ according to the [Expo SDK reference](https://docs.expo.dev/versions/latest/). Authentication follows the [Better Auth Expo integration](https://better-auth.com/docs/integrations/expo), and route inference follows the [Hono RPC guide](https://hono.dev/docs/guides/rpc).

The offline runtime uses Expo SQLite 57.0.3 and Noble 2.4.0. Host tests use the actual `@journeyapps/sqlcipher` 6.0.0 native module, built with node-gyp 12.3.0. Expo uses its own SQLCipher native integration; the host module is a test dependency only.

Recorded checks and remaining physical-device acceptance are in [mobile-online.md](../../docs/evidence/mobile-online.md) and [mobile-offline.md](../../docs/evidence/mobile-offline.md).
