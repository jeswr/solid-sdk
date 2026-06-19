import type { DatasetCore, Quad } from "@rdfjs/types";
import type { Intent } from "./types.js";
/**
 * Lower a structured {@link Intent} to RDF quads (an `a2a:Intent` graph) through
 * the typed wrapper write path.
 */
export declare function intentToRdf(intent: Intent): Quad[];
/** Serialise an intent to Turtle (default) or another n3 format. */
export declare function intentToTurtle(intent: Intent, format?: string): Promise<string>;
/**
 * Build the JSON-LD document for an intent. A deterministic projection of the
 * SAME Intent (so it stays in lock-step with the RDF quads) with the pinned inline
 * `@context` — NOT a re-serialisation through a JSON-LD library (we own the exact
 * shape). A consumer parses it via `@jeswr/fetch-rdf` (which handles
 * `application/ld+json`) — see {@link parseIntentGraph}.
 */
export declare function intentToJsonLd(intent: Intent): Record<string, unknown>;
/**
 * Read a structured {@link Intent} back from an already-parsed RDF dataset (the
 * round-trip read). Returns the FIRST well-formed `a2a:Intent` found, or
 * `undefined` if there is none / it lacks a recognised action.
 */
export declare function intentFromRdf(dataset: DatasetCore): Intent | undefined;
/**
 * Parse an intent from a Turtle/JSON-LD string (or an already-parsed dataset).
 * Convenience over {@link intentFromRdf} that does the parse via `@jeswr/fetch-rdf`
 * (the sanctioned parser — never a bespoke one).
 *
 * @param input - Turtle/JSON-LD text, or a parsed `DatasetCore`.
 * @param contentType - media type when `input` is text (default `text/turtle`).
 * @param baseIRI - base IRI for relative IRIs when parsing text.
 */
export declare function parseIntentGraph(input: string | DatasetCore, contentType?: string, baseIRI?: string): Promise<Intent | undefined>;
//# sourceMappingURL=intent.d.ts.map