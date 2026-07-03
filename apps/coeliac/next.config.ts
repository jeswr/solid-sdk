// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import path from "node:path";
import type { NextConfig } from "next";

const suitePackages = [
  "@jeswr/app-shell",
  "@jeswr/solid-elements",
  "@jeswr/solid-health-diary",
  "@jeswr/guarded-fetch",
  "@jeswr/solid-session-restore",
  "@jeswr/fetch-rdf",
  "solid-offline",
];

/** Absolute path to a file inside a node_modules package (symlink-followed). */
function pkgFile(rel: string): string {
  return path.join(process.cwd(), "node_modules", rel);
}

const nextConfig: NextConfig = {
  // The suite packages ship ESM `dist/` with `import`-only export conditions;
  // transpiling them lets Next's graphs consume them.
  transpilePackages: suitePackages,
  webpack: (config) => {
    // Our own relative imports use explicit `.js` extensions (NodeNext style);
    // map them to the `.ts`/`.tsx` source for webpack, falling back to real `.js`.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    // `@jeswr/solid-elements` subpaths declare only the ESM `import` export
    // condition, which the RSC/`next-dynamic` resolution layer does not match —
    // alias them straight to their built files so every graph resolves them.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@jeswr/solid-elements/react": pkgFile("@jeswr/solid-elements/dist/react/index.js"),
      "@jeswr/solid-elements/auth": pkgFile("@jeswr/solid-elements/dist/auth/index.js"),
      "@jeswr/solid-elements$": pkgFile("@jeswr/solid-elements/dist/index.js"),
    };
    return config;
  },
};

export default nextConfig;
