// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Access to the canonical SHACL shape (`shapes/task.ttl`).
 *
 * The shape lives in a single `.ttl` file at the package root (the human- and
 * tool-readable artifact `rdf-validate-shacl` consumes directly). This module
 * reads it as a string so consumers can feed it into whatever SHACL engine they
 * already depend on (the suite uses `rdf-validate-shacl` over a `@zazuko/env`
 * dataset). Reading the file rather than embedding a copy means the string can
 * never drift from the canonical `.ttl`.
 *
 * The relative path `../shapes/task.ttl` resolves identically from the source
 * tree (`src/shape.ts` → `shapes/task.ttl`) and the built output
 * (`dist/shape.js` → `shapes/task.ttl`), because both `src/` and `dist/` sit one
 * level below the package root next to `shapes/`. The `shapes/` directory is
 * shipped in the package `files` allow-list, so it is present after install.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Filesystem path to the canonical SHACL shape file. */
export const TASK_SHAPE_PATH: string = fileURLToPath(
  new URL("../shapes/task.ttl", import.meta.url),
);

let cached: string | undefined;

/**
 * The canonical federated-task SHACL shape, as a Turtle string. Cached after the
 * first read. Pass it (with the data graph) to a SHACL validator — see the
 * round-trip + cross-app fixture tests for the `rdf-validate-shacl` pattern.
 */
export function taskShapeTtl(): string {
  if (cached === undefined) cached = readFileSync(TASK_SHAPE_PATH, "utf8");
  return cached;
}
