import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  schema: "./apps/api/src/db/schema.ts",
  out: "./apps/api/migrations",
})
