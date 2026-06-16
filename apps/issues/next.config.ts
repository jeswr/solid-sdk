import type { NextConfig } from "next";

// Static-export deploy (Caddy `file_server` on a subdomain) vs. the default
// server build (Vercel / `next start`, used by the e2e harness).
//
// When `APP_STATIC_EXPORT=1` the build emits a fully static site to `out/`
// (`output: "export"`) — plain HTML + assets + a pre-rendered `clientid.jsonld`,
// servable by any static file server with no Node runtime. The deploy origin is
// baked in at build time via `APP_ORIGIN` (see `src/app/clientid.jsonld/route.ts`
// and `src/lib/app-origin.ts`), since a static file cannot read the request URL.
//
// Without that flag the config is the standard Next.js server build, so
// `next build && next start` (the Playwright e2e webServer) keeps working —
// `output: "export"` is INCOMPATIBLE with `next start`, so it must stay opt-in.
const staticExport = process.env.APP_STATIC_EXPORT === "1";

const nextConfig: NextConfig = staticExport
  ? {
      output: "export",
      // Caddy `file_server` serves `/foo` → `/foo/index.html`; trailing-slash
      // routing makes Next emit that directory layout so links resolve on disk.
      trailingSlash: true,
      // No Next.js image optimisation server in a static export.
      images: { unoptimized: true },
    }
  : {};

export default nextConfig;
