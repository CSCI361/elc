# Web authentication evidence

Verified locally on 13 September 2026 against the Vite development server at
`http://localhost:5173`, the Cloudflare worker, Better Auth 1.7.4, and local D1.

The React application now has usable account flows in Kazakh, Russian, and
English. Better Auth owns the session cookie. The account view loads `/api/me`
before displaying private account details, so a valid authentication session
alone does not bypass application suspension checks.

| Page                    | Behavior                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `/`, `/auth/sign-in`    | Email/password sign-in and capability-aware Google sign-in                                         |
| `/auth/sign-up`         | Registration, password confirmation, and verification instructions                                 |
| `/auth/verify-email`    | Resend a verification email                                                                        |
| `/auth/verified`        | Verification result and the next sign-in or resend action                                          |
| `/auth/forgot-password` | Request a password reset without revealing account existence                                       |
| `/auth/reset-password`  | Consume a reset link and set a new password                                                        |
| `/account`              | Verified account details, language preference, reset email, other-session revocation, and sign-out |

Navigation uses ordinary same-origin links and document loads. Return paths
reject external URLs, protocol-relative URLs, backslashes, control characters,
API paths, and recursive authentication destinations. The reset token is captured
in memory and removed from the current history entry before React renders.
Subsequent links omit it. The page uses a strict-origin referrer policy.

The account and capabilities responses are validated with shared Zod contracts.
A saved account language takes precedence over a browser preference. Without a
saved account preference, the interface checks local storage and browser language,
then defaults to Kazakh. Changing the language while signed in saves it through
`PATCH /api/me/preferences`. Blocked browser storage does not prevent use of the
forms. Error text comes from known translated messages rather than raw provider
responses.

## Checks

- `vp test apps/web/src/auth`: 11 tests passed. These cover return-path safety,
  reset route isolation, secret removal, locale precedence and fallback, blocked
  storage, translation completeness, and safe error mapping.
- `vp exec tsc --noEmit -p apps/web/tsconfig.json`: passed.
- Scoped `vp lint` and `vp fmt --check` for the changed web files and locales:
  passed.
- `vp -C apps/web build`: passed for the web client and worker.

Browser verification used `vp dlx -- agent-browser` 0.37.1 with disposable local
fixtures. Verification and reset links were read from the private D1 development
mail table and passed directly to the browser. Diagnostics did not print the
links, passwords, session cookies, or message bodies. The fixture user, profile,
and mailbox messages were removed after verification.

| Browser check                       | Result                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| Mismatched passwords                | Focused error; no user created in D1                                                |
| Registration and unverified sign-in | Verification instructions; sign-in denied until verification                        |
| Resend and verification link        | Verification completed; sign-in opened the account page                             |
| Saved language precedence           | Russian saved in D1 and restored after a conflicting English browser preference     |
| Password reset                      | Token removed from the address bar; password changed; previous session returned 401 |
| Old and new passwords               | Old password rejected; new password accepted                                        |
| Unknown recovery email              | Same visible confirmation as an existing account                                    |
| Invalid reset token                 | Focused error and a new reset-link action; password fields removed                  |
| Revoke other sessions               | Other browser returned 401; current browser retained 200 access                     |
| Sign-out                            | Protected account details no longer displayed                                       |
| Suspended profile                   | `/api/me` returned 403; account details were hidden; sign-out remained available    |
| Missing Google configuration        | Button disabled with a translated availability message                              |
| Fresh browser runtime               | No uncaught page errors                                                             |

The interface was inspected at 1280px, 390px, and 320px widths. The narrow Kazakh
sign-in and Russian account layouts had no horizontal overflow. The 320px sign-in
page passed axe-core 4.12.1 with zero violations in light and dark themes. The
390px account page also had zero violations. The desktop sign-in audit had zero
violations and one contrast check that needed manual inspection because the
decorative orbit overlapped the text's bounding box. The text is unobscured and
has an 8.56:1 contrast ratio against its background.

Local screenshots are in the ignored `test-results/web-authentication/`
directory. During development, stale Vite dependency hashes caused pending
requests and then `504 Outdated Optimize Dep` responses. Restarting Vite after
moving its transient `.vite` cache resolved this; acceptance checks ran after a
cold load.

Google OAuth and Resend delivery require external configuration and were not
verified. The successful email flows above used the private local D1 mailbox.
