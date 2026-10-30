// AUTHORED-BY Codex GPT-6.1-Sol
import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@jeswr/suite-ui"],
  devIndicators: false,
  webpack(config) {
    // Imported model files use Node-style .js specifiers for their TypeScript sources.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};
export default config;
