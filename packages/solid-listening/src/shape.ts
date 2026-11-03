// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Access to the shipped Turtle artifacts — the focused SHACL shape
 * (`listening.shacl.ttl`) and the machine-readable federation-extension proposal
 * candidates (`listening.proposals.ttl`).
 *
 * Both `.ttl` files live at the package root (the human- and tool-readable
 * artifacts a triplestore / `rdf-validate-shacl` consume directly). This module
 * reads them as strings so consumers can feed them into whatever RDF/SHACL engine
 * they already depend on. Reading the file rather than embedding a copy means the
 * string can never drift from the canonical `.ttl`.
 *
 * The relative path `../listening.shacl.ttl` resolves identically from the source
 * tree (`src/shape.ts`) and the built output (`dist/shape.js`), because both
 * `src/` and `dist/` sit one level below the package root next to the `.ttl`s. The
 * files are in the package `files` allow-list, so they are present after install.
 *
 * **Node-only** (`readFileSync` + `node:url`). Kept off the browser-safe root so a
 * browser bundle importing the model never drags in `node:fs`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Filesystem path to the focused scrobble SHACL shape (`listening.shacl.ttl`). */
export const LISTENING_SHAPE_PATH: string = fileURLToPath(
  new URL("../listening.shacl.ttl", import.meta.url),
);

/** Filesystem path to the federation-extension proposal candidates (`listening.proposals.ttl`). */
export const LISTENING_PROPOSALS_PATH: string = fileURLToPath(
  new URL("../listening.proposals.ttl", import.meta.url),
);

let cachedShape: string | undefined;
let cachedProposals: string | undefined;

/**
 * The focused `media:PlaybackEvent` scrobble SHACL shape, as a Turtle string.
 * Cached after the first read. Pass it (with the data graph) to a SHACL validator
 * — see `src/shape.test.ts` for the `rdf-validate-shacl` pattern.
 */
export function listeningShapeTtl(): string {
  if (cachedShape === undefined) cachedShape = readFileSync(LISTENING_SHAPE_PATH, "utf8");
  return cachedShape;
}

/**
 * The `fedcon:Proposal` CANDIDATES for the media-sector gaps this fork's real
 * scrobble data surfaced (completion fraction, source-service attribution,
 * loved/skipped, in-progress-vs-completed), as a Turtle string. Cached after the
 * first read. These are CANDIDATES — not yet POSTed to any registry; the sector
 * `.ttl` is never edited here. See `DECISIONS.md`.
 */
export function listeningProposalsTtl(): string {
  if (cachedProposals === undefined)
    cachedProposals = readFileSync(LISTENING_PROPOSALS_PATH, "utf8");
  return cachedProposals;
}
