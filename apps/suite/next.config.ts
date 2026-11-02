// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex
import { resolve } from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@jeswr/suite-ui"],
  devIndicators: false,
  // Yjs must be a singleton across the app, TipTap, IndexedDB and the workspace provider.
  webpack(config) {
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
