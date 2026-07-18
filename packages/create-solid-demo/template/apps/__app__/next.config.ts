import type { NextConfig } from "next";

/**
 * Zone app: served under the shell's rewrite prefix, so the basePath matches the
 * registry `path` for this app in apps/tour/content/walkthrough.json.
 */
const nextConfig: NextConfig = {
  basePath: "/__CSD_APP_SLUG__",
};

export default nextConfig;
