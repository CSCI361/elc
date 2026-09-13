/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_APP_ORIGIN?: string
  readonly PUBLIC_GA4_MEASUREMENT_ID?: string
  readonly PUBLIC_DEPLOYMENT_ENV?: "local" | "preview" | "demo"
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
