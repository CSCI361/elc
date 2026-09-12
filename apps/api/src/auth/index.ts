import { drizzleAdapter } from "@better-auth/drizzle-adapter"
import { betterAuth } from "better-auth"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { drizzle } from "drizzle-orm/d1"
import * as schema from "../db/auth-schema"
import type { Bindings } from "../env"
import {
  createEmailSender,
  hasEmailTransport,
  resetPasswordEmail,
  verificationEmail,
  type AuthDependencies,
} from "./email"
import { authSchemaOptions } from "./schema-options"

export type { AuthDependencies, AuthEmail, AuthEmailTransport } from "./email"

type AuthConfig = Pick<
  Bindings,
  | "APP_ORIGIN"
  | "AUTH_SECRET"
  | "DB"
  | "EMAIL_FROM"
  | "ENVIRONMENT"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "RESEND_API_KEY"
> & { AUTH_URL?: string }

export function getAuthCapabilities(
  env: AuthConfig,
  dependencies: AuthDependencies = {}
) {
  return {
    emailAndPassword: true,
    emailDelivery: hasEmailTransport(env, dependencies),
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  }
}

export function createAuth(
  env: AuthConfig,
  dependencies: AuthDependencies = {}
) {
  const capabilities = getAuthCapabilities(env, dependencies)
  const sendEmail = createEmailSender(env, dependencies)
  const baseURL = env.AUTH_URL ?? env.APP_ORIGIN
  const secure = new URL(baseURL).protocol === "https:"

  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32)
    throw new Error("AUTH_SECRET must contain at least 32 characters.")
  if (env.ENVIRONMENT !== "local" && !secure)
    throw new Error("Authentication requires HTTPS.")

  return betterAuth({
    ...authSchemaOptions,
    appName: "elc",
    baseURL,
    basePath: "/api/auth",
    secret: env.AUTH_SECRET,
    database: drizzleAdapter(drizzle(env.DB, { schema }), {
      provider: "sqlite",
      schema,
      // D1 does not support interactive BEGIN/COMMIT transactions.
      transaction: false,
    }),
    trustedOrigins: [
      env.APP_ORIGIN,
      "elc://",
      ...(env.ENVIRONMENT === "local" ? ["exp://"] : []),
    ],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: false,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) =>
        sendEmail(resetPasswordEmail(user.email, url)),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) =>
        sendEmail(verificationEmail(user.email, url)),
    },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {},
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // Each protected request reads D1 so revocation takes effect immediately.
      cookieCache: { enabled: false },
    },
    account: {
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
      cookiePrefix: "elc",
      useSecureCookies: secure,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure },
    },
    // Error handling at the API boundary reports safe codes with correlation IDs.
    logger: { disabled: true },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (
          !capabilities.emailDelivery &&
          [
            "/sign-up/email",
            "/request-password-reset",
            "/send-verification-email",
          ].includes(context.path)
        ) {
          throw new APIError("SERVICE_UNAVAILABLE", {
            code: "EMAIL_UNAVAILABLE",
            message:
              "Email delivery is not configured. Registration and password recovery are unavailable.",
          })
        }
        if (
          context.path === "/sign-in/social" &&
          context.body?.provider === "google" &&
          !capabilities.google
        ) {
          throw new APIError("SERVICE_UNAVAILABLE", {
            code: "GOOGLE_UNAVAILABLE",
            message: "Google sign-in is not configured.",
          })
        }
      }),
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
export type AuthSession = Auth["$Infer"]["Session"]
