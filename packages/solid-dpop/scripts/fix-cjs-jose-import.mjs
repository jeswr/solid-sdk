/**
 * Post-build patch for the CJS bundle.
 *
 * jose@6 is ESM-only. The source loads it via a true dynamic `import("jose")` (valid from CJS on
 * every supported Node), but tsc compiling to `module: commonjs` down-levels that to
 * `Promise.resolve().then(() => __importStar(require("jose")))`. That `require()` of an ESM module
 * throws `ERR_REQUIRE_ESM` on Node releases where require(ESM) is off (e.g. Node 20.x < 20.19,
 * 22.x < 22.12). We rewrite that one call back into a real dynamic `import("jose")`, which works
 * everywhere. Idempotent; fails loudly if the expected pattern is not present (so a tsc emit change
 * cannot silently reintroduce the bug).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, "..", "dist", "cjs", "dpop.js");
const before = readFileSync(file, "utf8");

const pattern = 'Promise.resolve().then(() => __importStar(require("jose")))';
const replacement = 'import("jose")';

if (before.includes(replacement) && !before.includes(pattern)) {
  // Already patched (idempotent re-run).
  process.exit(0);
}
if (!before.includes(pattern)) {
  console.error(
    `fix-cjs-jose-import: expected pattern not found in ${file}; tsc emit may have changed.`,
  );
  process.exit(1);
}
writeFileSync(file, before.split(pattern).join(replacement));
