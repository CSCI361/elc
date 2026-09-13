# elc Event Admin

This Expo application supports authenticated online ticket scanning for assigned event staff. It includes attendee search, canonical attendance counts, and corrections for staff with a separate `checkin:reverse` permission. The interface labels this as an academic demo and states that offline verification is not enabled in this build.

## Run and check

Run commands from the repository root after the coordinated `vp install`:

```sh
vp run --filter @elc/mobile typecheck
vp run --filter @elc/mobile bundle
vp test run apps/mobile/src/model.test.ts apps/mobile/src/api-client.test.ts
vp run --filter @elc/mobile start
```

`bundle` exports iOS and Android Hermes bundles with Metro. `start` expects a native development build. Creating those builds requires the corresponding native toolchain:

```sh
vp run --filter @elc/mobile ios
vp run --filter @elc/mobile android
```

The release targets iOS 16.4+ and Android 10+. Expo Go is not the acceptance environment for the planned encrypted offline cache.

## Environments

Copy `.env.example` to an ignored `.env.local` and set `EXPO_PUBLIC_APP_ENVIRONMENT` to `local`, `preview`, or `demo`. Configure `EXPO_PUBLIC_API_ORIGIN` as an origin without a path or query. Preview and demo require HTTPS and must point to their own backend resources.

`http://localhost:5173` addresses the development computer from an iOS simulator. A physical phone needs a reachable LAN address, or the preview HTTPS origin. The backend must listen on an interface that the phone can reach. Authentication callback URLs must also be reachable and match the configured provider when Google acceptance is performed.

The native callback scheme is `elc://`. Local and preview builds have distinct bundle identifiers; use the intended build for callback testing. Google sign-in is enabled only when the backend reports configured credentials. No external Google acceptance is recorded yet.

Public offline key configuration is reserved for the next unit. Local configuration reads only `.wrangler/offline-public-key.json`, created by `vp run setup:local`. Preview and demo use `EXPO_PUBLIC_OFFLINE_PUBLIC_KEY_JSON` with their own public pin. Never put the private signing JWK, an auth secret, or a provider token in Expo configuration. The current bundle contains no offline database or journal implementation.

## Authentication and admission

The Better Auth Expo plugin stores native session cookies in SecureStore under an environment-specific prefix. Hono's typed client reads the current cookie before each application API request, sends it only to the configured API origin, and uses `credentials: "omit"`. The `@elc/api/types` import is type-only. Cloudflare declarations and the API asset declaration are included for TypeScript's route inference; they add no Workers code or PDF assets to the native bundle.

Admission credentials remain in memory on the scanner screen. Campaign links and malformed QR payloads are rejected before submission. The camera pauses after capture and while backgrounded or disconnected. A lost or invalid response stays unconfirmed. An explicit retry uses the same operation ID and body; the transport never retries automatically. Success requires a matching server operation ID and a canonical check-in ID. Leaving the screen or changing the signed-in account discards scanner state.

The API requires current `ticket:scan` permission, including for owners. Search returns attendee names and seat details without contacts or admission credentials. It rechecks account and event permission in the same D1 read batch. Corrections use the existing server transition and require independent reversal permission. Pending offline reports appear as a separate count.

Interface strings are in `packages/shared/src/mobile-locales.ts`. A saved account preference takes priority; otherwise the first supported device locale is used, with Kazakh fallback. Explicit changes persist to the account.

## Dependency compatibility

Expo 57.0.22 uses React Native 0.86.3 and React 19.2.3. Mobile declares React DOM 19.2.3 as the matching peer provider even though this app exports only native platforms. Its Babel 7.29.7 dependency keeps Expo's Babel 7 transforms away from the root Babel 8 installation. These versions are isolated to the mobile workspace; the web toolchain continues to use Vite+.

The SDK package pins follow Expo's published `bundledNativeModules.json`; `expo install --check` reported that dependencies are up to date. The selected SDK requires Node 22.13+ and Xcode 26.4+ according to the [Expo SDK reference](https://docs.expo.dev/versions/latest/). Authentication follows the [Better Auth Expo integration](https://better-auth.com/docs/integrations/expo), and route inference follows the [Hono RPC guide](https://hono.dev/docs/guides/rpc).

Recorded checks and remaining physical-device acceptance are in [mobile-online.md](../../docs/evidence/mobile-online.md).
