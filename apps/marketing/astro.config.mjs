import { defineConfig } from "astro/config"

export default defineConfig({
  output: "static",
  trailingSlash: "always",
  build: { format: "directory" },
  devToolbar: { enabled: false },
  // Keep Astro's cookie API version with its prerendered bundle in this workspace.
  vite: {
    environments: {
      prerender: { resolve: { noExternal: ["cookie"] } },
    },
  },
})
