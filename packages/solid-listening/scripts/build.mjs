// AUTHORED-BY Claude Opus 4.8
//
// Build = compile the hand-written TS (facade + typed views + iri/acl/vocab/shape)
// with tsc, THEN copy the GENERATED artifacts (src/generated/*) into dist/generated/.
//
// The generated model.js is a fixed-template shim (plain JS with an inlined
// manifest) + model.d.ts its types — neither is TS source, so tsc does not emit
// them; they are copied verbatim so a `github:` consumer gets a self-contained
// committed dist under ignore-scripts=true (no build step). model.json / shapes.ttl
// / codegen-*.json ride along as the committed audit trail.
//
// Usage: node scripts/build.mjs [--out-dir <dir>]   (default dir: dist)
//   check-dist builds into a temp dir via --out-dir and diffs against committed dist.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const outIdx = argv.indexOf("--out-dir");
const outDir = outIdx >= 0 && argv[outIdx + 1] ? join(root, argv[outIdx + 1]) : join(root, "dist");

// 1. Compile the hand-written TypeScript.
execFileSync("npx", ["tsc", "-p", "tsconfig.build.json", "--outDir", outDir], {
  cwd: root,
  stdio: "inherit",
});

// 2. Copy the committed generated artifacts verbatim into <outDir>/generated.
const genSrc = join(root, "src", "generated");
const genOut = join(outDir, "generated");
mkdirSync(genOut, { recursive: true });
for (const name of readdirSync(genSrc)) {
  copyFileSync(join(genSrc, name), join(genOut, name));
}
