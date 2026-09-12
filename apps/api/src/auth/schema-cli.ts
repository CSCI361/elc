import { betterAuth } from "better-auth"
import { authSchemaOptions } from "./schema-options"

// Schema-only configuration. Never import this instance into the Worker.
// The CLI's --adapter drizzle --dialect sqlite generates without a D1 binding.
export const auth = betterAuth(authSchemaOptions)
