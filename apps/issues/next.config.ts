import { readFileSync } from "node:fs";
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

/**
 * The build version attached to feedback diagnostics (the FeedbackButton's
 * `appVersion`). Resolved at build time, deploy-portable: an explicit
 * `NEXT_PUBLIC_APP_VERSION`, else a CI git SHA (Vercel / GitHub Actions), else
 * the package version. Baked into the client bundle as a NEXT_PUBLIC_ var so a
 * static export can read it with no runtime.
 */
function buildVersion(): string {
  const sha = (
    process.env.NEXT_PUBLIC_APP_VERSION ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GITHUB_SHA ??
    ""
  ).trim();
  if (sha) return sha.slice(0, 12);
  try {
    const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? `v${pkg.version}` : "dev";
  } catch {
    return "dev";
  }
}

const baseConfig: NextConfig = {
  // Bake the build version into the client bundle so the FeedbackButton can
  // attach it to issue diagnostics without a runtime lookup.
  env: { NEXT_PUBLIC_APP_VERSION: buildVersion() },
};

const nextConfig: NextConfig = staticExport
  ? {
      ...baseConfig,
      output: "export",
      // Caddy `file_server` serves `/foo` → `/foo/index.html`; trailing-slash
      // routing makes Next emit that directory layout so links resolve on disk.
      trailingSlash: true,
      // No Next.js image optimisation server in a static export.
      images: { unoptimized: true },
    }
  : baseConfig;

export default nextConfig;
