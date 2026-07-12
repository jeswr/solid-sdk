// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Access to the canonical SHACL shape (`drawing.shacl.ttl`) and the ontology TTL
 * (`drawing.ttl`).
 *
 * Both `.ttl` files live at the package root (the human- and tool-readable
 * artifacts a SHACL engine / triplestore consumes directly). This module reads
 * them as strings so consumers can feed them into whatever SHACL engine they
 * already depend on (the suite uses `rdf-validate-shacl` over a `@zazuko/env`
 * dataset). Reading the file rather than embedding a copy means the string can
 * never drift from the canonical `.ttl`.
 *
 * The relative path `../drawing.shacl.ttl` resolves identically from the source
 * tree (`src/shape.ts` → `drawing.shacl.ttl`) and the built output
 * (`dist/shape.js` → `drawing.shacl.ttl`), because both `src/` and `dist/` sit
 * one level below the package root next to the `.ttl` files. The `.ttl` files are
 * shipped in the package `files` allow-list, so they are present after install.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Filesystem path to the canonical `draw:Scene` SHACL shape file. */
export const DRAWING_SHAPE_PATH: string = fileURLToPath(
  new URL("../drawing.shacl.ttl", import.meta.url),
);

/** Filesystem path to the drawing ontology TTL. */
export const DRAWING_ONTOLOGY_PATH: string = fileURLToPath(
  new URL("../drawing.ttl", import.meta.url),
);

let cachedShape: string | undefined;
let cachedOntology: string | undefined;

/**
 * The canonical `draw:Scene` SHACL shape, as a Turtle string. Cached after the
 * first read. Pass it (with the data graph) to a SHACL validator — see the
 * round-trip + shape tests for the `rdf-validate-shacl` pattern.
 */
export function drawingShapeTtl(): string {
  if (cachedShape === undefined) cachedShape = readFileSync(DRAWING_SHAPE_PATH, "utf8");
  return cachedShape;
}

/** The drawing ontology, as a Turtle string. Cached after the first read. */
export function drawingOntologyTtl(): string {
  if (cachedOntology === undefined) cachedOntology = readFileSync(DRAWING_ONTOLOGY_PATH, "utf8");
  return cachedOntology;
}
