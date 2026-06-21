// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Access to the canonical ontology + SHACL artifacts (`bookmark.ttl`,
 * `bookmark.shacl.ttl`).
 *
 * Both `.ttl` files live at the package root (the human- and tool-readable
 * artifacts a triplestore / `rdf-validate-shacl` consume directly). This module
 * reads them as strings so consumers can feed them into whatever RDF/SHACL engine
 * they already depend on (the suite uses `rdf-validate-shacl` over a
 * `@zazuko/env` dataset). Reading the file rather than embedding a copy means the
 * string can never drift from the canonical `.ttl`.
 *
 * The relative path `../bookmark.shacl.ttl` resolves identically from the source
 * tree (`src/shape.ts` → `bookmark.shacl.ttl`) and the built output
 * (`dist/shape.js` → `bookmark.shacl.ttl`), because both `src/` and `dist/` sit
 * one level below the package root next to the `.ttl` files. The files are in the
 * package `files` allow-list, so they are present after install.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Filesystem path to the canonical bookmark ontology (`bookmark.ttl`). */
export const BOOKMARK_ONTOLOGY_PATH: string = fileURLToPath(
  new URL("../bookmark.ttl", import.meta.url),
);

/** Filesystem path to the canonical bookmark SHACL shape (`bookmark.shacl.ttl`). */
export const BOOKMARK_SHAPE_PATH: string = fileURLToPath(
  new URL("../bookmark.shacl.ttl", import.meta.url),
);

let cachedOntology: string | undefined;
let cachedShape: string | undefined;

/**
 * The bookmark ontology (`book:Bookmark` class + the two minted predicates +
 * alignments), as a Turtle string. Cached after the first read.
 */
export function bookmarkOntologyTtl(): string {
  if (cachedOntology === undefined) {
    cachedOntology = readFileSync(BOOKMARK_ONTOLOGY_PATH, "utf8");
  }
  return cachedOntology;
}

/**
 * The canonical `book:Bookmark` SHACL shape, as a Turtle string. Cached after the
 * first read. Pass it (with the data graph) to a SHACL validator — see the
 * round-trip + shape fixture tests for the `rdf-validate-shacl` pattern.
 */
export function bookmarkShapeTtl(): string {
  if (cachedShape === undefined) cachedShape = readFileSync(BOOKMARK_SHAPE_PATH, "utf8");
  return cachedShape;
}
