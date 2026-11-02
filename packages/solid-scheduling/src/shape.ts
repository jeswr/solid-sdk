// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Access to the shipped Turtle artifacts — the focused SHACL shape
 * (`scheduling.shacl.ttl`) and the machine-readable federation-extension proposal
 * candidates (`scheduling.proposals.ttl`).
 *
 * Both `.ttl` files live at the package root (the human- and tool-readable
 * artifacts a triplestore / `rdf-validate-shacl` consume directly). This module
 * reads them as strings so consumers can feed them into whatever RDF/SHACL engine
 * they already depend on. Reading the file rather than embedding a copy means the
 * string can never drift from the canonical `.ttl`.
 *
 * The relative path `../scheduling.shacl.ttl` resolves identically from the source
 * tree (`src/shape.ts`) and the built output (`dist/shape.js`), because both
 * `src/` and `dist/` sit one level below the package root next to the `.ttl`s. The
 * files are in the package `files` allow-list, so they are present after install.
 *
 * **Node-only** (`readFileSync` + `node:url`). Kept off the browser-safe root so a
 * browser bundle importing the model never drags in `node:fs`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Filesystem path to the focused scheduling SHACL shape (`scheduling.shacl.ttl`). */
export const SCHEDULING_SHAPE_PATH: string = fileURLToPath(
  new URL("../scheduling.shacl.ttl", import.meta.url),
);

/** Filesystem path to the federation-extension proposal candidates (`scheduling.proposals.ttl`). */
export const SCHEDULING_PROPOSALS_PATH: string = fileURLToPath(
  new URL("../scheduling.proposals.ttl", import.meta.url),
);

let cachedShape: string | undefined;
let cachedProposals: string | undefined;

/**
 * The focused `sched:Task` / `sched:Calendar` scheduling SHACL shape, as a Turtle
 * string. Cached after the first read. Pass it (with the data graph) to a SHACL
 * validator — see `src/shape.test.ts` for the `rdf-validate-shacl` pattern.
 */
export function schedulingShapeTtl(): string {
  if (cachedShape === undefined) cachedShape = readFileSync(SCHEDULING_SHAPE_PATH, "utf8");
  return cachedShape;
}

/**
 * The `fedcon:Proposal` CANDIDATES for the scheduling-sector gaps this fork's real
 * task data surfaced (kanban bucket/board position, first-class labels,
 * task-relations, percent-done, and the CalendarEvent↔dav-bridge reconciliation),
 * as a Turtle string. Cached after the first read. These are CANDIDATES — not yet
 * POSTed to any registry; the sector `.ttl` is never edited here. See
 * `DECISIONS.md`.
 */
export function schedulingProposalsTtl(): string {
  if (cachedProposals === undefined)
    cachedProposals = readFileSync(SCHEDULING_PROPOSALS_PATH, "utf8");
  return cachedProposals;
}
