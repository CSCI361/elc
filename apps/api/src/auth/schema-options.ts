import { expo } from "@better-auth/expo"
import type { BetterAuthOptions } from "better-auth"

/** Shared by the runtime and CLI so plugins and database tables cannot drift. */
export const authSchemaOptions = {
  plugins: [expo()],
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 60, max: 5 },
      "/send-verification-email": { window: 60, max: 5 },
    },
  },
} satisfies BetterAuthOptions
