import type { DatasetCore, Quad } from "@rdfjs/types";
import type { OdrlPolicy } from "./types.js";
import { IRI_TO_ACTION, IRI_TO_LEFT_OPERAND, IRI_TO_OPERATOR } from "./vocab.js";
/**
 * Lower a structured {@link OdrlPolicy} to RDF quads (an `odrl:Policy` graph)
 * through the typed wrapper write path.
 */
export declare function policyToRdf(policy: OdrlPolicy): Quad[];
/** Serialise a policy to Turtle (default) or another n3 format. */
export declare function policyToTurtle(policy: OdrlPolicy, format?: string): Promise<string>;
/**
 * Build the JSON-LD document for a policy: a deterministic projection of the SAME
 * policy (kept in lock-step with the RDF quads) with the pinned inline `@context`.
 * A consumer parses it via `@jeswr/fetch-rdf` (which handles `application/ld+json`)
 * — see {@link parsePolicy}.
 */
export declare function policyToJsonLd(policy: OdrlPolicy): Record<string, unknown>;
/**
 * Read a structured {@link OdrlPolicy} back from an already-parsed RDF dataset.
 * Returns the FIRST well-formed policy found, or `undefined` if there is none.
 */
export declare function policyFromRdf(dataset: DatasetCore): OdrlPolicy | undefined;
/**
 * Parse a policy from a Turtle/JSON-LD string (or an already-parsed dataset).
 * Convenience over {@link policyFromRdf} that does the parse via `@jeswr/fetch-rdf`
 * (the sanctioned parser — never a bespoke one).
 */
export declare function parsePolicy(input: string | DatasetCore, contentType?: string, baseIRI?: string): Promise<OdrlPolicy | undefined>;
export { IRI_TO_ACTION, IRI_TO_LEFT_OPERAND, IRI_TO_OPERATOR };
//# sourceMappingURL=policy.d.ts.map