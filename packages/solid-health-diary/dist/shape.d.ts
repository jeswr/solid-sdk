/** Filesystem path to the vendored SHACL profile (`shapes/diet.shacl.ttl`). */
export declare const DIET_SHACL_PATH: string;
/** Filesystem path to the vendored vocabulary (`shapes/diet.vocab.ttl`). */
export declare const DIET_VOCAB_PATH: string;
/**
 * The canonical health-diary SHACL profile, as a Turtle string. Cached after the
 * first read. Pass it (with the data graph + {@link dietVocabTtl}) to a SHACL
 * validator — see `src/shape.test.ts` for the `rdf-validate-shacl` pattern.
 */
export declare function dietShaclTtl(): string;
/**
 * The `diet:` vocabulary, as a Turtle string. Cached after the first read. Load it
 * INTO THE DATA GRAPH alongside the instance data when validating, so the SHACL
 * `sh:class` checks over the coded-value concept IRIs resolve.
 */
export declare function dietVocabTtl(): string;
//# sourceMappingURL=shape.d.ts.map