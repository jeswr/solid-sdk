// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// check:manifest — drift guard for the committed Custom Elements Manifest.
// `custom-elements.json` is COMMITTED (like `dist/`) so LLM codegen tooling can
// read the element ↔ RDF-class binding straight from a GitHub install with no
// build step. This guards against the committed manifest drifting from `src/`: it
// regenerates the manifest and fails if the committed file differs.
//
// Mirrors `check:dist`'s contract: deterministic, pure-Node comparison, no external
// `diff`, and NON-DESTRUCTIVE — if a difference is found, the committed bytes are
// restored so the working tree is left exactly as it was (the gate reports drift;
// the fix is `npm run manifest && git add custom-elements.json`).
//
// WHY regenerate to the repo root (not a temp dir like check:dist): the analyzer
// always joins `outdir` to cwd (cli.js `path.join(cwd, outdir)`), so it cannot be
// pointed at an arbitrary absolute temp path. We therefore snapshot the committed
// bytes, regenerate IN PLACE, compare, and restore on mismatch — so a drift run
// never leaves the committed file changed.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const manifestPath = join(root, "custom-elements.json");
const require = createRequire(import.meta.url);
// The analyzer's executable entry (`cem.js` — the package's bin, which CALLS the
// `cli()` exported by `cli.js`; importing `cli.js` directly would NOT run it).
// Resolved from the installed dependency + launched via this Node binary (no
// `npx`/shell), like check:dist.
const cemBin = require.resolve("@custom-elements-manifest/analyzer/cem.js");

if (!existsSync(manifestPath)) {
  console.error("\n[check:manifest] FAIL — custom-elements.json is missing.");
  console.error("Run `npm run manifest` and commit the result.\n");
  process.exit(1);
}

// 1) Snapshot the committed bytes so we can restore them on mismatch.
const committed = readFileSync(manifestPath);

// 2) Regenerate in place (analyzer writes custom-elements.json at the repo root,
//    per the config's `outdir: ""`). argv array, no shell.
execFileSync(process.execPath, [cemBin, "analyze", "--quiet"], {
  cwd: root,
  stdio: "inherit",
  shell: false,
});

// 3) Compare. On mismatch, RESTORE the committed bytes (non-destructive) and fail.
const fresh = readFileSync(manifestPath);
if (!committed.equals(fresh)) {
  writeFileSync(manifestPath, committed);
  console.error(
    "\n[check:manifest] FAIL — committed custom-elements.json differs from a fresh run.",
  );
  console.error("Run `npm run manifest` and commit the updated custom-elements.json.\n");
  process.exit(1);
}

console.log("[check:manifest] OK — committed custom-elements.json matches a fresh run.");
