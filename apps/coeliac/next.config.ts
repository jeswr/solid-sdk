// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const SUITE_ROOT = path.resolve(APP_ROOT, "..", "..");

const suitePackages = [
  "@jeswr/app-session",
  "@jeswr/app-shell",
  "@jeswr/pod-auth",
  "@jeswr/solid-health-diary",
  "@jeswr/guarded-fetch",
  "@jeswr/fetch-rdf",
  "@jeswr/solid-offline",
];

const nextConfig: NextConfig = {
  // Keep production builds within this app's share of the workspace machine.
  experimental: { cpus: 2 },
  // The suite packages ship ESM `dist/` with `import`-only export conditions;
  // transpiling them lets Next's graphs consume them.
  transpilePackages: suitePackages,
  // Linked workspace packages resolve outside the app directory.
  turbopack: { root: SUITE_ROOT },
  // Kept for `next build --webpack` / tooling that still selects webpack.
  webpack: (config) => {
    // Our own relative imports use explicit `.js` extensions (NodeNext style);
    // map them to the `.ts`/`.tsx` source for webpack, falling back to real `.js`.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
