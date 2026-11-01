// AUTHORED-BY Codex GPT-6.1-Sol
import type { NextConfig } from "next";

if (
  process.env.NEXT_PUBLIC_DEV_FIXTURES === "1" &&
  // `vercel build` sets VERCEL=1; the Pages deploy runs in the "pages" workflow.
  (process.env.VERCEL === "1" || process.env.GITHUB_WORKFLOW === "pages")
)
  throw new Error("Demo fixtures must be disabled for deployment builds");

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
