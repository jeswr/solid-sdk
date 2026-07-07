// AUTHORED-BY Claude Opus 4.8
//
// Regenerate the committed bookmarks example (examples/bookmark/generated/) from
// its ontology + SHACL profile + codegen config, using the BUILT generator
// (dist/). A test asserts the committed output matches a fresh generation, so this
// script is the one place the example is produced (run: `npm run build && npm run
// gen:example`, then commit examples/bookmark/generated/).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitLockfile, generateModel } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const exampleDir = join(here, "..", "examples", "bookmark");
const outDir = join(exampleDir, "generated");

const input = {
  ontologyTtl: readFileSync(join(exampleDir, "bookmark.ttl"), "utf8"),
  shapesTtl: readFileSync(join(exampleDir, "bookmark.shacl.ttl"), "utf8"),
  config: JSON.parse(readFileSync(join(exampleDir, "codegen.config.json"), "utf8")),
};

const result = generateModel(input);
mkdirSync(outDir, { recursive: true });
for (const [name, content] of Object.entries(result.artifacts)) {
  writeFileSync(join(outDir, name), content);
}
writeFileSync(join(outDir, "codegen.lock.json"), emitLockfile(input));

process.stdout.write(
  `gen:example — wrote ${Object.keys(result.artifacts).length + 1} file(s) to ${outDir}\n` +
    `  admission: ${result.admission.ok ? "OK" : `${result.admission.violations.length} violation(s)`}\n`,
);
