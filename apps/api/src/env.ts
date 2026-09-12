export interface Bindings {
  DB: D1Database
  FILES: R2Bucket
  BACKUPS: R2Bucket
  DELIVERY: Queue<{ id: string }>
  SUPPORT: DurableObjectNamespace
  ASSETS: Fetcher
  ENVIRONMENT: "local" | "preview" | "demo"
  APP_ORIGIN: string
  AUTH_URL?: string
  AUTH_SECRET: string
  TICKET_ENCRYPTION_KEY?: string
  EMAIL_FROM: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  RESEND_API_KEY?: string
  POLAR_ACCESS_TOKEN?: string
  POLAR_WEBHOOK_SECRET?: string
}
