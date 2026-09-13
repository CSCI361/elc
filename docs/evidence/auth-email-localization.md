# Authentication email localization

Implemented on 2026-09-13 in `apps/api/src/auth/email.ts`, `locale.ts` and the callbacks in `index.ts`. Verification and password reset messages support Kazakh, Russian and English. Each message retains its canonical authentication link, one-hour expiry notice, unsolicited-request guidance and academic demonstration label.

## Locale selection and callback identity

`verificationEmail(to, url, locale = 'kk')` and `resetPasswordEmail(to, url, locale = 'kk')` return the existing `AuthEmail` shape. Subjects contain only static translated text. The canonical URL appears unchanged on its own line in the plain-text body. English text remains compatible with the previous templates.

`loadAuthEmailLocale(db, userId, acceptLanguage?)` reads `profiles.locale` using a bound callback account ID. Both Better Auth callbacks pass their own `user.id`, `user.email`, `url` and the second callback argument's `Accept-Language` header. They do not take account identity or a saved locale from the request body or the signed-in actor. The database lookup runs for every send, so a changed saved preference applies to subsequent verification resends and reset requests. A failed lookup stops delivery with a fixed application error; it does not silently substitute a conflicting header preference or expose a database error.

The installed Better Auth 1.7.4 source and types were checked locally. `@better-auth/core/dist/types/init-options.d.mts` declares an optional `Request` as argument two for both callbacks. `better-auth/dist/api/routes/sign-up.mjs` passes a cloned request to verification delivery; `email-verification.mjs` and `password.mjs` pass the endpoint request. Their callback user objects come from the created or resolved account. No SDK modification or dependency change was needed.

`authEmailLocale(savedLocale, acceptLanguage?)` chooses a supported saved locale first. Without one, it accepts `kk`, `ru` and `en` language ranges, including regional subtags, without case sensitivity. Valid quality weights choose the highest preference; equal weights preserve header order. Missing weights mean 1 and quality zero is excluded. Unsupported or malformed entries are skipped. A wildcard alone, no supported preference or no request falls back to Kazakh.

The parser bounds headers to 4096 characters and 32 entries. Control characters, oversized headers and excessive entry counts use the Kazakh fallback. Quality weights must be between 0 and 1 with at most three fractional digits. Extra parameters and invalid language-range syntax do not become preferences. Request preferences are never persisted as an explicit account setting.

## Delivery behavior and verification

`AuthDependencies` and `AuthEmailTransport` retain their existing interfaces. The private injected mailbox and existing Resend sender still receive the same email shape. The sender continues to derive its idempotency key from message kind, recipient and plain text. Provider configuration, timeouts, failure codes and the disabled Better Auth logger retain their existing behavior. The locale helper adds no diagnostics containing account identifiers, credentials or authentication links.

- `vp test run apps/api/src/auth/email.test.ts apps/api/src/auth/locale.test.ts`: 47 tests pass.
- `vp check apps/api/src/auth/email.ts apps/api/src/auth/index.ts apps/api/src/auth/locale.ts apps/api/src/auth/email.test.ts apps/api/src/auth/locale.test.ts apps/api/src/auth/email-localization.integration.test.ts`: formatting, lint and type checks pass.
- `vp exec tsc --noEmit -p apps/api/tsconfig.json`: API TypeScript passes.
- `vp test run apps/api/src/auth/email-localization.integration.test.ts --maxWorkers 1`: nine tests pass on a migrated local D1 database with actual Better Auth callbacks and a private mailbox.

The pure tests cover translated subjects/body notices, exact link preservation, default locale, header bounds, regional subtags, quality ordering, invalid weights and saved-locale priority. They also verify a fresh bound database lookup and safe lookup failure. The callback cases cover signup and reset header preferences, all saved locales, preference changes, one-hour verification/reset token lifetimes, a reset recipient distinct from the signed-in actor, normalized recipient email and generic unknown-account recovery. Every transport is injected. No external email was sent.

Durable auth email jobs, deployment sender verification and actual external receipt remain separate work. This change does not create schema, environment or delivery-job configuration.
