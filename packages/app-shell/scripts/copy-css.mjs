// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Copy the CSS assets into dist/ after tsc emits the JS/d.ts. tsc does not copy
// non-TS files, so the token/theme/styles CSS are mirrored here. Stdlib-only
// (no extra build dep), in line with the suite's minimal-dependency rule.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const srcStyles = join(root, "src", "styles");
const distStyles = join(root, "dist", "styles");

mkdirSync(distStyles, { recursive: true });

for (const file of readdirSync(srcStyles)) {
  if (!file.endsWith(".css")) continue;
  copyFileSync(join(srcStyles, file), join(distStyles, file));
}

// Re-export the one-import stylesheet at the package's `styles.css` subpath
// (the `exports` map points "./styles.css" → "./dist/styles.css"). The combined
// styles.css `@import`s "./tokens.css" + "./theme.css" RELATIVE to its own
// location; copied to dist/styles.css (the package root), those would miss, so
// rewrite them to point at ./styles/*.css.
const rootStyles = join(root, "dist", "styles.css");
const rewritten = readFileSync(join(srcStyles, "styles.css"), "utf8")
  .replace('@import "./tokens.css";', '@import "./styles/tokens.css";')
  .replace('@import "./theme.css";', '@import "./styles/theme.css";');
writeFileSync(rootStyles, rewritten);

console.log("[copy-css] CSS assets copied to dist/");
