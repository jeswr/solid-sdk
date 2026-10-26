// Copy the dashboard's static assets (an explicit allowlist) next to the compiled server:
//   src/dashboard/public/<file> -> <outDir>/dashboard/public/<file>
// Used by `npm run build` (outDir = dist) and by check:dist (outDir = a temp build).
// Usage: node scripts/copy-dashboard-assets.mjs <outDir>
import { copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DASHBOARD_ASSETS = ["index.html", "app.css", "app.js", "icon.svg"];

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: node scripts/copy-dashboard-assets.mjs <outDir>");
  process.exit(2);
}
const target = join(resolve(outDir), "dashboard", "public");
mkdirSync(target, { recursive: true });
for (const file of DASHBOARD_ASSETS)
  copyFileSync(join(root, "src", "dashboard", "public", file), join(target, file));
