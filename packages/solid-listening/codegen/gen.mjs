// AUTHORED-BY Claude Opus 4.8
//
// Regenerate src/generated/ from the media-sector ontology + SHACL subset +
// composite codegen config, using the committed-dist @jeswr/federation-codegen
// generator (which runs the audited @jeswr/model-runtime interpreter). A test
// (src/generated.reproduce.test.ts) asserts the committed src/generated matches a
// fresh generation, so this script is the ONE place the model is produced:
//
//   npm run gen        # writes src/generated/
//
// then rebuild + commit dist (npm run build && git add src/generated dist).
//
// The generated model.js is a fixed-template shim over @jeswr/model-runtime (a
// sha-pinned git+https RUNTIME dependency — the same shape the bookmarks
// generated-reference uses; nothing is inlined). No hand-editing of the emitted
// artifacts — the sector + config are the source of truth.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitLockfile, generateModel } from "@jeswr/federation-codegen";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
// check:generated redirects the output to a temp dir (SOLID_LISTENING_GEN_OUT) to
// diff a fresh generation against the committed src/generated without touching it.
const outDir = process.env.SOLID_LISTENING_GEN_OUT ?? join(root, "src", "generated");

const input = {
  ontologyTtl: readFileSync(join(here, "media.ontology.ttl"), "utf8"),
  shapesTtl: readFileSync(join(here, "media.shapes.ttl"), "utf8"),
  config: JSON.parse(readFileSync(join(here, "codegen.config.json"), "utf8")),
};

const result = generateModel(input);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const [name, content] of Object.entries(result.artifacts)) {
  writeFileSync(join(outDir, name), content);
}
writeFileSync(join(outDir, "codegen.lock.json"), emitLockfile(input));

process.stdout.write(
  `gen — wrote ${Object.keys(result.artifacts).length + 1} file(s) to src/generated/\n` +
    `  admission: ${
      result.admission.ok
        ? `OK${
            result.admission.violations.length
              ? ` (${result.admission.violations.length} advisory warning(s))`
              : ""
          }`
        : `${result.admission.violations.filter((v) => v.severity === "error").length} error(s)`
    }\n` +
    `  entities: ${result.manifest.entities.map((e) => e.name).join(", ")}\n`,
);
