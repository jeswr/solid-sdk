// AUTHORED-BY Claude Opus 4.8
//
// check:generated — drift guard for the GENERATED model. src/generated/ is
// committed (so it ships in dist), which means it can silently drift from the
// codegen inputs (the media-sector ontology + SHACL subset + composite config).
// This regenerates into a temp dir with the pinned @jeswr/federation-codegen and
// diffs it against committed src/generated — a mismatch fails the gate, forcing a
// `npm run gen` + commit. Never hand-edit the generated files; edit the inputs.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const committed = join(root, "src", "generated");

const tmp = mkdtempSync(join(tmpdir(), "slis-gen-"));
try {
  // Regenerate into the temp dir by pointing the gen script's output there.
  execFileSync("node", [join(root, "codegen", "gen.mjs")], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, SOLID_LISTENING_GEN_OUT: tmp },
  });

  const list = (d) => readdirSync(d).sort();
  const committedFiles = list(committed);
  const freshFiles = list(tmp);

  const errors = [];
  const missing = freshFiles.filter((f) => !committedFiles.includes(f));
  const extra = committedFiles.filter((f) => !freshFiles.includes(f));
  if (missing.length) errors.push(`src/generated/ is MISSING regenerated file(s): ${missing.join(", ")}`);
  if (extra.length) errors.push(`src/generated/ has STALE file(s) not produced by gen: ${extra.join(", ")}`);
  for (const f of freshFiles) {
    if (!committedFiles.includes(f)) continue;
    if (readFileSync(join(committed, f), "utf8") !== readFileSync(join(tmp, f), "utf8")) {
      errors.push(`src/generated/${f} differs from a fresh generation (run \`npm run gen\`).`);
    }
  }

  if (errors.length) {
    console.error("check:generated FAILED — committed src/generated/ is out of sync with codegen/ inputs:");
    for (const e of errors) console.error(`  - ${e}`);
    console.error("Fix: `npm run gen` then `git add src/generated dist`.");
    process.exit(1);
  }
  console.log("check:generated OK — committed src/generated/ matches a fresh generation.");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
