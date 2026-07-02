// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// write-cjs-marker.mjs — drop a `{"type":"commonjs"}` package.json into the CJS
// output dir so Node treats its `.js` files as CommonJS even though the package
// root is `"type":"module"`. Run after the CJS tsc build.
//
// Usage: node scripts/write-cjs-marker.mjs <dir>   (default: dist/cjs)

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "dist/cjs";
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "package.json"), `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);
