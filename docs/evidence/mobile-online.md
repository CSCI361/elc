# Mobile online scanner evidence

Recorded on 2026-09-13 against the local workspace after backend checkpoint `6a39a5e`. This records the Expo online-scanner unit, not physical-device or native offline acceptance.

## Implemented

- Expo 57.0.22 / React Native 0.86.3 shell for iOS 16.4+ and Android 10+, with independent local, preview and demo configuration.
- Better Auth Expo server/client plugins, SecureStore session storage, and Hono typed application requests with current-cookie forwarding. Backend code is imported only as a type.
- Shared Kazakh, Russian and English strings, ordered device-locale fallback, and saved account preference.
- Assigned-event list, current event counts, camera QR parsing, confirmed online check-in, event-scoped attendee search, and separately authorized correction with a reason.
- Memory-only admission credentials, account-bound UI lifetime, a synchronous capture lock, bounded requests, explicit stable-ID retry after uncertainty, and no automatic admission retries.

## Automated checks

`vp test run apps/mobile/src/model.test.ts apps/mobile/src/api-client.test.ts` passed 13 tests. They cover campaign/extended-payload rejection, matching server confirmation, expiry and permission boundaries, same-body retry after a lost response, abort before sending, uncertain HTTP/JSON outcomes, typed route/query/body construction, current cookies, origin confinement, and locale fallback.

`vp test run apps/api/src/offline/scanner.integration.test.ts apps/api/src/auth/auth.integration.test.ts` passed 14 tests. The new scanner file contributes nine tests using actual Miniflare D1. It proves explicit assignments, owner/reversal non-escalation, bounded and scoped cursors, literal name search, canonical counts after admission/reversal/admission blocking, cancellation/suspension display, and denial when grant, account suspension, or verification changes before the authorized attendee read. The existing five web-auth tests remain green after adding the Expo plugin.

`vp test run apps/api/src/auth/expo.integration.test.ts` passed two D1 tests. A native `expo-origin: elc://` signup requires verification, then obtains a cookie session that sign-out revokes. Untrusted native origins are denied, and `expo-origin` cannot override an existing untrusted browser `Origin`. These tests use an in-memory test mailbox and make no external email or Google request.

The scoped `vp check` and `vp exec tsc -p apps/mobile/tsconfig.json --noEmit` passed. `CI=1 vp exec expo install --check`, run in `apps/mobile`, reported that dependencies are up to date. A public-config check confirmed both native platforms, the OS targets, local API origin, and absence of a private JWK field.

`vp run --filter @elc/mobile bundle` exported both Hermes bundles through Metro after the Hono/localization integration: iOS 812 modules and Android 810 modules, approximately 2.6 MB each. Expo reported only the Node TypeScript-stripping and terminal color warnings. This proves bundling, not a native install or working camera.

## Acceptance still required

The host has only the Xcode command-line tools. `xcodebuild -version` requires a full Xcode installation, and `xcrun --find simctl` reports that the simulator tool is unavailable. `adb` is not on PATH. Java is installed as OpenJDK 21.0.12.1. No native application build, simulator run, camera scan, grayscale print scan, or physical-device session test is claimed.

Complete the architecture's acceptance on at least one physical iPhone and one physical Android phone, recording models, OS versions and build IDs. Include camera permissions and denial, valid/duplicate/wrong-event/cancelled/refunded tickets, lost-response retry, attendee search, correction permissions, logout/account changes, localization, accessibility and readable grayscale ticket prints. Run the minimum OS checks where compatible tools are available.

Google still needs an actual configured external sign-in and callback test. The two-second scan target still needs the specified deployed dataset and concurrent workload. The encrypted SQLite snapshot/journal, native signature verification, local undo, minute refresh, restart/replay, expiry cleanup, account-switch purge and lost-device workflows belong to the next native offline unit. Backend offline tests are recorded separately in [offline-backend.md](offline-backend.md).
