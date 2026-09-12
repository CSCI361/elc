import { fileURLToPath } from "node:url"
import { cloudflare } from "@cloudflare/vite-plugin"
import babel from "@rolldown/plugin-babel"
import tailwindcss from "@tailwindcss/vite"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { defineConfig } from "vite-plus"

export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    cloudflare({
      configPath: fileURLToPath(
        new URL("../api/wrangler.jsonc", import.meta.url)
      ),
      persistState: {
        path: fileURLToPath(new URL("../../.wrangler/state", import.meta.url)),
      },
    }),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
})
