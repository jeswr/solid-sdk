import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWalkthrough } from "@jeswr/solid-showcase";
import { zoneRewrites } from "@jeswr/solid-showcase/next";
import type { NextConfig } from "next";

/**
 * The multi-zone rewrite table derives from the SAME walkthrough document that renders
 * the site — no duplicated zone list. Zone URLs are read from env at BUILD time
 * (unset ⇒ an unresolvable `.invalid` fallback: honest "not deployed", never a real
 * route). Read via fs (not an import) because next.config is bundled standalone.
 */
const walkthrough = parseWalkthrough(
  JSON.parse(readFileSync(join(process.cwd(), "content", "walkthrough.json"), "utf8")),
);

const nextConfig: NextConfig = {
  rewrites: () => zoneRewrites(walkthrough),
};

export default nextConfig;
