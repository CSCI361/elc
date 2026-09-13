# elc marketing

Static Astro landing pages for the academic release. Kazakh is the default at `/`, with Russian at `/ru/` and English at `/en/`. Content is in `src/content/copy.ts`; all pages use the same layout and locally bundled Roboto font.

The page explains the product workflow and marks it as a prototype in development. The ticket drawing is an illustration, not an admission credential. The site contains no checkout, account session, campaign resolution, or API implementation. Application links lead to the separate React application.

## Local development

Run from the repository root after `vp install`:

```sh
vp run --filter @elc/marketing dev
vp run --filter @elc/marketing typecheck
vp run --filter @elc/marketing build
```

The development server uses `http://127.0.0.1:4321`. By default, application links point to `http://localhost:5173`. Set `PUBLIC_APP_ORIGIN` to another origin when needed. Links carry `?lang=kk`, `?lang=ru`, or `?lang=en`; the React application owns applying that preference.

Astro 7.3.2 and `@astrojs/check` 0.9.10 are used here. Marketing pins TypeScript **6.0.3** because the Astro checker needs the TypeScript JavaScript compiler API and rejects the native TypeScript 7 compiler. This exception is scoped to this package; the rest of the repository can keep TypeScript 7.

The root `dev:marketing` script starts this application. Root `typecheck` includes the Astro check, and root `build` checks and builds both the React application and these static pages.

## Build compatibility

The workspace keeps the main application's `vite` dependency aliased to `@voidzero-dev/vite-plus-core`. A narrower `astro@7>vite: 8.0.13` override gives Astro its own declared Vite version. Without that exception, the installed Astro dependency graph resolved the generic alias override to the unrelated, obsolete `vite@0.3.1` package, which lacks the API Astro uses. Package tasks still run through Vite+.

Astro's static prerender bundle imports the cookie package. Leaving that import external resolved an older hoisted CommonJS cookie package from the generated output directory, rather than Astro's cookie 2 dependency. `astro.config.mjs` therefore bundles `cookie` only in Vite's `prerender` environment. A setting on the `ssr` environment does not cover that build. No cookie override or authentication dependency change is needed.

Recheck these scoped settings when upgrading Astro, Vite+ or pnpm. Validation for the selected versions includes a successful `vp install`, Astro diagnostics, all four static routes, and the main Vite+ web build.

## Static Workers deployment

`astro build` writes prerendered HTML, CSS and local font assets to `dist`. A Cloudflare adapter is unnecessary for this static output. The separate Wrangler configuration has three targets:

| Target    | Worker                  | Purpose                                                  |
| --------- | ----------------------- | -------------------------------------------------------- |
| Default   | `elc-marketing-local`   | Local static-asset preview; no public workers.dev route. |
| `preview` | `elc-marketing-preview` | Shared preview build.                                    |
| `demo`    | `elc-marketing-demo`    | Academic demonstration build.                            |

The Workers compatibility date is `2026-09-11`, which the repository's installed runtime accepts. The build uses no API, D1, R2 or authentication bindings.

Before a remote deployment, export `PUBLIC_APP_ORIGIN` as the corresponding React application's public HTTPS origin. Then run the appropriate package task:

```sh
vp run --filter @elc/marketing deploy:preview
vp run --filter @elc/marketing deploy:demo
```

Each deployment task first rebuilds with `PUBLIC_DEPLOYMENT_ENV` set to its target. Preview and demo builds reject a missing app origin, localhost, HTTP, embedded credentials, URL paths and query strings. Public environment variables are baked into the generated HTML; Wrangler runtime variables cannot change those links. Use `preview:worker` after a local build to inspect the static asset routing without deployment.

This configuration is ready for deployment but does not establish that a Worker has been provisioned or published. Root integration owns deployment and browser verification, including the three language links, application origin, narrow layouts, keyboard navigation and the custom 404 page.

## Analytics status

The shared consent controller keeps analytics off until the visitor explicitly allows it on this origin. Set `PUBLIC_GA4_MEASUREMENT_ID` only after configuring the separate marketing stream and privacy settings in [GA4 setup](../../docs/ga4-setup.md). Withdrawal disables collection and clears application-controlled analytics cookies. Local acceptance uses an intercepted tag; actual Google receipt and property configuration remain pending.

## References

- [Astro static output](https://docs.astro.build/en/reference/configuration-reference/#output)
- [Astro deployment to Cloudflare Workers](https://docs.astro.build/en/guides/deploy/cloudflare/)
- [Astro environment variables](https://docs.astro.build/en/guides/environment-variables/)
