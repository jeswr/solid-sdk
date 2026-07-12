// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The single sanctioned n3.Writer RDF serialiser for the @jeswr suite.
//
// Consolidated from the five near-identical `src/serialize.ts` copies in
// @jeswr/solid-vc, @jeswr/solid-odrl, @jeswr/solid-a2a, @jeswr/federation-client
// and @jeswr/solid-agent-card. Each copy hard-coded a different prefix map and
// four of the five short-circuited an empty graph to `""`; here both are options
// so a single implementation reproduces every consumer's observable output.
//
// RDF is ALWAYS produced through `n3.Writer` — never hand-concatenated.
import { Writer } from "n3";
/**
 * The default RDF media type used when {@link SerializeOptions.format} is omitted.
 *
 * Matches the `format = "text/turtle"` default of every consolidated copy.
 */
export const DEFAULT_FORMAT = "text/turtle";
/**
 * Serialise RDF quads to a string with `n3.Writer` — the single sanctioned
 * serialiser for the `@jeswr` suite (RDF is never hand-concatenated).
 *
 * Defaults to Turtle with no prefixes and the empty-graph short-circuit enabled.
 * Pass {@link SerializeOptions} to choose an RDF media type, supply a prefix map,
 * or opt out of the empty-graph short-circuit.
 *
 * @param quads - The quads to serialise (passed verbatim to `Writer.addQuads`).
 * @param options - Optional {@link SerializeOptions}.
 * @returns A promise resolving to the serialised RDF string, or rejecting with
 *   the error `n3.Writer` reports on failure.
 *
 * @example
 * ```ts
 * import { serialize } from "@jeswr/rdf-serialize";
 *
 * const ttl = await serialize(quads, {
 *   prefixes: { schema: "https://schema.org/" },
 * });
 * ```
 */
export function serialize(quads, options) {
    const format = options?.format ?? DEFAULT_FORMAT;
    const prefixes = options?.prefixes ?? {};
    const emptyAsEmptyString = options?.emptyAsEmptyString ?? true;
    // An empty graph short-circuits to "" when requested: n3.Writer otherwise
    // emits the prefix preamble even with no statements, producing a non-empty,
    // content-free document — so a zero-quad input round-trips as truly empty.
    if (emptyAsEmptyString && quads.length === 0) {
        return Promise.resolve("");
    }
    return new Promise((resolve, reject) => {
        const writer = new Writer({ format, prefixes });
        writer.addQuads(quads);
        writer.end((error, result) => {
            if (error) {
                reject(error);
            }
            else {
                resolve(result);
            }
        });
    });
}
/**
 * Backward-compatible POSITIONAL serialiser, matching the exact call shape the
 * five consolidated copies exposed: `serialize(quads, format)`.
 *
 * Provided so a Phase-2 consumer rewire is frictionless — a consumer keeps its
 * existing `serialize(quads, format)` signature by re-exporting a thin local
 * wrapper that calls this helper with its own prefix map (and, for
 * `@jeswr/federation-client`, `emptyAsEmptyString = false`).
 *
 * @param quads - The quads to serialise.
 * @param format - The RDF media type. Defaults to {@link DEFAULT_FORMAT}.
 * @param prefixes - The prefix map. Defaults to `{}` (no prefixes).
 * @param emptyAsEmptyString - Whether a zero-quad input short-circuits to `""`.
 *   Defaults to `true` (the 4-of-5 majority behaviour); pass `false` for the
 *   `@jeswr/federation-client` bare-preamble behaviour.
 * @returns A promise resolving to the serialised RDF string.
 *
 * @example
 * ```ts
 * // A consumer's thin local wrapper preserving its own public surface:
 * import { legacySerialize } from "@jeswr/rdf-serialize";
 * import { PREFIXES } from "./vocab.js";
 *
 * export function serialize(quads: readonly Quad[], format = "text/turtle") {
 *   return legacySerialize(quads, format, PREFIXES);
 * }
 * ```
 */
export function legacySerialize(quads, format = DEFAULT_FORMAT, prefixes = {}, emptyAsEmptyString = true) {
    return serialize(quads, { format, prefixes, emptyAsEmptyString });
}
//# sourceMappingURL=serialize.js.map