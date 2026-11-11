// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex
import { resolve } from "node:path";
import type { NextConfig } from "next";

if (
  process.env.NEXT_PUBLIC_DEV_FIXTURES === "1" &&
  // `vercel build` sets VERCEL=1; the Pages deploy runs in the "pages" workflow.
  (process.env.VERCEL === "1" || process.env.GITHUB_WORKFLOW === "pages")
)
  throw new Error("Demo fixtures must be disabled for deployment builds");

const config: NextConfig = {
  // The live OIDC harness needs next dev for HTTP loopback. Keep its warmed route
  // entries alive so eviction/recompilation cannot Fast Refresh the opener mid-login.
  ...(process.env.SUITE_E2E === "1" && process.env.NODE_ENV === "development"
    ? { onDemandEntries: { maxInactiveAge: 30 * 60_000, pagesBufferLength: 8 } }
    : {}),
  ...(process.env.NEXT_PUBLIC_SUITE_TARGET === "native"
    ? ({ output: "export", trailingSlash: true, images: { unoptimized: true } } as const)
    : {
        // DriveApp's client session gate defers its page's RSC redirect. Replaying
        // that redirect can replace a later search navigation; redirect before render.
        async redirects() {
          return [{ source: "/drive", destination: "/drive/my", permanent: false }];
        },
      }),
  transpilePackages: ["@jeswr/suite-ui"],
  devIndicators: false,
  // Yjs must be a singleton across the app, TipTap, IndexedDB and the workspace provider.
  webpack(config, { isServer, webpack }) {
    // rdf-engine's lazy WASM loader includes a Node-only disk fallback. Browser
    // initialization uses its emitted WASM URL and never enters that branch.
    if (!isServer)
      config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^node:fs\/promises$/ }));
    // Imported model files use Node-style .js specifiers for their TypeScript sources.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    config.resolve.alias = {
      ...config.resolve.alias,
      yjs: resolve(process.cwd(), "node_modules/yjs"),
    };
    return config;
  },
};
export default config;
