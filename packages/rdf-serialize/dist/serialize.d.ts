import type { Quad } from "@rdfjs/types";
/**
 * The default RDF media type used when {@link SerializeOptions.format} is omitted.
 *
 * Matches the `format = "text/turtle"` default of every consolidated copy.
 */
export declare const DEFAULT_FORMAT: "text/turtle";
/**
 * Options for {@link serialize}.
 *
 * The package is deliberately vocab-agnostic: there is no baked-in default
 * prefix map. Each caller supplies its own {@link SerializeOptions.prefixes}
 * (typically the consumer's own vocab prefix constant), so consolidating the
 * five copies does not couple them to one vocabulary.
 */
export interface SerializeOptions {
    /**
     * The RDF media type passed straight through to `n3.Writer`
     * (`text/turtle`, `application/n-triples`, `application/n-quads`,
     * `application/trig`, …).
     *
     * Defaults to {@link DEFAULT_FORMAT} (`"text/turtle"`). An unrecognised media
     * type falls back to Turtle — this is `n3.Writer`'s own behaviour, not a check
     * performed here.
     *
     * @defaultValue `"text/turtle"`
     */
    format?: string;
    /**
     * The prefix declarations emitted in the output (for readability of Turtle /
     * TriG; ignored by the line-based N-Triples / N-Quads formats), as a map of
     * prefix label to namespace IRI passed straight to `n3.Writer`.
     *
     * Defaults to `{}` (no prefixes) so the caller supplies its vocab prefix map.
     *
     * @defaultValue `{}`
     */
    prefixes?: Readonly<Record<string, string>>;
    /**
     * When `true` (the default), a zero-quad input short-circuits to the empty
     * string `""` instead of letting `n3.Writer` emit a content-free prefix
     * preamble. This is the behaviour of four of the five consolidated copies
     * (`@jeswr/solid-vc`, `@jeswr/solid-odrl`, `@jeswr/solid-a2a`,
     * `@jeswr/solid-agent-card`).
     *
     * Set to `false` to reproduce `@jeswr/federation-client`'s behaviour, which lets
     * `n3.Writer` emit the bare prefix preamble for an empty graph (a non-empty
     * string).
     *
     * @defaultValue `true`
     */
    emptyAsEmptyString?: boolean;
}
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
export declare function serialize(quads: readonly Quad[], options?: SerializeOptions): Promise<string>;
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
export declare function legacySerialize(quads: readonly Quad[], format?: string, prefixes?: Readonly<Record<string, string>>, emptyAsEmptyString?: boolean): Promise<string>;
//# sourceMappingURL=serialize.d.ts.map